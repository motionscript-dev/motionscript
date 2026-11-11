import type { FontStyle, TextAlign, TextDecoration, VerticalAlign } from "@/attributes/text/types";
import { FillResolved } from "@/attributes/shape/fill/union";
import { StrokeResolved } from "@/attributes/shape/stroke/stroke";
import { PathData } from "./path";
import { ShapeAlignmentInput, ShapeState, resolveShapeAlignment, resolveShapePivot, stripShapeAlignmentKeys } from "./shape";
import { hostTextFamily } from "@/components/builtins/text/text-defaults";

/** Size a segmented block's pieces shape at on an `'autofit'` node: the layout probes with it, since no single piece can be asked for the size the block settles on. */
export const AUTOFIT_PROBE_SIZE = 100;

/**
 * One contiguous piece of a Text node split at run boundaries, carrying its shaping inputs (`text` plus the five
 * font fields) and per-run draw-time overrides: `opacity` folded into paint alpha, optional `fill`/`stroke`
 * (falling back to the node's), and a transform about the run's centred position. Present only when a Text node
 * has styled runs or a reveal window. An absent optional font field means "the node's own", resolved where the paragraph is built.
 */
export interface TextSegment {
    text: string;
    fontFamily?: string;
    fontSize?: number;
    fontStyle?: FontStyle;
    fontWeight: number;
    letterSpacing: number;
    textDecoration?: TextDecoration;
    opacity: number;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    fill?: FillResolved[];
    stroke?: StrokeResolved[];
}

export interface TextState extends ShapeState {
    text: string;
    /** Typography preset key (`theme.typography`), as a `Text` node's `variant`. Resolved at draw (a drawn op has no bind step): above the enclosing `<DefaultTextStyle>`, below anything the op states. Unresolved names are ignored so a renamed preset loses styling rather than failing to draw. */
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
    /** Per-piece overrides for styled runs: shaped together as one paragraph, each shaped run painted with its piece's overrides instead of the node's single fill. */
    segments?: TextSegment[];
    /** Wraps the text around this path (text-on-path): glyphs follow it, centred on their baseline, and glyphs past the end are clipped. Mutually exclusive with `segments` in v1. */
    path?: PathData | null;
}


/**
 * The family this text is set in: the last rung of the cascade, and the only one that can refuse. The engine never
 * substitutes a face of its own (that would hide a font that was never declared, and so never loaded); it falls
 * back to {@link hostTextFamily}, a face the application named once at its composition root, else throws. By here
 * the op/prop, `variant` preset, enclosing `<DefaultTextStyle>` and theme `default` preset were all silent, hence
 * the message naming them.
 *
 * Exported so the measure path enforces the same policy: shaping to measure happens before any op is validated and
 * the shaper reads `.length` off each family name, so a missing family would otherwise die inside the wasm naming no scene, node or prop.
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
