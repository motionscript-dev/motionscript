import type { AssetScope } from "@/assets/scope";
import type { Size2D, SizeInput } from "@/attributes/layout/size";
import type { FillResolved } from "@/attributes/shape/fill/union";
import { pathOps } from "@/attributes/shape/path/ops";
import type { StrokeResolved } from "@/attributes/shape/stroke/stroke";
import { textOps } from "@/attributes/text/ops";
import type {
    FontStyle, ResolvedTextRun, ResolvedTextSpan, TextAlign, TextCase, TextDecoration, TextSpan, VerticalAlign,
} from "@/attributes/text/types";
import type { RichTextState } from "@/render/descriptors/richtext";
import type { SizeConstraints } from "@/layout/constraints";
import type { PathData } from "@/render/descriptors/path";
import type { TextSegment, TextState } from "@/render/descriptors/text";
import type { MeasureContext2D } from "@/render/measure-context";
import { AUTOFIT_PROBE_SIZE } from "@/render/descriptors/text";

/**
 * Setting a string in a face: measuring the block, cutting it into styled
 * pieces, and the descriptor it draws as. Plain functions over resolved values,
 * behind the components' `TextLayout` module.
 */

/** The shaping fields a glyph node reads, resolved. */
export interface TextValues {
    readonly fontFamily: string;
    readonly fontSize: number | "autofit";
    readonly fontWeight: number;
    readonly fontStyle: FontStyle;
    readonly letterSpacing: number;
    readonly lineHeight: number;
    readonly textAlign: TextAlign;
    readonly verticalAlign: VerticalAlign;
    readonly textDecoration: TextDecoration;
    readonly textCase: TextCase;
    readonly minFontSize: number;
    readonly fill: unknown;
    readonly stroke: unknown;
    readonly start: number;
    readonly end: number;
    readonly width: SizeInput;
    readonly height: SizeInput;
}

/** Where the string comes from, and what styles parts of it. */
export interface TextSource {
    readonly text: string;
    readonly wraps: boolean;
    /** The path the glyphs ride, for text-on-path. */
    readonly glyphPath: PathData | null;
    /** Stretches a document styles apart from the node: `Text`'s `runs`. */
    readonly runs: readonly ResolvedTextRun[];
}

export function casedText(s: TextValues, src: TextSource): string {
    return textOps.applyCase(src.text, s.textCase);
}

/** The block's size: hugged to its glyphs, filled across, and its own height even when it fills, so a hugging ancestor sees its content. */
export function measureGlyphs(s: TextValues, src: TextSource, constraints: SizeConstraints, scope: MeasureContext2D): Size2D {
    // Text-on-path: the visual extent is the path's bounding box, not a text
    // line box. Size the node to the path (node-local coords, like Path).
    if (src.glyphPath != null) {
        const { width, height } = pathOps.size(src.glyphPath);
        const wm = s.width;
        const hm = s.height;
        return {
            width: typeof wm === "number" ? wm : wm === "hug" ? width : (constraints.maxWidth ?? width),
            height: typeof hm === "number" ? hm : hm === "hug" ? height : (constraints.maxHeight ?? height),
        };
    }

    const measureFontSize = s.fontSize === "autofit" ? 16 : s.fontSize;
    const paragraphs = casedText(s, src).split("\n");

    // A styled run changes the box, which is why measuring cannot read the
    // node's five font fields and stop there: one word set two sizes up makes
    // the line taller and the block wider. So when runs are styled the
    // intrinsic size is summed across the pieces, each in its own style.
    const styled = textSegments(s, src);
    const lineStyles = styled === null
        ? null
        : measureStyledLines(styled, {
            fontFamily: s.fontFamily,
            fontSize: measureFontSize,
            fontStyle: s.fontStyle,
            fontWeight: s.fontWeight,
            letterSpacing: s.letterSpacing,
        });

    const lineH = measureFontSize * s.lineHeight;
    const intrinsicW = lineStyles
        ? Math.max(...lineStyles.map(line => line.runs.reduce(
            (w, run) => w + scope.measureText(run.text, run.fontSize, run.fontFamily, run.fontWeight, run.letterSpacing, run.fontStyle).width,
            0,
        )))
        : Math.max(...paragraphs.map(l => scope.measureText(l, measureFontSize, s.fontFamily, s.fontWeight, s.letterSpacing, s.fontStyle).width));

    const wm = s.width;
    const hm = s.height;
    const resolvedW = typeof wm === "number" ? wm : wm === "hug" ? intrinsicW : constraints.maxWidth ?? 0;

    // When wrap is on and the box has a finite width narrower than the text,
    // height needs to account for the extra lines produced by wrapping. Each
    // line is as tall as its tallest run.
    const wraps = src.wraps && resolvedW > 0;
    const lineSizes = lineStyles === null
        ? null
        : wraps
            ? wrappedLineSizes(lineStyles, resolvedW, scope)
            : lineStyles.map(line => Math.max(...line.runs.map(run => run.fontSize)));
    const intrinsicH = lineSizes
        ? lineSizes.reduce((h, size) => h + size * s.lineHeight, 0)
        : (wraps
            ? paragraphs.reduce((n, p) => n + countWrappedLines(p, resolvedW, measureFontSize, s.fontFamily, s.fontWeight, scope, s.letterSpacing, s.fontStyle), 0)
            : paragraphs.length) * lineH;

    return { width: resolvedW, height: typeof hm === "number" ? hm : intrinsicH };
}

/**
 * The string cut at every style boundary, each piece styled by the runs over
 * it, the later winning. Also folds in the Write On reveal window. `null` when neither is
 * active, so rendering keeps its single-op path; and always `null` on a path,
 * where the string is laid along it as one run.
 */
export function textSegments(s: TextValues, src: TextSource): TextSegment[] | null {
    if (src.glyphPath != null) return null;
    const runs = src.runs.filter(r => r.end > r.start);
    const text = casedText(s, src);
    if (text.length === 0) return null;

    // Write On: a glyph has no path to trim, so `start`/`end` are a
    // character-reveal window instead: opacity over a range of characters.
    const hasReveal = s.start > 0 || s.end < 1;
    if (runs.length === 0 && !hasReveal) return null;

    // A hard cut at whole characters, one at a time, the way DaVinci's Write On does.
    const revealStart = Math.round(s.start * text.length);
    const revealEnd = Math.round(s.end * text.length);

    // `'autofit'` settles on a size the block is measured into, which no single
    // piece can be asked for, so pieces shape at the probe size.
    const nodeFontSize = typeof s.fontSize === "number" ? s.fontSize : AUTOFIT_PROBE_SIZE;
    const fill = s.fill as FillResolved[];
    const stroke = s.stroke as StrokeResolved[];

    const cuts = new Set<number>([0, text.length]);
    for (const run of runs) { cuts.add(run.start); cuts.add(run.end); }
    if (hasReveal) {
        cuts.add(revealStart);
        cuts.add(revealEnd);
    }
    const points = [...cuts].filter(c => c >= 0 && c <= text.length).sort((a, b) => a - b);

    const segments: TextSegment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        if (end <= start) continue;

        // Every shaping field is stated, so the paragraph builder and the caret
        // read a piece the same way.
        const seg: TextSegment = {
            text: text.slice(start, end),
            fontFamily: s.fontFamily,
            fontSize: nodeFontSize,
            fontStyle: s.fontStyle,
            fontWeight: s.fontWeight,
            letterSpacing: s.letterSpacing,
            textDecoration: s.textDecoration,
            opacity: 1,
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            fill,
            stroke,
        };

        for (const run of runs) {
            if (start < run.start || end > run.end) continue;
            if (run.fontFamily !== undefined) seg.fontFamily = run.fontFamily;
            if (run.fontSize !== undefined) seg.fontSize = run.fontSize;
            if (run.fontStyle !== undefined) seg.fontStyle = run.fontStyle;
            if (run.fontWeight !== undefined) seg.fontWeight = run.fontWeight;
            if (run.letterSpacing !== undefined) seg.letterSpacing = run.letterSpacing;
            if (run.textDecoration !== undefined) seg.textDecoration = run.textDecoration;
            if (run.fill !== undefined) seg.fill = run.fill;
            if (run.stroke !== undefined) seg.stroke = run.stroke;
        }

        if (hasReveal && !(start >= revealStart && end <= revealEnd)) seg.opacity = 0;
        segments.push(seg);
    }
    return segments;
}

/** The descriptor the block draws as, in a box of `size`. Picking's caret geometry reads the same one. */
export function textState(s: TextValues, src: TextSource, size: Size2D | undefined): Partial<TextState> {
    return {
        text: casedText(s, src),
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        fontStyle: s.fontStyle,
        letterSpacing: s.letterSpacing,
        lineHeight: s.lineHeight,
        textAlign: s.textAlign,
        verticalAlign: s.verticalAlign,
        textDecoration: s.textDecoration,
        wrap: src.wraps,
        minFontSize: s.minFontSize,
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        segments: textSegments(s, src) ?? undefined,
        path: src.glyphPath,
    };
}

/**
 * The node's own face, plus whatever a piece sets in another, and the pieces'
 * paints. Naming a family here is what lets it load before layout, rather than
 * being discovered by measuring against the fallback face.
 */
export function declareGlyphAssets(s: TextValues, src: TextSource, assets: Pick<AssetScope, "font" | "fill">): void {
    // Nothing may name a family at all; an `undefined` key is not a font to load.
    if (s.fontFamily) assets.font(s.fontFamily, s.fontWeight);
    for (const segment of textSegments(s, src) ?? []) {
        const family = segment.fontFamily ?? s.fontFamily;
        if (family) assets.font(family, segment.fontWeight);
        assets.fill(segment.fill ?? []);
        for (const stroke of segment.stroke ?? []) assets.fill(stroke.fill);
    }
}

/** One shaped piece of a line, as measuring needs it: its text and the face it is set in. */
interface StyledRun {
    text: string;
    fontFamily: string;
    fontSize: number;
    fontStyle: FontStyle;
    fontWeight: number;
    letterSpacing: number;
}

/** The segments as lines of runs, split at every newline; an empty line keeps the node's own face. */
function measureStyledLines(segments: TextSegment[], fallback: Omit<StyledRun, "text">): { runs: StyledRun[] }[] {
    const lines: { runs: StyledRun[] }[] = [{ runs: [] }];
    for (const segment of segments) {
        const style: Omit<StyledRun, "text"> = {
            fontFamily: segment.fontFamily ?? fallback.fontFamily,
            fontSize: segment.fontSize ?? fallback.fontSize,
            fontStyle: segment.fontStyle ?? fallback.fontStyle,
            fontWeight: segment.fontWeight,
            letterSpacing: segment.letterSpacing,
        };
        const parts = segment.text.split("\n");
        for (let i = 0; i < parts.length; i++) {
            if (i > 0) lines.push({ runs: [] });
            lines[lines.length - 1].runs.push({ text: parts[i], ...style });
        }
    }
    for (const line of lines) {
        if (line.runs.length === 0) line.runs.push({ ...fallback, text: "" });
    }
    return lines;
}

/** Each wrapped line's tallest run, breaking at whitespace the way the paragraph builder does. */
function wrappedLineSizes(lines: { runs: StyledRun[] }[], maxWidth: number, scope: MeasureContext2D): number[] {
    const sizes: number[] = [];
    for (const line of lines) {
        const tokens: { width: number; size: number; space: boolean }[] = [];
        for (const run of line.runs) {
            for (const part of run.text.split(/(\s+)/)) {
                if (part.length === 0) continue;
                const space = /^\s+$/.test(part);
                const width = scope.measureText(part, run.fontSize, run.fontFamily, run.fontWeight, run.letterSpacing, run.fontStyle).width;
                const last = tokens[tokens.length - 1];
                if (last && !last.space && !space) {
                    last.width += width;
                    last.size = Math.max(last.size, run.fontSize);
                } else {
                    tokens.push({ width, size: run.fontSize, space });
                }
            }
        }
        if (tokens.length === 0) {
            sizes.push(Math.max(...line.runs.map(run => run.fontSize)));
            continue;
        }
        let lineW = tokens[0].width;
        let size = tokens[0].size;
        for (const token of tokens.slice(1)) {
            if (lineW + token.width <= maxWidth) {
                lineW += token.width;
                size = Math.max(size, token.size);
            } else {
                sizes.push(size);
                lineW = token.space ? 0 : token.width;
                size = token.space ? 0 : token.size;
            }
        }
        sizes.push(size > 0 ? size : Math.max(...line.runs.map(run => run.fontSize)));
    }
    return sizes;
}

function countWrappedLines(
    paragraph: string,
    maxWidth: number,
    fontSize: number,
    fontFamily: string,
    fontWeight: number,
    scope: MeasureContext2D,
    letterSpacing = 0,
    fontStyle: FontStyle = "normal",
): number {
    if (paragraph.length === 0) return 1;
    if (scope.measureText(paragraph, fontSize, fontFamily, fontWeight, letterSpacing, fontStyle).width <= maxWidth) return 1;
    const words = paragraph.split(/(\s+)/).filter(w => w.length > 0);
    let lines = 1;
    let lineW = 0;
    for (const word of words) {
        const w = scope.measureText(word, fontSize, fontFamily, fontWeight, letterSpacing, fontStyle).width;
        if (lineW === 0) {
            lineW = w;
        } else if (lineW + w <= maxWidth) {
            lineW += w;
        } else {
            lines++;
            lineW = /^\s+$/.test(word) ? 0 : w;
        }
    }
    return lines;
}

/** What a rich-text node reads: spans, and the face they inherit from. */
export interface RichValues {
    readonly spans: readonly TextSpan[];
    readonly fontFamily: string;
    readonly fontSize: number;
    readonly fontWeight: number;
    readonly fontStyle: FontStyle;
    readonly letterSpacing: number;
    readonly lineHeight: number;
    readonly textAlign: TextAlign;
    readonly fill: unknown;
    readonly stroke: unknown;
    readonly width: SizeInput;
    readonly height: SizeInput;
}

/** Every span flattened to a run, each field it leaves unset taken from the node. */
export function richRuns(s: RichValues): ResolvedTextSpan[] {
    return textOps.flatten(s.spans, {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        fontStyle: s.fontStyle,
        letterSpacing: s.letterSpacing,
        fill: s.fill as FillResolved[],
        stroke: s.stroke as StrokeResolved[],
    });
}

/** Lines broken only at `\n`, each as tall as its tallest run; an empty node keeps one line of its own size. */
export function measureRich(s: RichValues, constraints: SizeConstraints, scope: MeasureContext2D): Size2D {
    let lineW = 0;
    let maxLineH = 0;
    let totalW = 0;
    let totalH = 0;
    const finishLine = () => {
        if (lineW > totalW) totalW = lineW;
        totalH += maxLineH;
        lineW = 0;
        maxLineH = 0;
    };
    for (const run of richRuns(s)) {
        const lh = run.fontSize * s.lineHeight;
        const segments = run.text.split("\n");
        for (let i = 0; i < segments.length; i++) {
            if (i > 0) finishLine();
            lineW += scope.measureText(segments[i], run.fontSize, run.fontFamily, run.fontWeight, run.letterSpacing, run.fontStyle).width;
            if (lh > maxLineH) maxLineH = lh;
        }
    }
    finishLine();
    if (totalH === 0) totalH = s.fontSize * s.lineHeight;
    const wm = s.width;
    const hm = s.height;
    return {
        width: typeof wm === "number" ? wm : wm === "hug" ? totalW : constraints.maxWidth ?? 0,
        height: typeof hm === "number" ? hm : hm === "hug" ? totalH : constraints.maxHeight ?? 0,
    };
}

export function richState(s: RichValues, size: Size2D | undefined): Partial<RichTextState> {
    return { spans: richRuns(s), lineHeight: s.lineHeight, textAlign: s.textAlign, width: size?.width ?? 0, height: size?.height ?? 0 };
}

export function declareRichAssets(s: RichValues, assets: Pick<AssetScope, "font" | "fill">): void {
    for (const run of richRuns(s)) {
        if (run.fontFamily) assets.font(run.fontFamily, run.fontWeight);
        assets.fill(run.fill);
        for (const stroke of run.stroke) assets.fill(stroke.fill);
    }
}
