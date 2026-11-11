import { Node2D } from "@/components/trees/2d/node2d";
import { Text } from "@/components/builtins/text/text";
import { textStateOf } from "@/components/modules/text-layout";
import { Vector2 } from "@/attributes/layout/vector2";
import { applyToPoint } from "@/attributes/layout/matrix2d";
import { caretCount, type TextBlockSource } from "@/render/text-layout";
import { renderMatrix } from "./node-picking";

/**
 * The measurement a host needs to draw its own text cursor and selection over the rendered glyphs. In viewport
 * space, as {@link NodeBox}, so a caret and its selection box come out of the same walk and cannot disagree.
 *
 * The host draws from these rather than approximating glyph positions itself: a DOM input laid over the canvas
 * drifts the moment the font, line height or wrapping does, and CSS `line-height` and the renderer's height
 * multiplier are not the same quantity.
 */
export interface NodeTextLayout {
    path: string;
    text: string;
    /**
     * `carets[i]` sits before character `i` and the last after the final character, so there are `text.length + 1`
     * and an offset is always a valid index. Each is a segment, not a point: a rotated node's cursor is a rotated
     * line, drawn from `top` to `bottom`.
     */
    carets: TextCaret[];
    /**
     * For Home/End and vertical arrow keys. A hard line break belongs to neither line, so `lines[n].end` and
     * `lines[n + 1].start` differ by one there.
     */
    lines: { start: number; end: number }[];
}

export interface TextCaret {
    offset: number;
    top: Vector2;
    bottom: Vector2;
}

export interface TextRangeQuad {
    topLeft: Vector2;
    topRight: Vector2;
    bottomRight: Vector2;
    bottomLeft: Vector2;
}

/**
 * `null` when it has none to report: not a {@link Text}, nothing shaped yet, or a shape the caret model does
 * not cover (see {@link RenderContext2D.layoutTextBlock}). The block-local layout comes from the backend,
 * where glyphs are positioned.
 */
export function nodeTextLayout(
    node: Node2D,
    path: string,
    source: TextBlockSource,
): NodeTextLayout | null {
    // A text's state is what it last drew.
    const state = node instanceof Text ? textStateOf(node) : null;
    if (!state) return null;
    const block = source.layoutTextBlock(state);
    if (!block) return null;

    const m = renderMatrix(node);
    /**
     * The block is laid out about the node's own origin, which is also where `_localBounds` centres the box, so a
     * block-local offset is a node-local one. Block coordinates are canvas y-down, the space the matrix works in,
     * so unlike `worldAnchors` only the result is flipped to y-up.
     */
    const at = (x: number, y: number): Vector2 => {
        const p = applyToPoint(m, { x, y });
        return { x: p.x, y: -p.y };
    };

    const carets: TextCaret[] = new Array(caretCount(block));
    const lines: { start: number; end: number }[] = [];
    for (const line of block.lines) {
        lines.push({ start: line.start, end: line.end });
        for (let i = 0; i < line.carets.length; i++) {
            const x = line.carets[i];
            carets[line.start + i] = {
                offset: line.start + i,
                top: at(x, line.top),
                bottom: at(x, line.bottom),
            };
        }
    }

    return { path, text: (node as unknown as { text: string }).text, carets, lines };
}

/**
 * Nearest slot by distance to the caret segment, not its midpoint: a click below a short first line should
 * land on that line's nearest slot, and midpoints would pull it toward whichever line's centre is closer. It
 * also stays correct for rotated and scaled text, since the slots arrive transformed.
 */
export function caretOffsetAt(layout: NodeTextLayout, point: Vector2): number {
    let best = 0;
    let bestDistance = Infinity;
    for (const caret of layout.carets) {
        const d = distanceToSegment(point, caret.top, caret.bottom);
        if (d < bestDistance) {
            bestDistance = d;
            best = caret.offset;
        }
    }
    return best;
}

/**
 * One per line the range touches, because a range spanning a line break covers two disjoint areas and one
 * enclosing box would paint over the gap.
 */
export function caretRangeQuads(
    layout: NodeTextLayout,
    start: number,
    end: number,
): TextRangeQuad[] {
    const from = Math.max(0, Math.min(start, end));
    const to = Math.min(layout.carets.length - 1, Math.max(start, end));
    const quads: TextRangeQuad[] = [];
    for (const line of layout.lines) {
        const a = Math.max(from, line.start);
        const b = Math.min(to, line.end);
        if (a >= b) continue;                    // empty on this line
        const left = layout.carets[a];
        const right = layout.carets[b];
        quads.push({
            topLeft: left.top,
            topRight: right.top,
            bottomRight: right.bottom,
            bottomLeft: left.bottom,
        });
    }
    return quads;
}

function distanceToSegment(p: Vector2, a: Vector2, b: Vector2): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    // A degenerate segment (a zero-height line box) is just a point.
    const t = lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
