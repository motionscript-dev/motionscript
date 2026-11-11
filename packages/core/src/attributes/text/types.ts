/** The text attribute's types. A `TextSpan` is what an author writes and a `ResolvedTextSpan` what a renderer reads; a `TextStyle` is the partial style every source of text defaults speaks (`<DefaultTextStyle>`, a `variant` preset, `theme.typography`). */
import type { Fill } from "@/attributes/shape/fill/chain";
import type { FillResolved } from "@/attributes/shape/fill/union";
import type { Stroke, StrokeResolved } from "@/attributes/shape/stroke/stroke";
import type { Shadow } from "@/attributes/shape/shadow/shadow";

export type TextAlign = 'left' | 'right' | 'center' | 'justify' | 'start' | 'end';

/** Where a block shorter (or taller) than its box sits in it. */
export type VerticalAlign = 'top' | 'center' | 'bottom';

export type TextDecoration = 'none' | 'underline' | 'line-through';

/** `'title'` capitalises the first letter of each word and leaves the rest as typed. */
export type TextCase = 'none' | 'upper' | 'lower' | 'title';

export type FontStyle = 'normal' | 'italic' | 'oblique';

/** A styled run of text. Spans nest: children inherit the parent's style fields and override those they redeclare (Flutter-style). A span with `children` and no `text` is a pure style scope; with both, its `text` comes before its children. */
export interface TextSpan {
    text?: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: FontStyle;
    letterSpacing?: number;
    fill?: Fill;
    stroke?: Stroke;
    children?: TextSpan[];
}

/** A span flattened against its parents: every style field concrete, fills/strokes resolved. Newlines are preserved; the renderer splits on `\n`. */
export interface ResolvedTextSpan {
    text: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    fontStyle: FontStyle;
    letterSpacing: number;
    fill: FillResolved[];
    stroke: StrokeResolved[];
}

/** A stretch of a `Text` node's string set apart from the rest: `[start, end)` offsets, an absent field being the node's own. */
export interface TextRun {
    start: number;
    end: number;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: FontStyle;
    letterSpacing?: number;
    textDecoration?: TextDecoration;
    fill?: Fill;
    stroke?: Stroke;
}

/** A {@link TextRun} with its paints resolved. */
export interface ResolvedTextRun extends Omit<TextRun, "fill" | "stroke"> {
    fill?: FillResolved[];
    stroke?: StrokeResolved[];
}

/** A text node's style vocabulary: each field is the loose author-facing type of the matching `Text` prop, optional so a descendant inherits exactly the keys a source sets. */
export interface TextStyle {
    fontFamily?: string;
    fontSize?: number | 'autofit';
    fontWeight?: number;
    fontStyle?: FontStyle;
    letterSpacing?: number;
    lineHeight?: number;
    textAlign?: TextAlign;
    fill?: Fill;
    stroke?: Stroke;
    shadow?: Shadow;
}

/** A {@link TextStyle} key that shapes text rather than paints it. */
export type TextShapingKey = Exclude<keyof TextStyle, "fill" | "stroke" | "shadow">;
