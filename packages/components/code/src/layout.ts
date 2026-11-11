import type { InsetsResolved, MeasureContext2D, RenderContext2D } from "@motionscript/sdk";
import type { TokenAdvanceCache } from "./measure-cache";
import type { IdLine } from "./tokens";

/**
 * Everything about a listing's geometry that is *not* its content — the type,
 * the padding, whether there is a gutter. Split out from the node so a layout
 * can be computed for a token structure the node is no longer holding: during a
 * structural transition the frame is the interpolation of two of them, and the
 * one that is going away is not reachable through `this` any more.
 */
export interface CodeMetrics {
    fontSize: number;
    fontFamily: string;
    lineHeight: number;
    letterSpacing: number;
    padding: InsetsResolved;
    showLineNumbers: boolean;
    lineNumberGap: number;
}

/** A token's LEFT edge and the vertical CENTRE of its line's slot. */
export interface TokenBox {
    x: number;
    y: number;
}

/**
 * A resolved listing geometry: every token placed, in the node's own space
 * (origin at the block's centre, y-up).
 *
 * Positions are absolute rather than "a running sum plus a width scale", which
 * is the whole point. A token's place in the *next* structure is knowable
 * without drawing it, so a transition can move a token from where it was to
 * where it will be instead of faking the motion by collapsing the advance of
 * its neighbours — which is what made an insert look like a pile of glyphs at
 * the left margin springing apart.
 */
export interface CodeLayout {
    tokens: Map<number, TokenBox>;
    /** By line index. */
    lineY: number[];
    /** Ink width per line (blank is 0): the only record that a listing is ragged, which hit testing needs. */
    lineW: number[];
    lineIndex: Map<number, number>;
    gutter: number;
    gutterGap: number;
    /** Content size, no padding. */
    innerW: number;
    innerH: number;
    /** Content plus padding. */
    blockW: number;
    blockH: number;
    /** Left edge of the code column, after padding and gutter. */
    startX: number;
}

/** Everything a layout depends on besides the token structure; a cached layout lives while it is unchanged. */
export function metricsSignature(m: CodeMetrics): string {
    const p = m.padding;
    return [
        m.fontSize, m.fontFamily, m.lineHeight, m.letterSpacing,
        p.left, p.right, p.top, p.bottom,
        m.showLineNumbers ? 1 : 0, m.lineNumberGap,
    ].join("|");
}

/** In space-widths, measured with letterSpacing 0: line numbers and the gap don't carry the code's. */
function gutterGapOf(scope: MeasureContext2D | RenderContext2D, m: CodeMetrics, cache: TokenAdvanceCache): number {
    return cache.advance(scope, " ", m.fontSize, m.fontFamily, 0) * m.lineNumberGap;
}

/** Gap included. */
function gutterOf(
    scope: MeasureContext2D | RenderContext2D,
    m: CodeMetrics,
    cache: TokenAdvanceCache,
    lineCount: number,
    gap: number,
): number {
    if (!m.showLineNumbers) return 0;
    const sample = String(Math.max(1, lineCount));
    return cache.advance(scope, sample, m.fontSize, m.fontFamily, 0) + gap;
}

/** Pure in (lines, metrics, measurements), so a caller caches one per structure. */
export function layoutCode(
    lines: IdLine[],
    m: CodeMetrics,
    cache: TokenAdvanceCache,
    scope: MeasureContext2D | RenderContext2D,
): CodeLayout {
    const lineH = m.fontSize * m.lineHeight;
    const gutterGap = m.showLineNumbers ? gutterGapOf(scope, m, cache) : 0;
    const gutter = gutterOf(scope, m, cache, lines.length, gutterGap);

    const widths: number[] = new Array(lines.length);
    let maxLineWidth = 0;
    for (let i = 0; i < lines.length; i++) {
        let w = 0;
        for (const tok of lines[i].tokens) {
            w += cache.advance(scope, tok.content, m.fontSize, m.fontFamily, m.letterSpacing);
        }
        widths[i] = w;
        if (w > maxLineWidth) maxLineWidth = w;
    }

    const innerW = maxLineWidth + gutter;
    const innerH = lines.length * lineH;
    const blockW = innerW + m.padding.left + m.padding.right;
    const blockH = innerH + m.padding.top + m.padding.bottom;
    const startX = -blockW / 2 + m.padding.left + gutter;
    // y-up: the first line sits at the TOP, and each row steps down by a line height.
    const startY = blockH / 2 - m.padding.top;

    const tokens = new Map<number, TokenBox>();
    const lineY: number[] = new Array(lines.length);
    const lineIndex = new Map<number, number>();

    for (let i = 0; i < lines.length; i++) {
        const centerY = startY - i * lineH - lineH / 2;
        lineY[i] = centerY;
        lineIndex.set(lines[i].id, i);
        let x = startX;
        for (const tok of lines[i].tokens) {
            tokens.set(tok.id, { x, y: centerY });
            x += cache.advance(scope, tok.content, m.fontSize, m.fontFamily, m.letterSpacing);
        }
    }

    return { tokens, lineY, lineW: widths, lineIndex, gutter, gutterGap, innerW, innerH, blockW, blockH, startX };
}
