// Shape ops to PathData: each shape's geometry (./geometry) emits its outline,
// straight into PathData where it writes to a sink, else as an SVG path string
// parsed here. A plain rect or ellipse also says how the renderer can draw it
// as its own shape (`native`). Shapes are authored y-up, so their position (and
// an ellipse's angles) flip into the node's y-down space first; a shape's own
// rotation/scale then turns its outline about its (x, y) plus pivot.

import { resolvePivotPosition, resolveShapeAlignment, resolveShapePivot, stripShapeAlignmentKeys, toPathString, withTextDescriptor } from "@motionscript/core";
import type { ShapeGeometry } from "./geometry/base";
import { EllipseGeometry } from "./geometry/ellipse";
import { LineGeometry } from "./geometry/line";
import { PathGeometry } from "./geometry/path";
import { PolygonGeometry, PolygramGeometry } from "./geometry/polygon";
import { RectGeometry } from "./geometry/rect";
import { type Mat, type Member, type PathData, pathBounds, type TextSpec } from "../doc";
import { trimPath } from "./path-measure";
import { parseSvgPath } from "./svg-path";

type Any = Record<string, any>;

function flipPositionY(state: Any, width: number, height: number): Any {
    const withPivotOffset = resolvePivotPosition(state as never, width, height);
    const { x, y, pivot } = resolveShapeAlignment(withPivotOffset as never, width, height);
    return { ...stripShapeAlignmentKeys(withPivotOffset as never), x, y: -y, pivot };
}

const negY = (y: number | undefined) => (y == null ? y : -y);

function transformPath(p: PathData, m: [number, number, number, number, number, number]): PathData {
    const pts = new Float32Array(p.points.length);
    for (let i = 0; i < pts.length; i += 2) {
        const x = p.points[i], y = p.points[i + 1];
        pts[i] = m[0] * x + m[2] * y + m[4];
        pts[i + 1] = m[1] * x + m[3] * y + m[5];
    }
    return { ...p, points: pts as never };
}

/** Rotate/scale about the shape's (x, y) + pivot. */
function shapeTransform(full: Any, p: PathData): PathData {
    const rotation = full.rotation ?? 0, scale = full.scale ?? 1;
    if (rotation === 0 && scale === 1) return p;
    const pivot = full.pivot ?? { x: 0, y: 0 };
    const px = (full.x ?? 0) + pivot.x * ((full.width ?? 0) / 2);
    const py = (full.y ?? 0) - pivot.y * ((full.height ?? 0) / 2);
    const r = (rotation * Math.PI) / 180, c = Math.cos(r) * scale, s = Math.sin(r) * scale;
    // Row-major [a b e; c d f] = column form [a, c, b, d, e, f].
    const a = c, b = -s, cc = s, d = c;
    return transformPath(p, [a, cc, b, d, px - a * px - b * py, py - cc * px - d * py]);
}

/** A text op as a doc text node: its spec and placement (shapes/text.ts). */
export interface TextOut {
    spec: TextSpec;
    transform: Mat;
    /** Box for gradient space: the declared box, or the measured block. */
    size: [number, number];
}

const ALIGN: Record<string, TextSpec["align"]> = { left: "left", right: "right", center: "center", justify: "justify", start: "left", end: "right" };

/** buildText's placement: the block laid out about the origin, drawn at
 *  (px, py) — shifted by the pivot when there is no declared box — and turned
 *  and scaled about the pivot point. */
export function textOf(state: Any, measure: (spec: TextSpec) => [number, number]): TextOut | null {
    const f = withTextDescriptor(flipPositionY(state, state.width ?? 0, state.height ?? 0) as never) as Any;
    // Text on a path follows the path verbatim in the node's space (buildText
    // returns before placement: no y flip, no x/y).
    const onPath = f.path != null ? parseSvgPath(toPathString(f.path)) : undefined;
    const autofit = f.fontSize === "autofit";
    const spec: TextSpec = {
        runs: [{
            text: f.text, family: f.fontFamily, size: autofit ? 100 : f.fontSize, weight: f.fontWeight,
            italic: f.fontStyle === "italic" || f.fontStyle === "oblique", letterSpacing: f.letterSpacing,
            decoration: f.textDecoration === "underline" ? "underline" : f.textDecoration === "line-through" ? "lineThrough" : undefined,
        }],
        align: ALIGN[f.textAlign] ?? "left",
        verticalAlign: f.verticalAlign,
        wrap: f.wrap && f.width > 0,
        width: f.width,
        height: f.height,
        lineHeight: f.lineHeight,
        fontSize: autofit ? "autofit" : undefined,
        minFontSize: f.minFontSize,
        path: onPath,
    };
    if (onPath) return { spec, transform: [1, 0, 0, 1, 0, 0], size: [f.width, f.height] };
    const [lw, lh] = measure(spec);
    const pivot = resolveShapePivot(f.pivot) as { x: number; y: number };
    const declared = f.width > 0 && f.height > 0;
    const bw = declared ? f.width : lw, bh = declared ? f.height : lh;
    const px = !declared && pivot.x !== 0 ? f.x - pivot.x * (lw / 2) : f.x;
    const py = !declared && pivot.y !== 0 ? f.y + pivot.y * (lh / 2) : f.y;
    let m: Mat = [1, 0, 0, 1, px, py];
    if ((f.rotation ?? 0) !== 0 || (f.scale ?? 1) !== 1) {
        const cx = px + pivot.x * (bw / 2), cy = py - pivot.y * (bh / 2);
        const r = ((f.rotation ?? 0) * Math.PI) / 180, k = f.scale ?? 1;
        const c = Math.cos(r) * k, sn = Math.sin(r) * k;
        // T(c)·R·S·T(−c)·T(p)
        m = [c, sn, -sn, c, cx + c * (px - cx) - sn * (py - cy), cy + sn * (px - cx) + c * (py - cy)];
    }
    return { spec, transform: m, size: [bw, bh] };
}

/** What a shape op hands the paint ops. */
export interface ShapeOut {
    /** The filled outline (trimmed when the shape is). */
    fill: PathData | null;
    /** What strokes follow: the fill outline unless the shape overrides it. */
    stroke: PathData | null;
    /** The closed region aligned strokes clip against. */
    interior: PathData | null;
    /** The shape's own bounds (gradient space), l t r b. */
    bounds: [number, number, number, number] | null;
    /** Set for a text op: drawn as a text node, not a path. */
    text?: TextOut;
    /** Set for a boolean result or a cut: drawn as one compound node. */
    members?: Member[];
    /** The closed region an aligned stroke clips to when `interior` isn't it (a union's). */
    alignInterior?: Member[];
    /** Trimmed: its outline is a stretch of the shape's. */
    trimmed?: boolean;
    /** The silhouette grown (or shrunk) by a shadow's spread; unset where the
     *  shape ignores spread (only rects and ellipses resize cleanly). */
    spread?: (spread: number) => PathData | null;
    /** Set where the renderer can draw the shape as its own rect or ellipse instead of a path. */
    native?: NativeShape;
}

/** A rect or ellipse as the renderer's own shape: its box in the node's y-down space, corner radii tl tr br bl. */
export interface NativeShape {
    kind: "rect" | "ellipse";
    x: number;
    y: number;
    w: number;
    h: number;
    radii: [number, number, number, number];
}

function parse(svg: string | null | undefined, full: Any): PathData | null {
    if (!svg) return null;
    return shapeTransform(full, parseSvgPath(svg));
}

// Each outline is built on first read: a shape drawn as a native one never needs it.
function viaGeometry(Shape: new (state: Any) => ShapeGeometry<any, any>, state: Any): ShapeOut {
    const shape = new Shape(state);
    const full = shape.fullState as Any, geo = shape.geometry;
    const range = shape.needsTrim() ? shape.getTrimRange() : null;
    const base = once(() => {
        const outline = shape.buildPathData(geo);
        return outline && shapeTransform(full, outline);
    });
    const fill = once(() => {
        const p = base();
        return p && range ? trimPath(p, range.start, range.end) : p;
    });
    const stroke = once(() => {
        // A ratio-1 ellipse fills nothing; it strokes its bare outline or arc.
        const ring = shape instanceof EllipseGeometry ? shape.ringOutline(geo) : null;
        if (ring == null) return fill();
        const outline = parse(ring, full);
        return outline && range ? trimPath(outline, range.start, range.end) : outline;
    });
    const interior = once(() => {
        const svg = shape.buildSVGAlignInterior(geo);
        return svg != null ? parse(svg, full) : range ? base() : fill();
    });
    const b = shape.computeBounds(geo);
    const spread = shape.supportsSpread() ? (s: number) => parse(shape.buildSpreadSVGPath(geo, s), full) : undefined;
    return {
        get fill() { return fill(); },
        get stroke() { return stroke(); },
        get interior() { return interior(); },
        bounds: b ? [b.left, b.top, b.right, b.bottom] : null,
        spread,
        trimmed: !!range,
        native: range ? undefined : nativeOf(shape, full, geo),
    };
}

function once<T>(make: () => T): () => T {
    let made = false;
    let value: T;
    return () => {
        if (!made) {
            value = make();
            made = true;
        }
        return value;
    };
}

/**
 * The shape the renderer draws itself: an unturned, unscaled rect whose corners
 * are all rounded (or square) and within half its shorter side, as the renderer
 * clamps them, or a whole ellipse with no hole.
 */
function nativeOf(shape: ShapeGeometry<any, any>, full: Any, geo: Any): NativeShape | undefined {
    if ((full.rotation ?? 0) !== 0 || (full.scale ?? 1) !== 1) return undefined;
    if (shape instanceof EllipseGeometry) {
        if (!geo.isFullShape || geo.ratio > 0) return undefined;
        const w = geo.halfWidth * 2, h = geo.halfHeight * 2;
        if (!(w > 0 && h > 0) || !Number.isFinite(w + h + geo.cx + geo.cy)) return undefined;
        return { kind: "ellipse", x: geo.cx - geo.halfWidth, y: geo.cy - geo.halfHeight, w, h, radii: [0, 0, 0, 0] };
    }
    if (shape instanceof RectGeometry) {
        const w = geo.right - geo.left, h = geo.bottom - geo.top;
        if (!(w > 0 && h > 0) || !Number.isFinite(w + h + geo.left + geo.top)) return undefined;
        const corners = [geo.tl, geo.tr, geo.br, geo.bl] as { radius: number; style: string }[];
        const limit = Math.min(w, h) / 2;
        if (corners.some((c) => !(c.radius >= 0 && c.radius <= limit) || (c.radius > 0 && c.style === "angled"))) return undefined;
        return { kind: "rect", x: geo.left, y: geo.top, w, h, radii: corners.map((c) => c.radius) as NativeShape["radii"] };
    }
    return undefined;
}

/** A path: data centred on its control-point bounds (or centerBounds), turned about the origin. */
function pathShape(state: Any): ShapeOut {
    const shape = new PathGeometry(state as never);
    const full = shape.fullState as Any;
    const raw = parseSvgPath(shape.buildSVGPath(shape.geometry));
    const [x0, y0, x1, y1] = full.centerBounds ?? pathBounds(raw);
    const ox = -(x0 + (x1 - x0) / 2), oy = -(y0 + (y1 - y0) / 2);
    const centred = transformPath(raw, [1, 0, 0, 1, ox, oy]);
    const base = shapeTransform({ ...full, x: 0, y: 0 }, centred);
    const range = shape.needsTrim() ? shape.getTrimRange() : null;
    const fill = range ? trimPath(base, range.start, range.end) : base;
    return { fill, stroke: fill, interior: range ? base : fill, bounds: null, trimmed: !!range };
}

const negPathY = (state: Any): Any => {
    const out: Any = { ...state, y: negY(state.y) };
    if (Array.isArray(state.data)) {
        out.data = state.data.map((c: Any) => {
            switch (c.type) {
                case "M": case "m": case "L": case "l": case "T": case "t": case "V": case "v": return { ...c, y: -c.y };
                case "C": case "c": return { ...c, y1: -c.y1, y2: -c.y2, y: -c.y };
                case "S": case "s": return { ...c, y2: -c.y2, y: -c.y };
                case "Q": case "q": return { ...c, y1: -c.y1, y: -c.y };
                case "A": case "a": return { ...c, y: -c.y, sweep: c.sweep === 1 ? 0 : 1 };
                default: return c;
            }
        });
        if (state.centerBounds) {
            const [a, b2, c2, d] = state.centerBounds;
            out.centerBounds = [a, -d, c2, -b2];
        }
    }
    return out;
};

/** The op's paths in the node's y-down space, or null when unsupported. */
export function shapeOf(op: { kind: string; state: Any }): ShapeOut | null {
    const s = op.state;
    switch (op.kind) {
        case "rect": return viaGeometry(RectGeometry, flipPositionY(s, s.width ?? 0, s.height ?? 0));
        case "ellipse": {
            const f = flipPositionY(s, s.width ?? 0, s.height ?? 0);
            if (s.startAngle != null) f.startAngle = -s.startAngle;
            if (s.sweep != null) f.sweep = -s.sweep;
            return viaGeometry(EllipseGeometry, f);
        }
        case "polygon": return viaGeometry(PolygonGeometry, flipPositionY(s, s.width ?? 0, s.height ?? 0));
        case "polygram": return viaGeometry(PolygramGeometry, flipPositionY(s, s.width ?? 0, s.height ?? 0));
        case "line": {
            const points = s.points ? s.points.map((p: { x: number; y: number }) => ({ x: p.x, y: -p.y })) : s.points;
            return viaGeometry(LineGeometry, { ...s, y: negY(s.y), points });
        }
        case "path": return pathShape(negPathY(s));
    }
    return null;
}
