// A shape's outline as SVG path strings: its state resolved once, its geometry
// computed lazily. Shapes bake x/y into the SVG; rotation, scale, trim and the
// y flip are left to adapter/shapes.ts.

import type { CornerStyle } from "@motionscript/core";

export interface Bounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export abstract class ShapeGeometry<S extends { start: number; end: number }, G> {
    readonly fullState: S;
    private geo: G | undefined;

    constructor(state: Partial<S>) {
        this.fullState = this.resolveState(state);
    }

    protected abstract resolveState(state: Partial<S>): S;
    protected abstract computeGeometry(): G;
    abstract buildSVGPath(geo: G): string;

    get geometry(): G {
        return (this.geo ??= this.computeGeometry());
    }

    needsTrim(): boolean {
        return this.fullState.start !== 0 || this.fullState.end !== 1;
    }

    getTrimRange(): { start: number; end: number } {
        return { start: this.fullState.start, end: this.fullState.end };
    }

    /**
     * The closed region an aligned (inside/outside) stroke clips against when
     * the stroked outline is open, as an arc's wedge is; null when the shape
     * defines none of its own.
     */
    buildSVGAlignInterior(_geo: G): string | null {
        return null;
    }

    /** Whether the silhouette resizes cleanly for a shadow's spread (rects and ellipses). */
    supportsSpread(): boolean {
        return false;
    }

    /** The silhouette grown (positive) or shrunk by `spread` px; null where it collapses or isn't supported. */
    buildSpreadSVGPath(_geo: G, _spread: number): string | null {
        return null;
    }

    computeBounds(_geo: G): Bounds | undefined {
        return undefined;
    }
}

/** Per-corner geometry inputs shared by every shape that rounds its corners. */
export interface CornerSpec {
    /** Corner radius in pixels (already clamped/scaled by the caller). */
    radius: number;
    style: CornerStyle;
}

/**
 * How far from a right-angle corner's apex, along each edge, its curve begins:
 * the radius, for an arc and a chamfer alike.
 */
export function cornerReach(c: CornerSpec): number {
    return c.radius > 0 ? c.radius : 0;
}

/**
 * SVG commands for a right-angle (rect) corner, the pen already at its entry
 * point `apex + d0·radius`; they leave it at `apex + d1·radius`. `d0` points
 * from the apex back along the incoming edge, `d1` along the outgoing one.
 * Empty for a zero radius (the edge runs on to a sharp apex).
 */
export function cornerCommands(ax: number, ay: number, d0x: number, d0y: number, d1x: number, d1y: number, c: CornerSpec): string {
    if (c.radius <= 0) return "";
    return cornerCommandsFromCut(ax, ay, d0x, d0y, d1x, d1y, c.radius, c.radius, c.style);
}

/**
 * SVG commands for a corner of any angle, given the cut-back distance `cut`
 * along each edge and the arc `radius` (they differ off a right angle). The pen
 * is at `apex + d0·cut`; the commands leave it at `apex + d1·cut`.
 */
export function cornerCommandsFromCut(
    ax: number, ay: number,
    d0x: number, d0y: number,
    d1x: number, d1y: number,
    cut: number, radius: number,
    style: CornerStyle,
): string {
    const ex = ax + d1x * cut, ey = ay + d1y * cut;
    if (style === "angled") return `L ${ex} ${ey}`;
    // The turn direction picks the sweep flag: a clockwise turn is sweep 1.
    const cross = d0x * d1y - d0y * d1x;
    const sweep = cross < 0 ? 1 : 0;
    return `A ${radius} ${radius} 0 0 ${sweep} ${ex} ${ey}`;
}
