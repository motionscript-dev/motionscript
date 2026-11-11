import type { IdLine, IdToken } from "./tokens";

/** Decides which token became which across an edit; `diffCode` (exported as `defaultCodeDiff`) is the default. */
export type CodeDiffStrategy = (from: IdLine[], to: IdLine[]) => CodeEdit;

/** The next structure with ids carried over wherever content survived, so a surviving token moves rather than dissolves and rebuilds. */
export interface CodeEdit {
    /** The new structure; ids are rewritten in place onto the tokens handed in. */
    lines: IdLine[];
    removedIds: Set<number>;
    addedIds: Set<number>;
    /** Lines that did not exist before; they enter as a whole row. */
    newLineIds: Set<number>;
    /** Previous colour of a surviving token whose highlighting changed, for the cross-fade. */
    fromColorById: Map<number, string | undefined>;
}

/** Below this similarity two lines are one deleted and one inserted, not one edited: carrying ids across would slide glyphs between unrelated words. */
const LINE_MATCH_FLOOR = 0.45;

/**
 * Most line pairs scored in one run of changed lines, and across a whole edit.
 * Scoring every pair is quadratic (741 ms at 1,000 lines), so only a run between
 * two anchors (see {@link alignLines}) is scored; past the budget its lines leave
 * and enter as whole rows.
 */
const LINE_ALIGN_CELLS = 40_000;
const EDIT_ALIGN_CELLS = 160_000;

function tokenWeight(tok: IdToken): number {
    return tok.content.trim().length;
}

function lineWeight(line: IdLine): number {
    let sum = 0;
    for (const tok of line.tokens) sum += tokenWeight(tok);
    return sum;
}

/**
 * Dice coefficient over the lines' token multisets, weighted by visible characters.
 * Two blank lines are identical (1) but a blank against a non-blank shares nothing
 * (0), so blank rows a reformat introduces never anchor onto real code.
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
 * Matched index pairs, in order, maximising total `score`; a pair scoring <= 0 is
 * skipped. An LCS would pair only identical elements, but two lines that differ by
 * one word are the same line.
 */
function align(
    aLength: number,
    bLength: number,
    score: (i: number, j: number) => number,
): Array<[number, number]> {
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

/** Scored by visible characters, so keeping `items.reduce` beats keeping four spaces; a changed word is a different token. */
function alignTokens(from: IdToken[], to: IdToken[]): Array<[number, number]> {
    return align(from.length, to.length, (i, j) => {
        if (from[i].content !== to[j].content) return 0;
        // Whitespace pairs weakly: it holds indentation together but never outranks content.
        return tokenWeight(to[j]) || 0.25;
    });
}

function sameTokens(a: IdLine, b: IdLine): boolean {
    if (a.tokens.length !== b.tokens.length) return false;
    for (let k = 0; k < a.tokens.length; k++) if (a.tokens[k].content !== b.tokens[k].content) return false;
    return true;
}

/** Text with token boundaries, so identical lines tell apart from similar ones. */
function signature(line: IdLine): string {
    let out = "";
    for (const tok of line.tokens) out += tok.content + "\u0001";
    return out;
}

/**
 * Pairs lines in order: identical head and tail outright, then the longest ordered
 * run of lines occurring once on each side as anchors, with each run between
 * anchors scored within the budget. A one-line edit to a long listing therefore
 * never builds a table bigger than the lines around it.
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

/** Lines occurring once on each side, reduced to the longest subsequence increasing on both (patience sorting); blanks never anchor. */
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

/** Carries `from`'s ids onto `to`; `to` is freshly tokenized, so rewriting its ids in place is safe. */
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
