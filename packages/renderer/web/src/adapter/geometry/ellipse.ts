import { type EllipseState, withEllipseDescriptor } from "@motionscript/core";
import type { PathData } from "../../doc";
import { type Bounds, ShapeGeometry } from "./base";
import { type PathSink, pathDataOf, svgOf } from "./sink";

type EllipseGeo = {
    cx: number; cy: number;
    halfWidth: number; halfHeight: number;
    sweep: number; isFullShape: boolean;
    startAngle: number;
    /** Inner radius as a fraction (0..1) of the outer. */
    ratio: number;
};

const TO_RAD = Math.PI / 180;

/**
 * An ellipse, optionally a partial arc (`sweep` < 360°) and/or with a hole
 * (`ratio` > 0): 0 is a disc or pie wedge, 0.5 a donut or annular sector, and 1
 * leaves nothing to fill, the stroke riding the bare outline or arc.
 */
export class EllipseGeometry extends ShapeGeometry<EllipseState, EllipseGeo> {
    protected resolveState(state: Partial<EllipseState>): EllipseState {
        return withEllipseDescriptor(state);
    }

    protected computeGeometry(): EllipseGeo {
        const s = this.fullState;
        const sweep = s.sweep ?? 360;
        return {
            cx: s.x, cy: s.y,
            halfWidth: s.width / 2, halfHeight: s.height / 2,
            sweep,
            isFullShape: Math.abs(sweep) >= 360,
            startAngle: s.startAngle ?? 0,
            ratio: Math.max(0, Math.min(1, s.ratio ?? 0)),
        };
    }

    // Empty at ratio 1 rather than solid again, so a ratio tween stays
    // continuous at that end; its stroke is `ringOutline`.
    buildSVGPath(geo: EllipseGeo): string {
        return svgOf((sink) => outline(sink, geo));
    }

    override buildPathData(geo: EllipseGeo): PathData | null {
        return pathDataOf((sink) => outline(sink, geo));
    }

    /** What a ratio-1 ellipse strokes, once: the bare outline or open arc. Null below ratio 1. */
    ringOutline(geo: EllipseGeo): string | null {
        if (geo.ratio < 1) return null;
        return svgOf((sink) => (geo.isFullShape ? fullEllipse(sink, geo.cx, geo.cy, geo.halfWidth, geo.halfHeight, 0) : openArc(sink, geo)));
    }

    // At ratio 1 the region is empty, so the band aligns against the whole
    // ellipse or wedge instead.
    override buildSVGAlignInterior(geo: EllipseGeo): string | null {
        if (geo.isFullShape) return geo.ratio >= 1 ? svgOf((sink) => fullEllipse(sink, geo.cx, geo.cy, geo.halfWidth, geo.halfHeight, 0)) : null;
        return svgOf((sink) => (geo.ratio >= 1 || geo.ratio <= 0 ? wedge(sink, geo) : annularSector(sink, geo)));
    }

    override supportsSpread(): boolean {
        return true;
    }

    // Each half-axis moves by `spread`; only a full ellipse with something to
    // fill bounds a region to grow.
    override buildSpreadSVGPath(geo: EllipseGeo, spread: number): string | null {
        if (!geo.isFullShape || geo.ratio >= 1) return null;
        const halfWidth = geo.halfWidth + spread, halfHeight = geo.halfHeight + spread;
        if (halfWidth <= 0 || halfHeight <= 0) return null;
        return svgOf((sink) => fullEllipse(sink, geo.cx, geo.cy, halfWidth, halfHeight, 0));
    }

    override computeBounds(geo: EllipseGeo): Bounds {
        const { cx, cy, halfWidth, halfHeight } = geo;
        return { left: cx - halfWidth, top: cy - halfHeight, right: cx + halfWidth, bottom: cy + halfHeight };
    }
}

function outline(sink: PathSink, geo: EllipseGeo): void {
    const { cx, cy, halfWidth, halfHeight, ratio } = geo;
    if (ratio >= 1) return;
    if (!geo.isFullShape) return ratio <= 0 ? wedge(sink, geo) : annularSector(sink, geo);
    fullEllipse(sink, cx, cy, halfWidth, halfHeight, 0);
    // Wound the other way, so the fill leaves a hole.
    if (ratio > 0) fullEllipse(sink, cx, cy, halfWidth * ratio, halfHeight * ratio, 1);
}

function fullEllipse(sink: PathSink, cx: number, cy: number, rx: number, ry: number, sweepFlag: 0 | 1): void {
    const left = cx - rx, right = cx + rx;
    sink.move(left, cy);
    sink.arc(rx, ry, 1, sweepFlag, right, cy);
    sink.arc(rx, ry, 1, sweepFlag, left, cy);
    sink.close();
}

/** A partial sweep's outer curve: its start point, and the arc that runs it round. */
function outerArc(geo: EllipseGeo): { sx: number; sy: number; arc: (sink: PathSink) => void } {
    const { cx, cy, halfWidth, halfHeight, startAngle, sweep } = geo;
    const endAngle = startAngle + sweep;
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    const sweepFlag = sweep > 0 ? 1 : 0;
    const sx = cx + halfWidth * Math.cos(startAngle * TO_RAD), sy = cy + halfHeight * Math.sin(startAngle * TO_RAD);
    const ex = cx + halfWidth * Math.cos(endAngle * TO_RAD), ey = cy + halfHeight * Math.sin(endAngle * TO_RAD);
    return { sx, sy, arc: (sink) => sink.arc(halfWidth, halfHeight, largeArc, sweepFlag, ex, ey) };
}

function openArc(sink: PathSink, geo: EllipseGeo): void {
    const { sx, sy, arc } = outerArc(geo);
    sink.move(sx, sy);
    arc(sink);
}

function wedge(sink: PathSink, geo: EllipseGeo): void {
    const { sx, sy, arc } = outerArc(geo);
    sink.move(geo.cx, geo.cy);
    sink.line(sx, sy);
    arc(sink);
    sink.close();
}

/** Out along the outer arc, in to the inner edge, back along the inner arc, closed along the start radius. */
function annularSector(sink: PathSink, geo: EllipseGeo): void {
    const { cx, cy, halfWidth, halfHeight, startAngle, sweep, ratio } = geo;
    const { sx, sy, arc } = outerArc(geo);
    const endAngle = startAngle + sweep;
    const innerW = halfWidth * ratio, innerH = halfHeight * ratio;
    const isx = cx + innerW * Math.cos(startAngle * TO_RAD), isy = cy + innerH * Math.sin(startAngle * TO_RAD);
    const iex = cx + innerW * Math.cos(endAngle * TO_RAD), iey = cy + innerH * Math.sin(endAngle * TO_RAD);
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    const innerSweepFlag = sweep > 0 ? 0 : 1;
    sink.move(sx, sy);
    arc(sink);
    sink.line(iex, iey);
    sink.arc(innerW, innerH, largeArc, innerSweepFlag, isx, isy);
    sink.close();
}
