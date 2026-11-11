import { Color, NormalizedColor, parseColor } from '../color/parser';
import type { BlendMode } from '../blend';
import type { FillData } from '../registry';
import { lerpNumber } from '@/tween/lerp';
import { Vector2 } from '@/attributes/layout/vector2';

/**
 * Ruled lines in both axes (graph paper, a chart's backing, a layout guide). Measured in **divisions of the shape**, not
 * pixels (unlike {@link DotGridFillProp}): a grid of 8 stays 8 when the shape resizes, so it reads as structure rather
 * than a texture laid over it. Cells follow the box (a 16:9 shape divided 8 ways has 16:9 cells), since square cells
 * would leave a ragged strip down one side.
 *
 * {@link subdivisions} nests a finer grid inside each cell, by default at {@link MINOR_WIDTH_RATIO} of the division
 * line's width: thinner rather than fainter, since a half-width line antialiases lighter at any zoom, so the two orders
 * stay distinguishable at every scale without a second colour. {@link subdivisionWidth} overrides it.
 */
export interface GridFillProp {
    type: 'grid';
    /** How many cells the shape is divided into, per axis. Tween it to zoom the grid. */
    divisions?: number;
    /** How many finer cells nest inside each division. `1` draws no minor lines. */
    subdivisions?: number;
    /** Shifts the whole ruling, in px. */
    offset?: Vector2;
    /** Thickness of a division line, in px. `0` leaves the coarse ruling undrawn. */
    strokeWidth?: number;
    /** Thickness of a subdivision line, in px; defaults to {@link MINOR_WIDTH_RATIO} of {@link strokeWidth}. */
    subdivisionWidth?: number;
    color?: Color;
    opacity?: number;
    blend?: BlendMode;
}

export interface GridFillResolved {
    type: 'grid';
    divisions: number;
    subdivisions: number;
    offset: Vector2;
    strokeWidth: number;
    subdivisionWidth: number;
    color: NormalizedColor;
    opacity?: number;
    blend?: BlendMode;
}

/** Quarters, hairline, no minor ruling — the plainest grid that is still one. */
const DEFAULT_DIVISIONS = 4;
const DEFAULT_SUBDIVISIONS = 1;
const DEFAULT_STROKE_WIDTH = 1;

/** How thick a subdivision line is relative to a division one. */
export const MINOR_WIDTH_RATIO = 0.5;

export const gridFill: FillData<GridFillResolved> = {
    resolve: (prop: GridFillProp) => {
        const raw = prop.color ?? ([0, 0, 0, 1] as NormalizedColor);
        const strokeWidth = prop.strokeWidth ?? DEFAULT_STROKE_WIDTH;
        return {
            type: 'grid',
            divisions: prop.divisions ?? DEFAULT_DIVISIONS,
            subdivisions: prop.subdivisions ?? DEFAULT_SUBDIVISIONS,
            offset: prop.offset ?? { x: 0, y: 0 },
            strokeWidth,
            // From the width in force, so stating only `strokeWidth: 4` still gives a proportionate minor ruling.
            subdivisionWidth: prop.subdivisionWidth ?? strokeWidth * MINOR_WIDTH_RATIO,
            color: Array.isArray(raw) ? (raw as NormalizedColor) : parseColor(raw as string),
            opacity: prop.opacity,
            blend: prop.blend,
        };
    },
    // `divisions` interpolates continuously (a fractional count is a grid caught mid-zoom). The renderer rounds `subdivisions`, so the minor ruling nests a whole number of times and a tween steps instead of sliding fine lines out of alignment.
    lerp: (a, b, t) => ({
        divisions: lerpNumber(a.divisions, b.divisions, t),
        subdivisions: lerpNumber(a.subdivisions, b.subdivisions, t),
        offset: {
            x: lerpNumber(a.offset.x, b.offset.x, t),
            y: lerpNumber(a.offset.y, b.offset.y, t),
        },
        strokeWidth: lerpNumber(a.strokeWidth, b.strokeWidth, t),
        subdivisionWidth: lerpNumber(a.subdivisionWidth, b.subdivisionWidth, t),
        color: [
            lerpNumber(a.color[0], b.color[0], t),
            lerpNumber(a.color[1], b.color[1], t),
            lerpNumber(a.color[2], b.color[2], t),
            lerpNumber(a.color[3], b.color[3], t),
        ],
        opacity: lerpNumber(a.opacity ?? 1, b.opacity ?? 1, t),
    }),
    equals: (a, b) =>
        a.divisions === b.divisions &&
        a.subdivisions === b.subdivisions &&
        a.offset.x === b.offset.x && a.offset.y === b.offset.y &&
        a.strokeWidth === b.strokeWidth &&
        a.subdivisionWidth === b.subdivisionWidth &&
        a.color[0] === b.color[0] && a.color[1] === b.color[1] &&
        a.color[2] === b.color[2] && a.color[3] === b.color[3],
};
