import type { IdLine, IdToken } from "./tokens";

/**
 * The result of diffing one listing structure against another: the *next*
 * structure, with token and line ids carried over from the previous one
 * wherever the content survived, plus the three sets a transition needs to know
 * which role each token plays.
 *
 * Identity is the whole product here. `const variable = 3` becoming
 * `const number = 3` should move `const` and `= 3` rather than dissolve and
 * rebuild them, and a token can only *move* if the frame after the edit still
 * knows it is the same token.
 */
/**
 * How a `Code` node decides which token became which across an edit. Given
 * the old and new tokenized structures, return the carried-over structure
 * plus the added/removed/renamed-line bookkeeping a transition needs.
 * `diffCode` below is the default implementation (exported as
 * `defaultCodeDiff`) — pass a `diffStrategy` of this shape to `<Code>` to
 * replace it with your own.
 */
export type CodeDiffStrategy = (from: IdLine[], to: IdLine[]) => CodeEdit;

export interface CodeEdit {
    /** The new structure. Ids are rewritten in place onto the tokens handed in. */
    lines: IdLine[];
    /** Ids present only in the old structure — these fade out. */
    removedIds: Set<number>;
    /** Ids present only in the new structure — these fade in. */
    addedIds: Set<number>;
    /** Ids of {@link lines} that did not exist before — these enter as a whole row. */
    newLineIds: Set<number>;
    /** Previous colour of a surviving token whose highlighting changed, for the cross-fade. */
    fromColorById: Map<number, string | undefined>;
}

/**
 * How similar two lines must be before they are treated as *one line that was
 * edited* rather than as one line deleted and another inserted.
 *
 * Below this, a row's tokens have so little in common that carrying ids across
 * would animate glyphs sliding between unrelated words. Above it, the edit reads
 * the way it was made.
 */
const LINE_MATCH_FLOOR = 0.45;

/**
 * The most line pairs one run of changed lines is scored against each other, and
 * the most across a whole edit.
 *
 * Scoring every pair is quadratic: with 50-character lines it took 31 ms at 200
 * lines and 741 ms at 1,000, paid again for each edit command when it is built.
 * So the lines are first paired where they cannot be in doubt (see
 * {@link alignLines}), and only a run left between two such anchors is scored.
 * A run past the first limit, or what is left of the second, is not compared: its
 * lines leave and enter as whole rows. That is the budget, and an edit that stays
 * inside it is diffed exactly as before.
 */
export const LINE_ALIGN_CELLS = 40_000;
export const EDIT_ALIGN_CELLS = 160_000;

/** Weight a token carries when judging similarity: its visible characters. */
function tokenWeight(tok: IdToken): number {
    return tok.content.trim().length;
}

function lineWeight(line: IdLine): number {
    let sum = 0;
    for (const tok of line.tokens) sum += tokenWeight(tok);
    return sum;
}

/**
 * Dice coefficient over the two lines' token multisets, weighted by visible
 * characters so `variable` counts for far more than a run of spaces.
 *
 * Two blank lines are identical (1); a blank line against a non-blank one shares
 * nothing (0), which keeps the blank rows a reformat introduces from anchoring
 * themselves onto real code.
 */
function similarity(a: IdLine, b: IdLine): number {
    const wa = lineWeight(a);
    const wb = lineWeight(b);
    if (wa === 0 && wb === 0) return 1;
    if (wa === 0 || wb === 0) return 0;

    const bag = new Map<string, number>();
    for (const tok of a.tokens) {
        if (tokenWeight(tok) === 0) continue;
        bag.set(tok.content, (bag.get(tok.content) ?? 0) + 1);
    }
    let common = 0;
    for (const tok of b.tokens) {
        const w = tokenWeight(tok);
        if (w === 0) continue;
        const left = bag.get(tok.content) ?? 0;
        if (left > 0) {
            bag.set(tok.content, left - 1);
            common += w;
        }
    }
    return (2 * common) / (wa + wb);
}

/**
 * Align two sequences by maximising total `score`, skipping is free.
 *
 * A plain LCS would only ever pair *identical* elements, which is the wrong tool
 * twice over: two lines that differ by one word are the same line, and two
 * tokens that differ only in colour are the same token. Scoring the pairing and
 * letting anything that scores ≤ 0 fall out expresses that directly, and because
 * skips cost nothing the alignment stays in order.
 *
 * Returns the matched index pairs, in order.
 */
function align(
    aLength: number,
    bLength: number,
    score: (i: number, j: number) => number,
): Array<[number, number]> {
    // dp[i][j] = best score aligning a[0..i) with b[0..j).
    const width = bLength + 1;
    const dp = new Float64Array((aLength + 1) * width);
    const pairScore = new Float64Array(aLength * bLength);

    for (let i = 1; i <= aLength; i++) {
        for (let j = 1; j <= bLength; j++) {
            const s = score(i - 1, j - 1);
            pairScore[(i - 1) * bLength + (j - 1)] = s;
            const skipA = dp[(i - 1) * width + j];
            const skipB = dp[i * width + (j - 1)];
            let best = skipA > skipB ? skipA : skipB;
            if (s > 0) {
                const paired = dp[(i - 1) * width + (j - 1)] + s;
                if (paired > best) best = paired;
            }
            dp[i * width + j] = best;
        }
    }

    const pairs: Array<[number, number]> = [];
    let i = aLength;
    let j = bLength;
    while (i > 0 && j > 0) {
        const s = pairScore[(i - 1) * bLength + (j - 1)];
        if (s > 0 && dp[i * width + j] === dp[(i - 1) * width + (j - 1)] + s) {
            pairs.push([i - 1, j - 1]);
            i--; j--;
        } else if (dp[(i - 1) * width + j] >= dp[i * width + (j - 1)]) {
            i--;
        } else {
            j--;
        }
    }
    pairs.reverse();
    return pairs;
}

/**
 * Match the tokens of one line against another's.
 *
 * Scored by visible characters rather than token count, so an alignment that
 * keeps `items.reduce` together beats one that keeps four more spaces. A token
 * pairs only when its content is unchanged — a changed word is a different word,
 * and should be seen to be replaced.
 */
function alignTokens(from: IdToken[], to: IdToken[]): Array<[number, number]> {
    return align(from.length, to.length, (i, j) => {
        if (from[i].content !== to[j].content) return 0;
        // Whitespace still pairs (it holds indentation together), just weakly
        // enough that it never outranks real content.
        return tokenWeight(to[j]) || 0.25;
    });
}

function sameTokens(a: IdLine, b: IdLine): boolean {
    if (a.tokens.length !== b.tokens.length) return false;
    for (let k = 0; k < a.tokens.length; k++) if (a.tokens[k].content !== b.tokens[k].content) return false;
    return true;
}

/** A line's text, token boundaries included, for telling identical lines apart from similar ones. */
function signature(line: IdLine): string {
    let out = "";
    for (const tok of line.tokens) out += tok.content + "\u0001";
    return out;
}

/**
 * Pair the lines of two listings, in order.
 *
 * Lines that are the same at the start and at the end are paired outright. In
 * what is left, a line that occurs exactly once on each side is an anchor, and
 * the longest run of anchors that keeps their order splits the rest into runs of
 * changed lines, each scored against itself within the budget (see
 * {@link LINE_ALIGN_CELLS}). A one-line edit to a long listing therefore never
 * builds a table bigger than the lines around it.
 */
function alignLines(from: IdLine[], to: IdLine[]): Array<[number, number]> {
    const fromSig = from.map(signature);
    const toSig = to.map(signature);
    const pairs: Array<[number, number]> = [];

    let head = 0;
    while (head < from.length && head < to.length && fromSig[head] === toSig[head]) {
        pairs.push([head, head]);
        head++;
    }
    let tail = 0;
    while (
        tail < from.length - head && tail < to.length - head
        && fromSig[from.length - 1 - tail] === toSig[to.length - 1 - tail]
    ) tail++;

    const anchors = anchorLines(fromSig, toSig, head, from.length - tail, head, to.length - tail);
    let budget = EDIT_ALIGN_CELLS;
    let fi = head;
    let ti = head;
    for (const [af, at] of [...anchors, [from.length - tail, to.length - tail] as [number, number]]) {
        const rows = af - fi;
        const cols = at - ti;
        const cells = rows * cols;
        if (cells > 0 && cells <= LINE_ALIGN_CELLS && cells <= budget) {
            budget -= cells;
            for (const [i, j] of align(rows, cols, (a, b) => similarity(from[fi + a], to[ti + b]) - LINE_MATCH_FLOOR)) {
                pairs.push([fi + i, ti + j]);
            }
        }
        if (af < from.length - tail) pairs.push([af, at]);
        fi = af + 1;
        ti = at + 1;
    }
    for (let k = tail; k > 0; k--) pairs.push([from.length - k, to.length - k]);
    return pairs;
}

/**
 * The lines that occur once in `from[fa, fb)` and once in `to[ta, tb)`, reduced to
 * the longest subsequence that is increasing on both sides (patience sorting).
 * Blank lines are never anchors: they say nothing about where they belong.
 */
function anchorLines(
    fromSig: string[],
    toSig: string[],
    fa: number,
    fb: number,
    ta: number,
    tb: number,
): Array<[number, number]> {
    const fromAt = new Map<string, number>();
    const seen = new Set<string>();
    for (let i = fa; i < fb; i++) {
        const sig = fromSig[i];
        if (seen.has(sig)) fromAt.delete(sig);
        else fromAt.set(sig, i);
        seen.add(sig);
    }
    const toAt = new Map<string, number>();
    const seenTo = new Set<string>();
    for (let j = ta; j < tb; j++) {
        const sig = toSig[j];
        if (seenTo.has(sig)) toAt.delete(sig);
        else toAt.set(sig, j);
        seenTo.add(sig);
    }

    // In `to` order, each candidate carries its `from` position.
    const candidates: Array<[number, number]> = [];
    for (let j = ta; j < tb; j++) {
        const i = fromAt.get(toSig[j]);
        if (i !== undefined && toAt.get(toSig[j]) === j && toSig[j].replaceAll("\u0001", "").trim() !== "") {
            candidates.push([i, j]);
        }
    }

    const tails: number[] = [];
    const previous: number[] = new Array(candidates.length).fill(-1);
    for (let c = 0; c < candidates.length; c++) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (candidates[tails[mid]][0] < candidates[c][0]) lo = mid + 1;
            else hi = mid;
        }
        if (lo > 0) previous[c] = tails[lo - 1];
        tails[lo] = c;
    }
    const chain: Array<[number, number]> = [];
    for (let c = tails.length > 0 ? tails[tails.length - 1] : -1; c >= 0; c = previous[c]) chain.push(candidates[c]);
    return chain.reverse();
}

/**
 * Carry `from`'s identities onto `to`, and report what changed.
 *
 * `to` is freshly tokenized and owns ids nobody has seen yet, so rewriting them
 * in place is safe and is what makes the transition cheap: after this, the two
 * structures share an id for every token that survived the edit.
 */
export function diffCode(from: IdLine[], to: IdLine[]): CodeEdit {
    const removedIds = new Set<number>();
    const addedIds = new Set<number>();
    const newLineIds = new Set<number>();
    const fromColorById = new Map<number, string | undefined>();

    const linePairs = alignLines(from, to);

    const pairedTo = new Set<number>();
    const pairedFrom = new Set<number>();

    for (const [fi, ti] of linePairs) {
        pairedFrom.add(fi);
        pairedTo.add(ti);
        const fromLine = from[fi];
        const toLine = to[ti];
        toLine.id = fromLine.id;

        const matched = sameTokens(fromLine, toLine)
            ? fromLine.tokens.map((_, k): [number, number] => [k, k])
            : alignTokens(fromLine.tokens, toLine.tokens);
        const keptFrom = new Set<number>();
        const keptTo = new Set<number>();
        for (const [a, b] of matched) {
            keptFrom.add(a);
            keptTo.add(b);
            const oldTok = fromLine.tokens[a];
            const newTok = toLine.tokens[b];
            newTok.id = oldTok.id;
            if (oldTok.color !== newTok.color) fromColorById.set(oldTok.id, oldTok.color);
        }
        for (let a = 0; a < fromLine.tokens.length; a++) {
            if (!keptFrom.has(a)) removedIds.add(fromLine.tokens[a].id);
        }
        for (let b = 0; b < toLine.tokens.length; b++) {
            if (!keptTo.has(b)) addedIds.add(toLine.tokens[b].id);
        }
    }

    for (let i = 0; i < from.length; i++) {
        if (pairedFrom.has(i)) continue;
        for (const tok of from[i].tokens) removedIds.add(tok.id);
    }
    for (let j = 0; j < to.length; j++) {
        if (pairedTo.has(j)) continue;
        newLineIds.add(to[j].id);
        for (const tok of to[j].tokens) addedIds.add(tok.id);
    }

    return { lines: to, removedIds, addedIds, newLineIds, fromColorById };
}
