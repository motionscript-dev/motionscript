import { type CornerRadiusResolved, type CornerStyleResolved, type RectState, cornerRadiusOps, cornerStyleOps, withRectDescriptor } from "@motionscript/core";
import type { PathData } from "../../doc";
import { type Bounds, cornerReach, type CornerSpec, cornerTo, ShapeGeometry } from "./base";
import { type PathSink, pathDataOf, svgOf } from "./sink";

type RectGeo = {
    left: number; top: number; right: number; bottom: number;
    tl: CornerSpec; tr: CornerSpec; br: CornerSpec; bl: CornerSpec;
    isZero: boolean;
};

/** The outline clockwise, each corner its own arc or chamfer `radius` px from the apex. */
function roundedRect(sink: PathSink, l: number, t: number, r: number, b: number, tl: CornerSpec, tr: CornerSpec, br: CornerSpec, bl: CornerSpec): void {
    const rTL = cornerReach(tl), rTR = cornerReach(tr), rBR = cornerReach(br), rBL = cornerReach(bl);
    sink.move(l + rTL, t);
    sink.line(r - rTR, t);
    cornerTo(sink, r, t, -1, 0, 0, 1, tr);
    sink.line(r, b - rBR);
    cornerTo(sink, r, b, 0, -1, -1, 0, br);
    sink.line(l + rBL, b);
    cornerTo(sink, l, b, 1, 0, 0, -1, bl);
    sink.line(l, t + rTL);
    cornerTo(sink, l, t, 0, 1, 1, 0, tl);
    sink.close();
}

function plainRect(sink: PathSink, l: number, t: number, r: number, b: number): void {
    sink.move(l, t);
    sink.line(r, t);
    sink.line(r, b);
    sink.line(l, b);
    sink.close();
}

function outline(sink: PathSink, geo: RectGeo): void {
    const { left, top, right, bottom, tl, tr, br, bl, isZero } = geo;
    if (isZero) plainRect(sink, left, top, right, bottom);
    else roundedRect(sink, left, top, right, bottom, tl, tr, br, bl);
}

/** Per-corner radii and styles, scaled down together where adjacent corners would overrun a side. */
export class RectGeometry extends ShapeGeometry<RectState, RectGeo> {
    protected resolveState(state: Partial<RectState>): RectState {
        return withRectDescriptor(state);
    }

    protected computeGeometry(): RectGeo {
        const s = this.fullState;
        const left = s.x - s.width / 2, top = s.y - s.height / 2;
        const right = s.x + s.width / 2, bottom = s.y + s.height / 2;
        const radius: CornerRadiusResolved = cornerRadiusOps.resolve(s.cornerRadius);
        const style: CornerStyleResolved = cornerStyleOps.resolve(s.cornerStyle);
        const tl: CornerSpec = { radius: Math.max(0, radius.topLeft), style: style.topLeft };
        const tr: CornerSpec = { radius: Math.max(0, radius.topRight), style: style.topRight };
        const br: CornerSpec = { radius: Math.max(0, radius.bottomRight), style: style.bottomRight };
        const bl: CornerSpec = { radius: Math.max(0, radius.bottomLeft), style: style.bottomLeft };
        const scale = cornerScale(s.width, s.height, tl, tr, br, bl);
        tl.radius *= scale; tr.radius *= scale; br.radius *= scale; bl.radius *= scale;
        const isZero = cornerRadiusOps.isZero({ topLeft: tl.radius, topRight: tr.radius, bottomRight: br.radius, bottomLeft: bl.radius });
        return { left, top, right, bottom, tl, tr, br, bl, isZero };
    }

    buildSVGPath(geo: RectGeo): string {
        return svgOf((sink) => outline(sink, geo));
    }

    override buildPathData(geo: RectGeo): PathData | null {
        return pathDataOf((sink) => outline(sink, geo));
    }

    override supportsSpread(): boolean {
        return true;
    }

    // Each edge moves out by `spread` and each radius grows by it (clamped at
    // 0), as CSS box-shadow spread does, then re-clamped against the new size.
    override buildSpreadSVGPath(geo: RectGeo, spread: number): string | null {
        const left = geo.left - spread, top = geo.top - spread;
        const right = geo.right + spread, bottom = geo.bottom + spread;
        const w = right - left, h = bottom - top;
        if (w <= 0 || h <= 0) return null;
        const tl: CornerSpec = { ...geo.tl, radius: Math.max(0, geo.tl.radius + spread) };
        const tr: CornerSpec = { ...geo.tr, radius: Math.max(0, geo.tr.radius + spread) };
        const br: CornerSpec = { ...geo.br, radius: Math.max(0, geo.br.radius + spread) };
        const bl: CornerSpec = { ...geo.bl, radius: Math.max(0, geo.bl.radius + spread) };
        const scale = cornerScale(w, h, tl, tr, br, bl);
        tl.radius *= scale; tr.radius *= scale; br.radius *= scale; bl.radius *= scale;
        if (tl.radius === 0 && tr.radius === 0 && br.radius === 0 && bl.radius === 0) return svgOf((sink) => plainRect(sink, left, top, right, bottom));
        return svgOf((sink) => roundedRect(sink, left, top, right, bottom, tl, tr, br, bl));
    }

    override computeBounds(geo: RectGeo): Bounds {
        return { left: geo.left, top: geo.top, right: geo.right, bottom: geo.bottom };
    }
}

/** The uniform scale that keeps every pair of adjacent radii within the side they share. */
function cornerScale(w: number, h: number, tl: CornerSpec, tr: CornerSpec, br: CornerSpec, bl: CornerSpec): number {
    const rTL = cornerReach(tl), rTR = cornerReach(tr), rBR = cornerReach(br), rBL = cornerReach(bl);
    const top = rTL + rTR > 0 ? Math.min(1, w / (rTL + rTR)) : 1;
    const bottom = rBL + rBR > 0 ? Math.min(1, w / (rBL + rBR)) : 1;
    const left = rTL + rBL > 0 ? Math.min(1, h / (rTL + rBL)) : 1;
    const right = rTR + rBR > 0 ? Math.min(1, h / (rTR + rBR)) : 1;
    return Math.min(top, bottom, left, right);
}
