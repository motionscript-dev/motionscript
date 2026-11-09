import type { FontStyle, TextAlign, TextDecoration, VerticalAlign } from "@/attributes/text/types";
import { FillResolved } from "@/attributes/shape/fill/union";
import { StrokeResolved } from "@/attributes/shape/stroke/stroke";
import { PathData } from "./path";
import { ShapeAlignmentInput, ShapeState, resolveShapeAlignment, resolveShapePivot, stripShapeAlignmentKeys } from "./shape";
import { hostTextFamily } from "@/components/builtins/text/text-defaults";

/**
 * The size a segmented block's pieces shape at on an `'autofit'` node: the
 * size the layout probes with, since no single piece can be asked for the
 * size the block settles on.
 */
export const AUTOFIT_PROBE_SIZE = 100;

/**
 * One contiguous piece of a Text node split at run boundaries. Pieces
 * carry their effective shaping inputs (`text` plus the five font fields) and
 * draw-time overrides applied per shaped run: `opacity` folded into the paint
 * alpha, an optional `fill`/`stroke` override (falls back to the node's when
 * omitted), and a transform applied about the run's centered position.
 *
 * Present only when a Text node has styled runs or a reveal window; otherwise
 * the node renders as a single string with no segments.
 *
 * **Every shaping field is stated, none inherited at draw time.** `fontFamily`,
 * `fontSize` and `fontStyle` joined `fontWeight` and `letterSpacing` here so a
 * run can change its *face* and not only its weight — which is
 * what an editor built on this needs to offer per-character styling at all. The
 * paragraph builder already takes all five per run (it is what `RichText` sets),
 * so the cost of the three is a wider segment and nothing else.
 *
 * They are optional only so an older caller's segments still lay out: absent
 * means "the node's own", resolved where the paragraph is built rather than
 * left for the renderer to guess.
 */
export interface TextSegment {
    text: string;
    /** Override family for this piece; falls back to the node's when undefined. */
    fontFamily?: string;
    /** Override size for this piece; falls back to the node's when undefined. */
    fontSize?: number;
    /** Override slant for this piece; falls back to the node's when undefined. */
    fontStyle?: FontStyle;
    fontWeight: number;
    letterSpacing: number;
    /** Override decoration for this piece; falls back to the node's when undefined. */
    textDecoration?: TextDecoration;
    opacity: number;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    /** Override fill for this piece; falls back to the node's fill when undefined. */
    fill?: FillResolved[];
    /** Override stroke for this piece; falls back to the node's stroke when undefined. */
    stroke?: StrokeResolved[];
}

/**
 * Whether `segment` only *styles* its characters — no transform of its own.
 *
 * The caret model can describe a segmented block exactly as long as this holds
 * of every piece: differently-styled runs are still one paragraph, laid out and
 * measured together, so the shaper's own rects for each character are where the glyphs
 * are. A piece that is *moved*, turned or scaled about its own centre is not in
 * that paragraph's space any more, and a slot measured from it would point at
 * where the character would have been. See `textBlockLayout`, which is the one
 * caller and turns a false here into "no caret model for this shape".
 */
export function isStyleOnlySegment(segment: TextSegment): boolean {
    return segment.x === 0 && segment.y === 0
        && segment.scale === 1 && segment.rotation === 0;
}

export interface TextState extends ShapeState {
    text: string;
    /**
     * A named typography preset to shape against — `theme.typography`'s key, the
     * same one a `Text` node's `variant` prop selects.
     *
     * A node reads its variant once, at bind; a drawn op has no bind step, so it
     * is resolved at draw alongside the inherited defaults (see
     * `applyGraphicsTextDefaults`). It sits *between* the two: above the
     * enclosing `<DefaultTextStyle>`, below anything the op states itself.
     *
     * Optional, and unresolved names are ignored rather than an error — a scene
     * that renames a preset should lose the styling, not fail to draw.
     */
    variant?: string;
    fontSize: number | 'autofit';
    fontFamily: string;
    fontWeight: number;
    fontStyle: FontStyle;
    letterSpacing: number;
    lineHeight: number;
    textAlign: TextAlign;
    /** Where the block sits in a box taller or shorter than it; only a `height` gives it one. */
    verticalAlign: VerticalAlign;
    textDecoration: TextDecoration;
    wrap: boolean;
    minFontSize: number;
    width: number;
    height: number;
    /**
     * Per-piece overrides when the node has styled runs. When set,
     * the renderer shapes these pieces together (one paragraph) and paints each
     * shaped run with its piece's overrides instead of the node's single fill.
     */
    segments?: TextSegment[];
    /**
     * When set, the text is wrapped around this path (text-on-path) instead of
     * laid out as straight lines: each glyph is positioned and rotated to follow
     * the path, centered on its baseline, and glyphs past the path end are
     * clipped. Mutually exclusive with `segments` in v1.
     */
    path?: PathData | null;
}


/**
 * The family this text is set in — the last rung of the cascade, and the only
 * one that can refuse.
 *
 * It used to fall back to `"Arial"`, which is the wrong shape of answer for a
 * renderer whose whole job is that the picture is the one that was asked for:
 * substituting a face the *engine* picked produces text in a typeface the author
 * never chose, at metrics they never measured, in a frame that looks finished,
 * and hides a font that was never declared and so never loaded.
 *
 * What it falls back to instead is {@link hostTextFamily} — a face the
 * **application** named, once, at its composition root, out of the fonts it
 * actually vendors. That is a different bargain: a host that ships a typeface
 * registers it in every manifest, so a chart axis that nobody styled comes out
 * in it and paints glyphs, while the engine still refuses to invent a face of
 * its own. A host that declares nothing gets the error below, which is the right
 * answer for a headless render whose fonts all come from a manifest.
 *
 * By the time an op reaches here the whole ladder above has been walked — the op
 * or prop itself, a `variant` preset, the enclosing `<DefaultTextStyle>`, then
 * the theme's `default` typography preset — so this is only ever reached when
 * every one of them was silent. The message names them because "no font family"
 * is not actionable and "set one on the text, on a DefaultTextStyle, or as the
 * theme's default preset" is.
 *
 * Exported so the **measure** path enforces the same policy from the same
 * definition. Shaping a paragraph to measure it happens before any op is
 * validated, and the shaper reads `.length` off every family name — so text with no
 * family used to die inside the wasm with `Cannot read properties of undefined`,
 * naming no scene, node or prop, while the identical case at draw time produced
 * the message above. One policy, two verdicts, and the useless one came first.
 */
export function requireFontFamily(descriptor: { fontFamily?: string; text?: string }): string {
    const family = descriptor.fontFamily;
    if (typeof family === "string" && family !== "") return family;
    const host = hostTextFamily();
    if (host !== "") return host;
    const text = descriptor.text ? ` drawing "${descriptor.text.slice(0, 32)}"` : "";
    throw new Error(
        `Text${text} has no fontFamily. Set one on the text itself, on an `
        + `enclosing <DefaultTextStyle>, or as the theme's \`default\` typography `
        + `preset — there is no fallback face.`,
    );
}

export function withTextDescriptor(descriptor: Partial<TextState> & ShapeAlignmentInput): TextState {
    const width = descriptor.width ?? 0;
    const height = descriptor.height ?? 0;
    const { x, y, pivot } = resolveShapeAlignment(descriptor, width, height);
    return {
        ...stripShapeAlignmentKeys(descriptor),
        opacity: descriptor.opacity ?? 1,
        rotation: descriptor.rotation ?? 0,
        scale: descriptor.scale ?? 1,
        x,
        y,
        start: descriptor.start ?? 0,
        end: descriptor.end ?? 1,
        pivot: resolveShapePivot(pivot),
        text: descriptor.text ?? "",
        fontSize: descriptor.fontSize ?? 48,
        fontFamily: requireFontFamily(descriptor),
        fontWeight: descriptor.fontWeight ?? 400,
        fontStyle: descriptor.fontStyle ?? 'normal',
        letterSpacing: descriptor.letterSpacing ?? 0,
        lineHeight: descriptor.lineHeight ?? 0,
        textAlign: descriptor.textAlign ?? 'center',
        verticalAlign: descriptor.verticalAlign ?? 'center',
        textDecoration: descriptor.textDecoration ?? 'none',
        wrap: descriptor.wrap ?? false,
        minFontSize: descriptor.minFontSize ?? 12,
        width: descriptor.width ?? 0,
        height: descriptor.height ?? 0,
        segments: descriptor.segments,
        path: descriptor.path ?? null,
    };
}
