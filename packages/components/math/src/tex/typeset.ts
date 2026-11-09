import {
    commandsFor,
    fillOps,
    Flow,
    Graphics2D,
    lerpNumber,
    Paint,
    pathOps,
    toPathString,
    Types,
    type BoxBounds,
    type ChildView,
    type Fill,
    type FillResolved,
    type InsetsResolved,
    type Loader,
    type Placement2D,
    type RenderContext,
    type ShadowResolved,
    type Size2D,
    type StrokeResolved,
    type Values,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Alignment as _Alignment,
    type FlowMode as _FlowMode,
    type FlowResolved as _FlowResolved,
    type GapSize as _GapSize,
    type Shadow as _Shadow,
    type Stroke as _Stroke,
    type Vector2 as _Vector2,
} from "@motionscript/sdk";
// From each module, never the `../engine` barrel: it re-exports this file.
import { blankLatex, buildLatexPath, findLatexParts, LatexNotLoaded, loadMathJax, MATHJAX_LOADER, type LatexPart, type LatexPathResult, type LatexToken } from "./geometry";
import { defaultLatexMorph, type AnimatedToken, type LatexMorphStrategy } from "./tween";
import { createBoundedCache } from "../kit/cache";
import { omit } from "../kit/component";
import { lerpPartFills, partPaint, readPartFills, withPartFill, type PartFill, type PartFillResolved } from "../kit/part-fills";

/**
 * A formula typeset to glyph paths: what `latex` and `latexMatrix` share. A
 * node says where its formula comes from (`formula`); this lays it out, draws
 * it, writes it on, paints its parts, and morphs it into another.
 *
 * A morph is held by the entries the formula is written from: mid-tween each
 * holds both ends ({@link Morph}), so a seek to any time draws the morph there
 * from the node's own state, and a plain `to({ latex })` morphs as `morphTo` does.
 */

/** A value on its way to another: what an entry the formula is written from holds mid-tween. */
export class Morph<T> {
    constructor(readonly from: T, readonly to: T, readonly t: number) { }
}

export type Morphing<T> = T | Morph<T>;

/** The end a value rests at, or is nearer to mid-tween: where a tween that starts from it starts. */
export function settled<T>(value: Morphing<T>): T {
    return value instanceof Morph ? (value.t < 0.5 ? value.from : value.to) : value;
}

// A whole value has nothing between its ends: mid-way it holds both, and the drawing morphs between them.
// (A function, not a generic arrow: a copied component is compiled as TSX, where `<T>(` opens an element.)
export function lerpMorph<T>(from: Morphing<T>, to: Morphing<T>, t: number): Morphing<T> {
    if (t <= 0) return from;
    if (t >= 1) return to;
    return new Morph(settled(from), settled(to), t);
}

/** `parts` combined into one value at each end, when any of them is on its way: a matrix's source from its entries and brackets. */
export function morphOf<T>(parts: readonly Morphing<unknown>[], combine: (ends: readonly unknown[]) => T): Morphing<T> {
    const moving = parts.find((part): part is Morph<unknown> => part instanceof Morph);
    const end = (which: "from" | "to") => combine(parts.map((part) => (part instanceof Morph ? part[which] : part)));
    return moving ? new Morph(end("from"), end("to"), moving.t) : end("to");
}

const { start: _start, end: _end, ...glyphPaint } = Paint.state;

/** What every formula has: the glyphs' paint, the flow its children are laid out in, its size, its part fills and how much of it is written. */
export const TYPESET = {
    // A formula writes itself on (`written`), so it trims no outline.
    ...glyphPaint,
    ...Flow.state,
    fontSize: 16,
    /** Paints for parts of the formula, named by their source. Later entries win where two name a glyph. */
    partFills: Types.custom<PartFill[], PartFillResolved[]>([], { resolve: readPartFills, lerp: lerpPartFills, kind: "vector" }),
    /**
     * How much of the formula is written, 0 to 1: its glyphs are drawn one after
     * another, each outlined and then filled.
     */
    written: Types.number(1, { min: 0, max: 1, step: 0.01 }),
    /** Reported for a host that read it; the morph is held by the formula's own entries. */
    morphProgress: Types.number(0, { animatable: false }),
};

export const TYPESET_COMMANDS = {
    ...omit(Paint.commands, "progressTo", "flash"),
    ...commandsFor(TYPESET, {
        /** Write the formula on, or off: its glyphs one after another, each outlined and then filled. */
        writeTo: { args: ["written"] },
        /** Paint one part of the formula, leaving the rest as it is. */
        partFillTo: {
            args: {
                part: Types.text(""),
                fill: Types.custom<Fill>("#facc15", { kind: "fills" }),
                occurrence: Types.number(0, { min: 0, step: 1 }),
            },
            run: (timeline, s) => {
                const { part, fill, occurrence } = timeline.args;
                if (!part || fill == null) return timeline.tween({});
                return timeline.tween({ partFills: withPartFill(s.partFills, { part, fill, occurrence }) });
            },
        },
    }),
};

type TypesetValues = Values<typeof TYPESET>;

// ---- the formula at a moment ------------------------------------------------

/** What is drawn of a formula now: its glyphs, its parts, its centre frame and size, and mid-morph each end's part fills. */
export interface FormulaFrame {
    readonly tokens: readonly AnimatedToken[];
    readonly parts: readonly LatexPart[];
    readonly bounds: [number, number, number, number];
    readonly width: number;
    readonly height: number;
    readonly morph: { readonly from: TokenFills; readonly to: TokenFills; readonly t: number } | null;
}

/** One part fill per token, or none: the last entry that names it. */
type TokenFills = (PartFillResolved | undefined)[];

const EMPTY: FormulaFrame = { tokens: [], parts: [], bounds: [0, 0, 0, 0], width: 0, height: 0, morph: null };

/** A formula at rest: blank while MathJax is on its way, and asked again next time. A malformed one throws, every time. */
function atRest(source: string, fontSize: number): FormulaFrame {
    if (!source) return EMPTY;
    let result: LatexPathResult;
    try {
        result = buildLatexPath(source, fontSize);
    } catch (error) {
        if (error instanceof LatexNotLoaded) return EMPTY;
        throw error;
    }
    return restingFrame(result);
}

const resting = new WeakMap<LatexToken[], FormulaFrame>();

function restingFrame(result: LatexPathResult): FormulaFrame {
    // The typeset result is shared by every reader of the formula; its tokens wrapped once.
    let frame = resting.get(result.tokens);
    if (!frame) {
        frame = {
            tokens: result.tokens.map((t) => ({ token: t.token, path: t.path, term: t.term, opacity: 1, x: 0, y: 0 })),
            parts: result.parts,
            bounds: result.bounds,
            width: result.width,
            height: result.height,
            morph: null,
        };
        resting.set(result.tokens, frame);
    }
    return frame;
}

/** Where a morph goes: typeset even when empty, and blank before MathJax. */
function target(source: string, fontSize: number): LatexPathResult {
    try {
        return buildLatexPath(source, fontSize);
    } catch (error) {
        if (!(error instanceof LatexNotLoaded)) throw error;
        return blankLatex();
    }
}

const NUL = String.fromCharCode(0);
const morphs = createBoundedCache<(t: number) => AnimatedToken[]>(16);
let lastMorph: { key: string; t: number; tokens: AnimatedToken[] } | null = null;

/** The formula drawn now, from where it comes from: at rest, or `t` of the way through a morph. */
export function formulaFrame(
    source: Morphing<string>,
    fontSize: number,
    partFills: readonly PartFillResolved[],
    morph: LatexMorphStrategy = defaultLatexMorph,
): FormulaFrame {
    if (!(source instanceof Morph)) return atRest(source, fontSize);
    const from = atRest(source.from, fontSize);
    const to = target(source.to, fontSize);
    const { t } = source;
    const key = `${fontSize}${NUL}${source.from}${NUL}${source.to}`;
    let frame = morph === defaultLatexMorph ? morphs.get(key) : undefined;
    if (!frame) {
        frame = morph(from.tokens.map((token) => ({ token: token.token, path: token.path, term: token.term })), to.tokens);
        if (morph === defaultLatexMorph) morphs.set(key, frame);
    }
    // Measured and drawn in one frame: the glyphs are worked out once.
    const tokens = lastMorph && lastMorph.key === key && lastMorph.t === t && morph === defaultLatexMorph ? lastMorph.tokens : frame(t);
    if (morph === defaultLatexMorph) lastMorph = { key, t, tokens };
    return {
        tokens,
        parts: [],
        bounds: [
            lerpNumber(from.bounds[0], to.bounds[0], t),
            lerpNumber(from.bounds[1], to.bounds[1], t),
            lerpNumber(from.bounds[2], to.bounds[2], t),
            lerpNumber(from.bounds[3], to.bounds[3], t),
        ],
        width: lerpNumber(from.width, to.width, t),
        height: lerpNumber(from.height, to.height, t),
        morph: {
            from: fillsByToken(partFills, from.parts, from.tokens.length),
            to: fillsByToken(partFills, to.parts, to.tokens.length),
            t,
        },
    };
}

// ---- measuring, laying out, loading -----------------------------------------

/** Its formula's size and its padding, hugging; the factory applies a set or filling size. */
export function measureFormula(frame: FormulaFrame, s: { readonly padding: InsetsResolved }): Size2D {
    const pad = s.padding;
    return { width: frame.width + pad.left + pad.right, height: frame.height + pad.top + pad.bottom };
}

/** Its children, laid out in its box clear of its stroke, as a shape lays out its own. */
export function layoutFormula(box: BoxBounds, s: Flow.FlowState & { readonly stroke: StrokeResolved[] }, children: readonly ChildView<any>[]): readonly Placement2D[] {
    return Flow.layout(box, s, children, strokeInset(s.stroke));
}

function strokeInset(stroke: readonly StrokeResolved[]) {
    let extra = 0;
    for (const layer of stroke) {
        const intrusion = layer.weight * (1 - layer.align) / 2;
        if (intrusion > extra) extra = intrusion;
    }
    return { left: extra, right: extra, top: extra, bottom: extra };
}

/** MathJax, before this node is laid out: a scene with no formula in it never loads it. */
export function loadFormula(loader: Loader): void {
    loader.task(MATHJAX_LOADER, loadMathJax, { before: "layout" });
}

// ---- drawing ------------------------------------------------------------------

/** How much of one glyph's writing overlaps the next one's. */
const WRITE_OVERLAP = 0.6;
/** The outline a glyph is written with, as a share of the type size. */
const WRITE_STROKE = 1 / 32;

/**
 * The glyphs, in a node's paint order: each one's shadow, fill and stroke
 * (the shadow op first, so the paint after it casts it), the pen's line while
 * it is being written, then the children, then the overlay through the glyphs.
 */
export function drawFormula(ctx: RenderContext, s: TypesetValues, frame: FormulaFrame): void {
    ctx.inFront(() => drawGlyphs(ctx, s, frame));
    ctx.children();
    ctx.inFront(() => drawOverlay(ctx, s, frame));
}

function drawGlyphs(ctx: RenderContext, s: TypesetValues, frame: FormulaFrame): void {
    const fills = s.fill as FillResolved[];
    const shadows = s.shadow as ShadowResolved[];
    const stroke = s.stroke as StrokeResolved[];
    const partOf = tokenFills(frame, s.partFills);
    const writing = writingOf(s.written, frame.tokens.length);
    eachToken(ctx, frame, (graphics, opacity, index, token) => {
        const fill = partPaint(fills, partOf(index, token));
        const pen = writing?.(index);
        if (!pen) {
            return graphics
                .shadow(scaleShadowOpacity(shadows, opacity))
                .fill(scaleFillopacity(fill, opacity))
                .stroke(stroke);
        }
        if (pen.filled <= 0) return null;
        return graphics
            .shadow(scaleShadowOpacity(shadows, opacity * pen.filled))
            .fill(scaleFillopacity(fill, opacity * pen.filled))
            .stroke(stroke);
    });
    if (!writing) return;
    // The pen's line: each glyph's outline, in its own colour, ahead of its fill.
    eachToken(ctx, frame, (graphics, opacity, index, token) => {
        const pen = writing(index);
        if (!pen || pen.filled >= 1 || pen.outlined <= 0) return null;
        const fill = scaleFillopacity(partPaint(fills, partOf(index, token)), opacity * (1 - pen.filled));
        return graphics.stroke(stroke.length > 0 ? stroke : penStroke(s.fontSize * WRITE_STROKE, fill));
    }, (index) => writing(index)?.outlined ?? 1);
}

/** The overlay, painted through the glyphs: a formula has no one silhouette to fill. */
function drawOverlay(ctx: RenderContext, s: TypesetValues, frame: FormulaFrame): void {
    const overlay = s.overlay as FillResolved[];
    if (overlay.length === 0) return;
    const writing = writingOf(s.written, frame.tokens.length);
    eachToken(ctx, frame, (graphics, opacity, index) => {
        const filled = writing?.(index).filled ?? 1;
        return filled <= 0 ? null : graphics.fill(scaleFillopacity(overlay, opacity * filled));
    });
}

/** Each token's part fill: by its place in the formula at rest, by both ends' mid-morph. */
function tokenFills(frame: FormulaFrame, partFills: readonly PartFillResolved[]): (index: number, token: AnimatedToken) => PartFillResolved | undefined {
    const morph = frame.morph;
    if (morph) {
        return (_index, token) => {
            const a = token.from === undefined ? undefined : morph.from[token.from];
            const b = token.to === undefined ? undefined : morph.to[token.to];
            if (a && b) return { ...b, fill: fillOps.lerp(a.fill, b.fill, morph.t), mix: lerpNumber(a.mix, b.mix, morph.t) };
            if (a) return token.to === undefined ? a : { ...a, mix: a.mix * (1 - morph.t) };
            if (b) return token.from === undefined ? b : { ...b, mix: b.mix * morph.t };
            return undefined;
        };
    }
    if (partFills.length === 0) return () => undefined;
    const byToken = fillsByToken(partFills, frame.parts, frame.tokens.length);
    return (index) => byToken[index];
}

/**
 * How far each glyph is written at `written`: its outline first, then its fill,
 * each glyph starting before the one ahead of it is done. `null` once the whole
 * formula is.
 */
function writingOf(written: number, count: number): ((index: number) => { outlined: number; filled: number }) | null {
    if (written >= 1) return null;
    const lead = 1 - WRITE_OVERLAP;
    const span = 1 / (1 + Math.max(0, count - 1) * lead);
    return (index) => {
        const p = Math.min(1, Math.max(0, (written - index * span * lead) / span));
        return { outlined: Math.min(1, p * 2), filled: Math.max(0, p * 2 - 1) };
    };
}

/**
 * Every visible token's path once, each handed to `paint` to have its paint
 * ops appended: a fresh `Graphics2D` per token per pass, since paint ops
 * accumulate on the one they are added to.
 */
function eachToken(
    ctx: RenderContext,
    frame: FormulaFrame,
    paint: (graphics: Graphics2D, opacity: number, index: number, token: AnimatedToken) => Graphics2D | null,
    drawn: (index: number) => number = () => 1,
): void {
    frame.tokens.forEach((token, index) => {
        if (token.opacity <= 0) return;
        const pathStr = token.x !== 0 || token.y !== 0
            ? toPathString(offsetPath(token.path, token.x, token.y))
            : toPathString(token.path);
        const painted = paint(new Graphics2D()
            .path({
                data: pathStr,
                start: 0,
                end: 1 * drawn(index),
                // All tokens share one centre frame, so they keep their relative layout.
                centerBounds: frame.bounds,
            }), token.opacity, index, token);
        if (painted) ctx.draw(painted);
    });
}

// ---- parts --------------------------------------------------------------------

/**
 * The box around one part of the formula, centred on the node's own centre and
 * y-up, or `null` when the formula does not write `part` (or is mid-morph).
 * `occurrence` counts from 1.
 */
export function partBoundsIn(frame: FormulaFrame, part: string, occurrence = 1): BoxBounds | null {
    const span = findLatexParts(frame.parts, part)[Math.max(1, Math.round(occurrence)) - 1];
    if (!span) return null;
    const box = pathOps.bounds(frame.tokens.slice(span[0], span[1]).flatMap((token) => token.path));
    if (!box) return null;
    const [minX, minY, maxX, maxY] = frame.bounds;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return {
        x: (box.minX + box.maxX) / 2 - cx,
        y: cy - (box.minY + box.maxY) / 2,
        width: box.maxX - box.minX,
        height: box.maxY - box.minY,
    };
}

/** Where a node's formula comes from, by the class its component generated. */
type SourceOf = (values: never) => Morphing<string>;
const sources = new WeakMap<object, SourceOf>();

/** Declare `component` a formula written from `source`: a mark can then point at its parts. */
export function formula<C extends { readonly node: object }>(component: C, source: SourceOf): C {
    sources.set(component.node, source);
    return component;
}

/** Whether `node` draws a formula, and so has parts a mark can point at. */
export function isFormula(node: object): boolean {
    return sources.has((node as { constructor: object }).constructor);
}

/** The formula `node` draws now, or `null` when it is no formula. */
export function formulaOf(node: object): FormulaFrame | null {
    const source = sources.get((node as { constructor: object }).constructor);
    if (!source) return null;
    const values = node as unknown as TypesetValues;
    return formulaFrame(source(values as never), values.fontSize, values.partFills);
}

/** The box around a part of the formula `node` draws (see {@link partBoundsIn}); `undefined` when it is no formula. */
export function latexPartBounds(node: object, part: string, occurrence = 1): BoxBounds | null | undefined {
    const frame = formulaOf(node);
    return frame ? partBoundsIn(frame, part, occurrence) : undefined;
}

// ---- paint helpers ------------------------------------------------------------

function fillsByToken(partFills: readonly PartFillResolved[], parts: readonly LatexPart[], count: number): TokenFills {
    const out: TokenFills = new Array(count);
    for (const entry of partFills) {
        if (entry.part.trim() === "") continue;
        const spans = findLatexParts(parts, entry.part);
        for (const [from, to] of entry.occurrence > 0 ? spans.slice(entry.occurrence - 1, entry.occurrence) : spans) {
            for (let i = from; i < to && i < count; i++) out[i] = entry;
        }
    }
    return out;
}

function penStroke(weight: number, fill: FillResolved[]): StrokeResolved[] {
    return [{ weight, fill, dashOffset: 0, align: 0, cap: "round", capScale: 4, join: "round", miterLimit: 4 }];
}

function scaleFillopacity(fills: FillResolved[], opacity: number): FillResolved[] {
    if (opacity >= 1) return fills;
    return fills.map((f) => ({ ...f, opacity: (f.opacity ?? 1) * opacity }));
}

/** A fading token's shadow fades with it, as its fill does. */
function scaleShadowOpacity(shadows: ShadowResolved[], opacity: number): ShadowResolved[] {
    if (opacity >= 1) return shadows;
    return shadows.map((s) => ({ ...s, fill: scaleFillopacity(s.fill, opacity) }));
}

function offsetPath(path: LatexToken["path"], dx: number, dy: number): LatexToken["path"] {
    return path.map((cmd) => {
        const c = cmd as any;
        const shifted: any = { ...c };
        if ("x" in c) shifted.x = c.x + dx;
        if ("y" in c) shifted.y = c.y + dy;
        if ("x1" in c) { shifted.x1 = c.x1 + dx; shifted.y1 = c.y1 + dy; }
        if ("x2" in c) { shifted.x2 = c.x2 + dx; shifted.y2 = c.y2 + dy; }
        return shifted;
    });
}

export type { TypesetValues };
