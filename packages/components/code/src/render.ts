import { RenderContext2D, Graphics2D, NormalizedColor, parseColor, lerpNumber } from "@motionscript/sdk";
import type { CodeLayout, CodeMetrics } from "./layout";
import type { IdLine } from "./tokens";
import { windowProgress, moveProgress } from "./transitions";
import type { TokenState, StructuralTransition, RowBand, RowsTransition } from "./transitions";
import type { TokenAdvanceCache } from "./measure-cache";

const DEFAULT_TOKEN_COLOR: NormalizedColor = [0.82, 0.84, 0.86, 1];
const LINE_NUMBER_COLOR: NormalizedColor = [0.45, 0.5, 0.55, 1];

// A listing asks for the same few theme colours on every token of every frame.
const colorCache = new Map<string, NormalizedColor>();
function tokenColor(css: string | undefined): NormalizedColor {
    if (!css) return DEFAULT_TOKEN_COLOR;
    let hit = colorCache.get(css);
    if (!hit) {
        hit = parseColor(css);
        colorCache.set(css, hit);
    }
    return hit;
}

function lerpColor(from: NormalizedColor, to: NormalizedColor, t: number): NormalizedColor {
    if (t <= 0) return from;
    if (t >= 1) return to;
    return [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
        from[3] + (to[3] - from[3]) * t,
    ];
}

// A number stays bright only when the whole line is highlighted, so it takes the line's minimum token opacity.
function lineHighlightOpacity(line: IdLine, stateById: Map<number, TokenState>, highlightActive: boolean): number {
    if (!highlightActive) return 1;
    let min = 1;
    for (const tok of line.tokens) {
        if (tok.content.length === 0) continue;
        const op = stateById.get(tok.id)?.opacity ?? 1;
        if (op < min) min = op;
    }
    return min;
}

/** What a `Code` node supplies to draw one frame. */
export interface DrawCodeState {
    tokenLines: IdLine[];
    metrics: CodeMetrics;
    advanceCache: TokenAdvanceCache;
    from: CodeLayout;
    to: CodeLayout;
    edit: StructuralTransition | null;
    tokenStates: Map<number, TokenState>;
    /** A persistent dim or a highlight cross-fade is engaged. */
    highlightActive: boolean;
    rowBands?: RowBand[];
    rowsEdit?: RowsTransition | null;
    /** A band spans this when it is wider than the block. */
    boxW?: number;
}

/** Somewhere to draw and the face's measurements; a render context is one. */
export type CodeCanvas = Pick<RenderContext2D, "draw" | "measureText">;

/** Draws the settled structure, or mid-edit the two it interpolates between. Pure over `state`. */
export function drawCode(draw: CodeCanvas, state: DrawCodeState): void {
    const { tokenLines, metrics, advanceCache, from, to, edit, tokenStates: dim } = state;

    const progress = edit ? edit.progress : 1;
    const pOut = edit ? windowProgress(edit.phases.out, progress) : 1;
    const pMove = moveProgress(edit);
    const pIn = edit ? windowProgress(edit.phases.in, progress) : 1;

    const blockW = edit ? lerpNumber(from.blockW, to.blockW, pMove) : to.blockW;
    const gutter = edit ? lerpNumber(from.gutter, to.gutter, pMove) : to.gutter;
    const gutterGap = to.gutterGap || from.gutterGap;
    const numberRight = -blockW / 2 + metrics.padding.left + gutter - gutterGap;

    drawRowBands(draw, state, Math.max(blockW, state.boxW ?? 0), pMove);

    const drawNumber = (label: string, y: number, opacity: number): void => {
        if (opacity <= 0) return;
        const labelW = advanceCache.advance(draw, label, metrics.fontSize, metrics.fontFamily, 0);
        draw.draw(new Graphics2D()
            .text({
                text: label,
                fontSize: metrics.fontSize,
                fontFamily: metrics.fontFamily,
                lineHeight: metrics.lineHeight,
                x: numberRight - labelW / 2,
                y,
                textAlign: 'left',
            })
            .fill([{ type: "solid", color: LINE_NUMBER_COLOR, opacity }]));
    };

    const drawToken = (text: string, x: number, y: number, color: NormalizedColor, opacity: number): void => {
        if (opacity <= 0 || text.length === 0) return;
        const width = advanceCache.advance(draw, text, metrics.fontSize, metrics.fontFamily, metrics.letterSpacing);
        draw.draw(new Graphics2D()
            .text({
                text,
                fontSize: metrics.fontSize,
                fontFamily: metrics.fontFamily,
                lineHeight: metrics.lineHeight,
                letterSpacing: metrics.letterSpacing,
                // The renderer centres a single-token block on the (x, y) it is
                // given, so every token is anchored at the centre of its cell
                // rather than at its left edge. Passing lineHeight makes the
                // block's height deterministic (fontSize × lineHeight) rather
                // than the font's natural metrics, so the vertical centre
                // lands exactly on the slot centre.
                x: x + width / 2,
                y,
                textAlign: 'left',
            })
            .fill([{ type: "solid", color, opacity }]));
    };

    // Survivors and arrivals, from the structure the edit lands on.
    for (let i = 0; i < tokenLines.length; i++) {
        const line = tokenLines[i];
        const toIndex = to.lineIndex.get(line.id);
        if (toIndex === undefined) continue;
        const toY = to.lineY[toIndex];

        const entering = edit?.enteringLineIds.has(line.id) ?? false;
        let rowY = toY;
        let rowAlpha = 1;
        if (edit && entering) {
            // A new row fades as one piece where it lands (see `enteringLineIds`).
            rowAlpha = pIn;
        } else if (edit) {
            const fromIndex = from.lineIndex.get(line.id);
            if (fromIndex !== undefined) rowY = lerpNumber(from.lineY[fromIndex], toY, pMove);
        }

        for (const token of line.tokens) {
            const box = to.tokens.get(token.id);
            if (!box) continue;

            let x = box.x;
            let alpha = rowAlpha;
            let color = tokenColor(token.color);

            if (edit && !entering) {
                if (edit.addedIds.has(token.id)) {
                    // Spliced into an existing row: the reflow opened the space already.
                    alpha = pIn;
                } else {
                    const was = from.tokens.get(token.id);
                    if (was) x = lerpNumber(was.x, box.x, pMove);
                    if (edit.fromColorById.has(token.id)) {
                        color = lerpColor(tokenColor(edit.fromColorById.get(token.id)), color, pMove);
                    }
                }
            }

            drawToken(token.content, x, rowY, color, alpha * (dim.get(token.id)?.opacity ?? 1));
        }
    }

    // What the edit takes away, from the structure it is leaving.
    if (edit && pOut < 1) {
        for (let i = 0; i < edit.from.length; i++) {
            const line = edit.from[i];
            const fromIndex = from.lineIndex.get(line.id);
            if (fromIndex === undefined) continue;
            const toIndex = to.lineIndex.get(line.id);
            // A surviving row's outgoing tokens travel with it; a deleted row dissolves in place.
            const y = toIndex === undefined
                ? from.lineY[fromIndex]
                : lerpNumber(from.lineY[fromIndex], to.lineY[toIndex], pMove);

            for (const token of line.tokens) {
                if (!edit.removedIds.has(token.id)) continue;
                const box = from.tokens.get(token.id);
                if (!box) continue;
                drawToken(token.content, box.x, y, tokenColor(token.color), 1 - pOut);
            }
        }
    }

    if (metrics.showLineNumbers) drawLineNumbers(state, drawNumber, pMove, pIn, pOut);
}

/** A band's top and bottom edge this frame, or `null` when neither of its rows is in the listing any more. */
function bandEdges(band: RowBand, state: DrawCodeState, pMove: number): { top: number; bottom: number } | null {
    const { from, to, metrics } = state;
    const half = (metrics.fontSize * metrics.lineHeight) / 2;
    const centre = (id: number): number | null => {
        const toIndex = to.lineIndex.get(id);
        const fromIndex = from.lineIndex.get(id);
        if (toIndex !== undefined && fromIndex !== undefined) return lerpNumber(from.lineY[fromIndex], to.lineY[toIndex], pMove);
        if (toIndex !== undefined) return to.lineY[toIndex];
        return fromIndex === undefined ? null : from.lineY[fromIndex];
    };
    const first = centre(band.startId);
    const last = centre(band.endId);
    if (first === null && last === null) return null;
    return { top: (first ?? last as number) + half, bottom: (last ?? first as number) - half };
}

/** Bands ride their rows through an edit; between two sets, those paired by position slide and recolour and an unpaired one fades. */
function drawRowBands(draw: CodeCanvas, state: DrawCodeState, width: number, pMove: number): void {
    const { rowBands = [], rowsEdit = null } = state;
    const paint = (top: number, bottom: number, color: NormalizedColor, radius: number, opacity: number): void => {
        if (opacity <= 0 || top <= bottom) return;
        draw.draw(new Graphics2D()
            .rect({ x: 0, y: (top + bottom) / 2, width, height: top - bottom, cornerRadius: radius })
            .fill([{ type: "solid", color, opacity }]));
    };

    if (!rowsEdit) {
        for (const band of rowBands) {
            const edges = bandEdges(band, state, pMove);
            if (edges) paint(edges.top, edges.bottom, band.color, band.radius, 1);
        }
        return;
    }

    const p = rowsEdit.progress;
    for (let i = 0; i < Math.max(rowsEdit.from.length, rowsEdit.to.length); i++) {
        const was = rowsEdit.from[i];
        const next = rowsEdit.to[i];
        const a = was ? bandEdges(was, state, pMove) : null;
        const b = next ? bandEdges(next, state, pMove) : null;
        if (a && b) {
            paint(
                lerpNumber(a.top, b.top, p), lerpNumber(a.bottom, b.bottom, p),
                lerpColor(was.color, next.color, p), lerpNumber(was.radius, next.radius, p), 1,
            );
        } else if (a) {
            paint(a.top, a.bottom, was.color, was.radius, 1 - p);
        } else if (b) {
            paint(b.top, b.bottom, next.color, next.radius, p);
        }
    }
}

/**
 * One number per slot, not per row: "3" lasts as long as the listing has a third
 * line. Tied to a row's identity, a line rewritten past what the diff could pair
 * would take its number down and bring an identical one back up (a blink).
 */
function drawLineNumbers(
    state: DrawCodeState,
    drawNumber: (label: string, y: number, opacity: number) => void,
    pMove: number,
    pIn: number,
    pOut: number,
): void {
    const { tokenLines, from, to, edit, tokenStates: dim, highlightActive } = state;

    const toCount = tokenLines.length;
    const fromCount = edit ? edit.from.length : toCount;

    for (let i = 0; i < Math.max(fromCount, toCount); i++) {
        const inFrom = i < fromCount;
        const inTo = i < toCount;
        // Dimming follows the content in the slot: the new listing where there is one.
        const line = inTo ? tokenLines[i] : edit?.from[i];
        const dimming = line ? lineHighlightOpacity(line, dim, highlightActive) : 1;

        if (!edit) drawNumber(String(i + 1), to.lineY[i], dimming);
        else if (inFrom && inTo) drawNumber(String(i + 1), lerpNumber(from.lineY[i], to.lineY[i], pMove), dimming);
        else if (inTo) drawNumber(String(i + 1), to.lineY[i], pIn * dimming);
        else drawNumber(String(i + 1), from.lineY[i], (1 - pOut) * dimming);
    }
}
