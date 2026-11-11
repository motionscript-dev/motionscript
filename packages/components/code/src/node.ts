import {
    Graphics2D,
    Paint,
    Types,
    component2d,
    lerpNumber,
    type InsetsResolved,
    type MeasureContext2D,
    type Measurer,
    type NodeOf,
    type NormalizedColor,
    type Piece,
    type RenderContext,
    type Size2D,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Color as _Color,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
} from "@motionscript/sdk";
import {
    DefaultHighlightStyle,
    TokenAdvanceCache,
    canHighlight,
    charOffsetsToRange,
    defaultCodeDiff,
    defaultCodePhases,
    drawCode,
    ensureHighlighter,
    layoutCode,
    makeAnim,
    metricsSignature,
    moveProgress,
    normalizeSource,
    rangeToCharOffsets,
    resolveTokenStates,
    tokenizeCodeToIdLines,
    type AnimToken,
    type CodeDiffStrategy,
    type CodeLayout,
    type CodeMetrics,
    type CodePhaseStrategy,
    type CodeRange,
    type CodeTheme,
    type DimTransition,
    type IdLine,
    type RowBand,
    type RowsTransition,
    type StructuralTransition,
} from "./engine";

/** A row band's paint and corner radius when `highlightRows` is given neither. */
const ROW_BAND_COLOR = "rgba(255, 255, 255, 0.12)";
const ROW_BAND_RADIUS = 6;

/** Arguments of {@link defineCode}: a strategy is a function, which a prop would take for a binding, so it belongs to the definition. */
export interface CodeStrategies {
    /** Decides which token became which across an edit. Defaults to `defaultCodeDiff`. */
    diffStrategy?: CodeDiffStrategy;
    /** Decides when (in normalized transition time) each part of an edit happens. Defaults to `defaultCodePhases`. */
    phaseStrategy?: CodePhaseStrategy;
}

/** `code` part-way through a `to({ code })`: the source it leaves, the one it lands on, and how far along it is, eased. */
export interface CodeBlend {
    readonly from: string;
    readonly to: string;
    readonly t: number;
}

/** What `code` holds: a source, or a {@link CodeBlend} while a `to({ code })` runs. */
export type CodeSource = string | CodeBlend;

/** A range argument: one range, several, or a chain that went through JSON as `{ list }`. */
export type CodeTarget = CodeRange | Iterable<CodeRange> | { readonly list: CodeRange[] };

/** What a structure was tokenized with: the grammar, the theme and whether the grammar had landed. */
export interface CodeTokenBasis {
    readonly language: string;
    readonly theme: CodeTheme;
    readonly highlighted: boolean;
}

/** A listing a command left behind: its source, its tokens, and the basis they were made on. */
export interface CodeListing {
    readonly source: string;
    readonly lines: IdLine[];
    readonly basis: CodeTokenBasis;
}

export interface CodeEditFrame {
    readonly transition: StructuralTransition;
    readonly progress: number;
}

/** The dim `highlight` leaves: what stays bright, what the rest dims to, and the cross-fade in flight. */
export interface CodeFocus {
    readonly dim: number | null;
    readonly ids: Set<number>;
    readonly fade: DimTransition | null;
}

export interface CodeBanding {
    readonly bands: RowBand[];
    readonly fade: RowsTransition | null;
}

/** Each `Code` component's strategies and edit cache, by the node class it generated. */
const kits = new WeakMap<object, Kit>();

const NO_FOCUS: CodeFocus = { dim: null, ids: new Set(), fade: null };
const NO_BANDING: CodeBanding = { bands: [], fade: null };

/** A private entry: commands write it, documents and calls never see it. */
function own<T>(initial: T) {
    return Types.custom<T, T, { readonly private: true }>(initial, { private: true });
}

const TARGET = Types.custom<CodeTarget | undefined>(undefined, { kind: "selector" });
const TEXT = Types.text("", { multiline: true });

/**
 * A `Code` whose edits are paired and timed by `strategies`; {@link Code} has the
 * defaults, and a project wanting another hands its own to the engine (same key).
 * A listing only, with no box behind it: a card is a `Code` inside a hugging `Rect`.
 */
export function defineCode(strategies: CodeStrategies = {}) {
    const kit: Kit = {
        diff: strategies.diffStrategy ?? defaultCodeDiff,
        phases: strategies.phaseStrategy ?? defaultCodePhases,
        edits: new WeakMap(),
    };
    const act = (timeline: { animate(frame: Frame): Piece; wait(seconds: number): Piece }, frame: Frame | null): Piece =>
        (frame ? timeline.animate(frame) : timeline.wait(0));

    const component = component2d({
        key: "code",
        state: {
            code: Types.custom<string, CodeSource>("", { lerp: blendSource }),
            language: "typescript",
            fontFamily: "Fira Mono",
            /** A built-in or registered theme name (e.g. `'github-dark'`), or a `CodeHighlightStyle` object. */
            theme: Types.custom<CodeTheme>(DefaultHighlightStyle.name),
            fontSize: 16,
            lineHeight: 1.6,
            // Extra space after every glyph, in px: folded into the advance a token is measured at.
            letterSpacing: 1.1,
            showLineNumbers: false,
            // In space-widths, so it scales with fontSize.
            lineNumberGap: 2,
            listing: own<CodeListing | null>(null),
            edit: own<CodeEditFrame | null>(null),
            focus: own(NO_FOCUS),
            banding: own(NO_BANDING),
        },
        defaults: { width: "hug", height: "hug" },
        allowedChildren: [],
        // The grammar gates layout: how many tokens there are, and so where each sits, depends on it.
        load: (loader, state) => {
            loader.font(state.fontFamily);
            loader.task(`shiki:lang:${state.language}`, grammarLoader(state.language), { before: "layout" });
        },
        commands: {
            /** Append `code` to the end of the listing. */
            append: {
                args: { code: TEXT },
                run: (timeline, state) => {
                    const seen = current(state, kit);
                    return act(timeline, editFrame(kit, seen, seen.source + timeline.args.code, basisOf(state)));
                },
            },
            /** Insert `code` above the listing. */
            prepend: {
                args: { code: TEXT },
                run: (timeline, state) => {
                    const seen = current(state, kit);
                    return act(timeline, editFrame(kit, seen, timeline.args.code + seen.source, basisOf(state)));
                },
            },
            /** Insert `code` before the 1-indexed `[line, col]`, clamped into the listing. */
            insert: {
                args: {
                    position: Types.custom<[number, number] | undefined>(undefined, {
                        kind: "point",
                        properties: {
                            line: { kind: "number", default: 1, min: 1, step: 1 },
                            col: { kind: "number", default: 1, min: 1, step: 1 },
                        },
                    }),
                    code: TEXT,
                },
                run: (timeline, state) => {
                    const seen = current(state, kit);
                    const offset = offsetAt(seen.lines, timeline.args.position as [number, number]);
                    const next = seen.source.slice(0, offset) + timeline.args.code + seen.source.slice(offset);
                    return act(timeline, editFrame(kit, seen, next, basisOf(state)));
                },
            },
            /**
             * Erase the code in `target`. A range of whole lines takes their line
             * breaks with it, so the rows below close up.
             */
            remove: {
                args: { target: TARGET },
                run: (timeline, state) => act(timeline, eraseFrame(kit, state, timeline.args.target as CodeRange)),
            },
            replace: {
                args: { target: TARGET, replacement: TEXT },
                run: (timeline, state) => {
                    const seen = current(state, kit);
                    const { start, end } = rangeToCharOffsets(timeline.args.target as CodeRange, lineLengths(seen.lines));
                    const next = seen.source.slice(0, start) + timeline.args.replacement + seen.source.slice(end);
                    return act(timeline, editFrame(kit, seen, next, basisOf(state)));
                },
            },
            /**
             * Dim everything outside `target` (one range or several) to `dim`.
             * Persistent: a second highlight cross-fades from this one.
             */
            highlight: {
                args: {
                    target: TARGET,
                    dim: Types.number(0.4, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
                },
                run: (timeline, state) => act(timeline, highlightFrame(kit, state, timeline.args.target, timeline.args.dim)),
            },
            /** Fade every dimmed token back to full and clear the highlight. */
            resetHighlight: (timeline, state) => act(timeline, resetHighlightFrame(kit, state)),
            /**
             * Lay a band of `color` behind every line a range touches. A second
             * call slides the bands onto their new rows, paired in order; a band
             * keeps to its lines through an edit.
             */
            highlightRows: {
                args: {
                    target: TARGET,
                    color: Types.color(ROW_BAND_COLOR),
                    radius: Types.number(ROW_BAND_RADIUS, { min: 0, step: 1 }),
                },
                run: (timeline, state) => {
                    const seen = current(state, kit);
                    const bands = rowBandsIn(seen.lines, normalizeCodeRanges(timeline.args.target), timeline.args.color, Math.max(0, timeline.args.radius ?? ROW_BAND_RADIUS));
                    return act(timeline, rowsFrame(seen, state.banding.bands, bands));
                },
            },
            /** Fade every row band out and clear them. */
            resetRowHighlight: (timeline, state) => act(timeline, rowsFrame(current(state, kit), state.banding.bands, [])),
        },
        measure: (measurer, state) => measureListing(measurer, state, kit),
        // Refuses the ambient text style: every column is measured against this face, so an
        // inherited family or weight would shape glyphs the geometry was never measured for.
        render:(ctx, state) => ctx.textStyle(null, () => drawListing(ctx, state, kit)),
    });
    kits.set(component.node, kit);
    return component;
}

/**
 * A syntax-highlighted listing whose edits animate token by token: each edit
 * is diffed against what is on screen, so a token that survives travels to
 * its new column and only what changed fades.
 */
export const Code = defineCode();
export type Code = NodeOf<typeof Code>;
export type CodeProps = NonNullable<Parameters<typeof Code>[0]>;

/** What a listing shows now: its source, its token rows, and the edit in flight, if any. */
export function listingOf(code: Code): { readonly source: string; readonly lines: readonly IdLine[]; readonly edit: StructuralTransition | null } {
    const kit = kits.get(code.constructor);
    if (!kit) throw new TypeError("listingOf takes a node a `Code` component built.");
    const view = shown(code, kit);
    return { source: view.source, lines: view.lines, edit: editOf(view) };
}

/** Every range matching the literal `text` in `source`, in order and not overlapping. Multi-line matches are found too. */
export function findAllRanges(source: CodeSource, text: string): CodeRange[] {
    const ranges: CodeRange[] = [];
    if (!text) return ranges;
    const joined = normalizeSource(sourceText(source));
    const lineLens = joined.split("\n").map((line) => line.length);
    let from = 0;
    while (true) {
        const idx = joined.indexOf(text, from);
        if (idx === -1) break;
        ranges.push(charOffsetsToRange(idx, idx + text.length, lineLens));
        from = idx + Math.max(1, text.length);
    }
    return ranges;
}

/** The `index`th range matching `text`, or `null`. */
export function findRangeAt(source: CodeSource, text: string, index: number): CodeRange | null {
    return findAllRanges(source, text)[index] ?? null;
}

/** The first range matching `text`, or `null`. */
export function findFirstRange(source: CodeSource, text: string): CodeRange | null {
    return findRangeAt(source, text, 0);
}

interface Kit {
    readonly diff: CodeDiffStrategy;
    readonly phases: CodePhaseStrategy;
    /** The edit from a listing to a source and basis, built once: a `to({ code })` asks for it every frame. */
    readonly edits: WeakMap<IdLine[], Map<string, Map<string, Edited>>>;
}

interface Edited {
    readonly transition: StructuralTransition;
    readonly listing: CodeListing;
}

/** What the structure resolves from; a command's snapshot and a node's state view both qualify. */
interface ListingState {
    readonly code: CodeSource;
    readonly language: string;
    readonly theme: CodeTheme;
    readonly listing: CodeListing | null;
    readonly edit: CodeEditFrame | null;
}

interface LayoutState extends ListingState {
    readonly fontSize: number;
    readonly fontFamily: string;
    readonly lineHeight: number;
    readonly letterSpacing: number;
    readonly padding: InsetsResolved;
    readonly showLineNumbers: boolean;
    readonly lineNumberGap: number;
}

interface DrawState extends LayoutState {
    readonly focus: CodeFocus;
    readonly banding: CodeBanding;
}

/** The structure a frame draws, and the edit it is part-way through. */
interface Shown {
    readonly source: string;
    readonly lines: IdLine[];
    readonly transition: StructuralTransition | null;
    readonly progress: number;
}

/** A `to({ code })` mid-flight wins, as it wrote `code` after any edit command; then an edit in flight, then the settled listing. */
function shown(s: ListingState, kit: Kit): Shown {
    const code = s.code;
    if (typeof code !== "string") {
        const { transition } = edited(settled(s, code.from, kit), code.to, basisOf(s), kit);
        return { source: code.to, lines: transition.to, transition, progress: code.t };
    }
    if (s.edit) return { source: normalizeSource(code), lines: s.edit.transition.to, transition: s.edit.transition, progress: s.edit.progress };
    const listing = settled(s, normalizeSource(code), kit);
    return { source: listing.source, lines: listing.lines, transition: null, progress: 1 };
}

function editOf(view: Shown): StructuralTransition | null {
    return view.transition ? { ...view.transition, progress: view.progress } : null;
}

/** The listing a command starts from. */
function current(s: ListingState, kit: Kit): CodeListing {
    return settled(s, normalizeSource(sourceText(s.code)), kit);
}

/**
 * The structure `source` settles on: from the props until a listing command has
 * acted, then the listing it left, recoloured (ids kept) when only the theme moved
 * and diffed onward when the source has.
 */
function settled(s: ListingState, source: string, kit: Kit): CodeListing {
    const basis = basisOf(s);
    const pinned = s.listing;
    if (!pinned) return derived(source, basis);
    if (pinned.source !== source) return edited(pinned, source, basis, kit).listing;
    if (sameBasis(pinned.basis, basis)) return pinned;
    if (pinned.basis.language === basis.language && pinned.basis.highlighted === basis.highlighted) return recoloured(pinned, basis);
    return derived(source, basis);
}

function basisOf(s: { readonly language: string; readonly theme: CodeTheme }): CodeTokenBasis {
    return { language: s.language, theme: s.theme, highlighted: canHighlight(s.language) };
}

function sameBasis(a: CodeTokenBasis, b: CodeTokenBasis): boolean {
    return a.language === b.language && a.theme === b.theme && a.highlighted === b.highlighted;
}

/** The source `code` names: where a `to({ code })` is heading, mid-tween. */
function sourceText(code: CodeSource): string {
    return typeof code === "string" ? code : code.to;
}

/** Mid-tween `code` holds both sources so the frame can draw the edit between them; at either end it is a source again. */
function blendSource(from: CodeSource, to: CodeSource, t: number): CodeSource {
    const leaving = sourceText(from);
    const arriving = sourceText(to);
    const a = normalizeSource(leaving);
    const b = normalizeSource(arriving);
    // Nothing to edit: it snaps at the end, as any text does.
    if (a === b) return t >= 1 ? arriving : leaving;
    if (t <= 0) return a;
    if (t >= 1) return b;
    return { from: a, to: b, t };
}

const DERIVED = new Map<string, Map<string, CodeListing>>();
/** Sources kept tokenized per basis, oldest dropped first; a bound `code` can name any number of them. */
const DERIVED_LISTINGS = 256;

/** The props' own listing, the same object (and ids) each time it is asked for again. */
function derived(source: string, basis: CodeTokenBasis): CodeListing {
    return recall(DERIVED, basisKey(basis), source, DERIVED_LISTINGS, () => ({ source, lines: tokenize(source, basis), basis }));
}

const RECOLOURED = new WeakMap<IdLine[], Map<string, Map<string, CodeListing>>>();

/** `pinned` in another theme: the same text split the same way keeps the ids a highlight or a band names. */
function recoloured(pinned: CodeListing, basis: CodeTokenBasis): CodeListing {
    let shelf = RECOLOURED.get(pinned.lines);
    if (!shelf) RECOLOURED.set(pinned.lines, shelf = new Map());
    return recall(shelf, basisKey(basis), pinned.source, 4, () => {
        const lines = tokenize(pinned.source, basis);
        adoptIds(pinned.lines, lines);
        return { source: pinned.source, lines, basis };
    });
}

function edited(from: CodeListing, next: string, basis: CodeTokenBasis, kit: Kit): Edited {
    let shelf = kit.edits.get(from.lines);
    if (!shelf) kit.edits.set(from.lines, shelf = new Map());
    return recall(shelf, basisKey(basis), next, 16, () => buildEdit(kit, from.lines, next, basis));
}

function buildEdit(kit: Kit, from: IdLine[], next: string, basis: CodeTokenBasis): Edited {
    const edit = kit.diff(from, tokenize(next, basis));
    const transition: StructuralTransition = {
        kind: "structural",
        from,
        to: edit.lines,
        removedIds: edit.removedIds,
        addedIds: edit.addedIds,
        enteringLineIds: edit.newLineIds,
        fromColorById: edit.fromColorById,
        phases: kit.phases(edit.removedIds.size > 0, edit.addedIds.size > 0),
        progress: 0,
        layoutKey: null,
        fromLayout: null,
        toLayout: null,
    };
    return { transition, listing: { source: next, lines: edit.lines, basis } };
}

function tokenize(source: string, basis: CodeTokenBasis): IdLine[] {
    // Best effort outside the asset pipeline (a test, a headless measure): on the timeline `load` has the grammar in first.
    if (!basis.highlighted) ensureHighlighter([basis.language]).catch(() => { });
    return tokenizeCodeToIdLines(source, basis.language, basis.theme);
}

const styleIds = new WeakMap<object, number>();
let nextStyleId = 1;

function basisKey(basis: CodeTokenBasis): string {
    let theme: string;
    if (typeof basis.theme === "string") theme = `name:${basis.theme}`;
    else {
        let id = styleIds.get(basis.theme);
        if (id === undefined) styleIds.set(basis.theme, id = nextStyleId++);
        theme = `style:${id}`;
    }
    return `${basis.language}\n${basis.highlighted ? 1 : 0}\n${theme}`;
}

/** Memoized by basis, then by source; a basis keeps `limit` sources, least recently asked for dropped first. */
function recall<T>(shelf: Map<string, Map<string, T>>, basis: string, source: string, limit: number, make: () => T): T {
    let row = shelf.get(basis);
    if (!row) shelf.set(basis, row = new Map());
    const hit = row.get(source);
    if (hit !== undefined) {
        row.delete(source);
        row.set(source, hit);
        return hit;
    }
    const made = make();
    row.set(source, made);
    if (row.size > limit) row.delete(row.keys().next().value as string);
    return made;
}

/** Carry `from`'s line and token ids onto `to` when the two spell the same tokens. */
function adoptIds(from: IdLine[], to: IdLine[]): void {
    if (from.length !== to.length) return;
    for (let i = 0; i < from.length; i++) {
        const a = from[i].tokens;
        const b = to[i].tokens;
        if (a.length !== b.length) return;
        for (let j = 0; j < a.length; j++) if (a[j].content !== b[j].content) return;
    }
    for (let i = 0; i < from.length; i++) {
        to[i].id = from[i].id;
        for (let j = 0; j < from[i].tokens.length; j++) to[i].tokens[j].id = from[i].tokens[j].id;
    }
}

/** What a listing command writes at a point of its own eased time. */
interface ListingWrites {
    readonly code?: string;
    readonly listing?: CodeListing | null;
    readonly edit?: CodeEditFrame | null;
    readonly focus?: CodeFocus;
    readonly banding?: CodeBanding;
}

type Frame = (t: number) => ListingWrites;

/** Each command writes the listing it acted on at every time asked, so the ids it captured are the ones drawn. */
function editFrame(kit: Kit, seen: CodeListing, source: string, basis: CodeTokenBasis): Frame | null {
    const next = normalizeSource(source);
    if (next === seen.source) return null;
    const { transition, listing } = buildEdit(kit, seen.lines, next, basis);
    // Three phases (see `phaseStrategy`): what leaves fades out, what stays reflows, then what is new arrives.
    return (t) => (t <= 0 ? { code: seen.source, listing: seen, edit: null }
        : t >= 1 ? { code: next, listing, edit: null }
        : { code: next, listing, edit: { transition, progress: t } });
}

function eraseFrame(kit: Kit, state: ListingState, target: CodeRange): Frame | null {
    const seen = current(state, kit);
    const source = seen.source;
    let { start, end } = rangeToCharOffsets(target, lineLengths(seen.lines));
    // `lines(2)` resolves to the characters of line 2: the row goes too, as an editor would close the gap. That is also what makes a blank row removable.
    const atLineStart = start === 0 || source[start - 1] === "\n";
    const atLineEnd = end === source.length || source[end] === "\n";
    if (atLineStart && atLineEnd) {
        if (end < source.length) end += 1;
        else if (start > 0) start -= 1;
    } else if (end <= start) {
        return null;
    }
    if (end <= start) return null;
    return editFrame(kit, seen, source.slice(0, start) + source.slice(end), basisOf(state));
}

function highlightFrame(kit: Kit, state: ListingState & { readonly focus: CodeFocus }, target: CodeTarget | undefined, dim: number): Frame | null {
    const seen = current(state, kit);
    const toDim = dim ?? 0.4;
    const matchIds = tokenIdsInRanges(seen.lines, normalizeCodeRanges(target));
    if (matchIds.size === 0) return null;

    const previous = state.focus;
    const fromDim = previous.dim ?? 1;
    const hadPrevious = previous.ids.size > 0;
    const tokens: AnimToken[] = [];
    for (const line of seen.lines) {
        for (const tok of line.tokens) {
            const fromOp = !hadPrevious || previous.ids.has(tok.id) ? 1 : fromDim;
            const toOp = matchIds.has(tok.id) ? 1 : toDim;
            if (fromOp === toOp) continue;
            tokens.push(makeAnim(tok.id, { keys: [0, 1], values: [fromOp, toOp] }));
        }
    }
    // Which tokens are dimmed is what the next highlight cross-fades from, so it is committed at the end and put back below it.
    const before: CodeFocus = { dim: hadPrevious ? fromDim : null, ids: previous.ids, fade: null };
    const done: CodeFocus = { dim: toDim, ids: matchIds, fade: null };
    return (t) => ({
        listing: seen,
        focus: t <= 0 ? before : t >= 1 ? done : { ...before, fade: { kind: "dim", tokens, progress: t } },
    });
}

function resetHighlightFrame(kit: Kit, state: ListingState & { readonly focus: CodeFocus }): Frame | null {
    const previous = state.focus;
    if (previous.dim === null) return null;
    const seen = current(state, kit);
    const fromDim = previous.dim;
    const tokens: AnimToken[] = [];
    for (const line of seen.lines) {
        for (const tok of line.tokens) {
            const fromOp = previous.ids.has(tok.id) ? 1 : fromDim;
            if (fromOp === 1) continue;
            tokens.push(makeAnim(tok.id, { keys: [0, 1], values: [fromOp, 1] }));
        }
    }
    const before: CodeFocus = { dim: fromDim, ids: previous.ids, fade: null };
    return (t) => ({
        listing: seen,
        focus: t >= 1 ? NO_FOCUS : t <= 0 ? before : { ...before, fade: { kind: "dim", tokens, progress: t } },
    });
}

function rowsFrame(seen: CodeListing, from: RowBand[], to: RowBand[]): Frame | null {
    if (from.length === 0 && to.length === 0) return null;
    return (t) => ({
        listing: seen,
        banding: t >= 1 ? { bands: to, fade: null }
            : t <= 0 ? { bands: from, fade: null }
            : { bands: from, fade: { kind: "rows", from, to, progress: t } },
    });
}

function lineLengths(lines: IdLine[]): number[] {
    return lines.map((line) => line.tokens.reduce((acc, t) => acc + t.content.length, 0));
}

/** Character offset of a 1-indexed (line, col), clamped into the document. */
function offsetAt(lines: IdLine[], position: [number, number]): number {
    const lens = lineLengths(lines);
    if (lens.length === 0) return 0;
    const [rawLine, rawCol] = position;
    const li = Math.max(0, Math.min(lens.length - 1, rawLine - 1));
    let offset = 0;
    for (let k = 0; k < li; k++) offset += lens[k] + 1;
    return offset + Math.max(0, Math.min(lens[li], rawCol - 1));
}

/** The ids of every token any of `codeRanges` overlaps, partly or wholly. */
function tokenIdsInRanges(lines: IdLine[], codeRanges: CodeRange[]): Set<number> {
    const result = new Set<number>();
    const lineLens = lineLengths(lines);
    if (lineLens.length === 0) return result;
    const offsets = codeRanges
        .map((r) => rangeToCharOffsets(r, lineLens))
        .filter(({ start, end }) => end > start);
    if (offsets.length === 0) return result;

    let off = 0;
    for (let li = 0; li < lines.length; li++) {
        for (const tok of lines[li].tokens) {
            const tStart = off;
            const tEnd = off + tok.content.length;
            if (offsets.some(({ start, end }) => tEnd > start && tStart < end)) result.add(tok.id);
            off = tEnd;
        }
        if (li < lines.length - 1) off += 1;
    }
    return result;
}

/** One band per range, over every line it touches; a range past the end of the listing gives none. */
function rowBandsIn(lines: IdLine[], codeRanges: CodeRange[], color: NormalizedColor, radius: number): RowBand[] {
    const count = lines.length;
    const bands: RowBand[] = [];
    for (const range of codeRanges) {
        const first = Math.max(1, Math.round(range.startLine ?? 1));
        const last = Math.min(count, range.endLine == null || range.endLine === Infinity ? count : Math.round(range.endLine));
        if (first > last) continue;
        bands.push({ startId: lines[first - 1].id, endId: lines[last - 1].id, color, radius });
    }
    return bands;
}

/** One range as a one-element array; a chain or array as itself; the `{ list }` a chain serialises as, as that chain. */
function normalizeCodeRanges(codeRange: CodeTarget | undefined): CodeRange[] {
    const maybeIterable = codeRange as Partial<Iterable<CodeRange>>;
    if (typeof maybeIterable[Symbol.iterator] === "function") {
        return [...(codeRange as Iterable<CodeRange>)];
    }
    const stored = (codeRange as { list?: unknown }).list;
    if (Array.isArray(stored)) return [...(stored as CodeRange[])];
    return [codeRange as CodeRange];
}

const grammarLoaders = new Map<string, () => Promise<void>>();

// One function per language: a second load function for an already-declared task key is ignored with a warning.
function grammarLoader(language: string): () => Promise<void> {
    let load = grammarLoaders.get(language);
    if (load === undefined) {
        load = () => ensureHighlighter([language]);
        grammarLoaders.set(language, load);
    }
    return load;
}

interface Layouts {
    readonly from: CodeLayout;
    readonly to: CodeLayout;
}

/** A node's measurements between frames: token advances, and the layouts last built, reused while their inputs are unchanged. */
interface Measured {
    readonly advances: TokenAdvanceCache;
    measurer: Measurer | null;
    /** The measurer of the node's last measure, as the engine's helpers take one. */
    scope: MeasureContext2D | null;
    settled: { readonly lines: IdLine[]; readonly key: string; readonly layout: CodeLayout } | null;
    edit: { readonly transition: StructuralTransition; readonly key: string; readonly from: CodeLayout; readonly to: CodeLayout } | null;
}

/** By the node's state view, one object per node that `measure` and `render` are both handed. */
const measuredBy = new WeakMap<object, Measured>();

function measuredOf(state: object): Measured {
    let found = measuredBy.get(state);
    if (!found) measuredBy.set(state, found = { advances: new TokenAdvanceCache(), measurer: null, scope: null, settled: null, edit: null });
    return found;
}

function metricsOf(s: LayoutState): CodeMetrics {
    return {
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        padding: s.padding,
        showLineNumbers: s.showLineNumbers,
        lineNumberGap: s.lineNumberGap,
    };
}

/** One layout for a settled frame, two (where every token was, where it goes) inside an edit; `null` for a node never measured. */
function layoutsOf(measured: Measured, view: Shown, m: CodeMetrics): Layouts | null {
    const signature = measured.advances.signature(m.fontSize, m.fontFamily);
    measured.advances.sync(signature);
    const key = `${metricsSignature(m)}|${signature}`;
    const scope = measured.scope;
    if (!view.transition) {
        const hit = measured.settled;
        if (hit && hit.lines === view.lines && hit.key === key) return { from: hit.layout, to: hit.layout };
        if (!scope) return null;
        const layout = layoutCode(view.lines, m, measured.advances, scope);
        measured.settled = { lines: view.lines, key, layout };
        return { from: layout, to: layout };
    }
    const hit = measured.edit;
    if (hit && hit.transition === view.transition && hit.key === key) return hit;
    if (!scope) return null;
    const both = {
        transition: view.transition,
        key,
        from: layoutCode(view.transition.from, m, measured.advances, scope),
        to: layoutCode(view.transition.to, m, measured.advances, scope),
    };
    measured.edit = both;
    return both;
}

function measureListing(measurer: Measurer, s: LayoutState, kit: Kit): Size2D {
    const measured = measuredOf(s);
    if (measured.measurer !== measurer) {
        measured.measurer = measurer;
        measured.scope = {
            measureText: (text, fontSize, fontFamily, fontWeight, letterSpacing) =>
                measurer.text(text, { fontFamily, fontSize, fontWeight, letterSpacing }),
        };
    }
    const view = shown(s, kit);
    const m = metricsOf(s);
    const layouts = layoutsOf(measured, view, m);
    if (!layouts) return { width: 0, height: 0 };
    const t = moveProgress(view.transition ? { phases: view.transition.phases, progress: view.progress } : null);
    const innerW = view.transition ? lerpNumber(layouts.from.innerW, layouts.to.innerW, t) : layouts.to.innerW;
    const innerH = view.transition ? lerpNumber(layouts.from.innerH, layouts.to.innerH, t) : layouts.to.innerH;
    return { width: innerW + m.padding.left + m.padding.right, height: innerH + m.padding.top + m.padding.bottom };
}

const NO_PAINT: Paint.PaintState = { fill: [], stroke: [], shadow: [], overlay: [], start: 0, end: 1, clip: false };
const NOTHING = (): void => { };

function drawListing(ctx: RenderContext, s: DrawState, kit: Kit): void {
    const measured = measuredOf(s);
    const view = shown(s, kit);
    const m = metricsOf(s);
    const layouts = layoutsOf(measured, view, m);
    // Paints nothing: it declares the outline picking and backdrop effects read.
    Paint.draw(ctx, NO_PAINT, null, { clipShape: outlineOf(view, layouts, m, ctx.size), children: NOTHING });
    const scope = measured.scope;
    if (!layouts || !scope) return;
    const { focus, banding } = s;
    drawCode({ draw: (graphics) => ctx.draw(graphics), measureText: scope.measureText }, {
        tokenLines: view.lines,
        metrics: m,
        advanceCache: measured.advances,
        from: layouts.from,
        to: layouts.to,
        edit: editOf(view),
        tokenStates: resolveTokenStates(view.lines, focus.fade ? [focus.fade] : [], focus.dim, focus.ids),
        highlightActive: focus.dim !== null || focus.fade !== null,
        rowBands: banding.bands,
        rowsEdit: banding.fade,
        boxW: ctx.size.width,
    });
}

/**
 * A listing is picked by its ink, line by ragged line (plus the gutter), inside the
 * box: code is mostly whitespace and empty corners would swallow clicks meant for
 * what is behind. Mid-edit, or before layout, the box.
 */
function outlineOf(view: Shown, layouts: Layouts | null, m: CodeMetrics, size: Size2D): Graphics2D {
    const box = { x: 0, y: 0, width: size.width, height: size.height };
    if (view.transition || !layouts) return new Graphics2D().rect(box);
    const layout = layouts.to;
    const half = (m.fontSize * m.lineHeight) / 2;
    const gutter = m.showLineNumbers ? layout.gutter : 0;
    const left = Math.max(layout.startX - gutter, -size.width / 2);
    const outline = new Graphics2D();
    let lines = 0;
    for (let i = 0; i < layout.lineY.length; i++) {
        const ink = layout.lineW[i] ?? 0;
        if (ink + gutter <= 0) continue;
        const right = Math.min(layout.startX + ink, size.width / 2);
        const y = layout.lineY[i];
        const top = Math.min(y + half, size.height / 2);
        const bottom = Math.max(y - half, -size.height / 2);
        if (right < left || top < bottom) continue;
        // The row's own centre where the box leaves it whole, so a whole row is tested at its own centre.
        const whole = top === y + half && bottom === y - half;
        outline.rect({
            x: (left + right) / 2,
            y: whole ? y : (top + bottom) / 2,
            width: right - left,
            height: whole ? 2 * half : top - bottom,
        });
        lines++;
    }
    // No line has ink: the box with itself cut away, so nothing is grabbed (an empty outline would fall back to the box).
    return lines > 0 ? outline : new Graphics2D().rect(box).rect(box).cut();
}
