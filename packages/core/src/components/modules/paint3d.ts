import type { NormalizedColor } from "@/attributes/shape/fill/color/parser";
import type { FillResolved } from "@/attributes/shape/fill/union";
import type { StrokeResolved } from "@/attributes/shape/stroke/stroke";
import { resolveFill3D, type Fill3D } from "@/render3d/fill3d";
import type { Geometry3D } from "@/render3d/geometry";
import type { Graphics3D } from "@/render3d/graphics3d";
import type { BasicMaterial3D, Material3D, StandardMaterial3D } from "@/render3d/material";
import type { Transform3D } from "@/render3d/transform";
import type { Quaternion } from "@/render3d/vector3";
import { Types } from "@/components/factory/types";
import * as Paint from "@/components/modules/paint";

/**
 * A custom 3D node's paint: the same `fill` and `stroke` entries a 2D shape takes, so a 3D component never invents
 * `color`, `lineColor` or `lineWidth`. Spread `...Paint3D.state` and `...Paint3D.commands`, then draw the surface with
 * {@link material} and the lines with {@link lines}. Built-in meshes keep `Material.state`.
 */
export const state = {
    fill: Types.fill,
    stroke: Types.stroke,
};

/** `fillTo` and `strokeTo`, the same commands `Paint` has. */
export const commands = {
    fillTo: Paint.commands.fillTo,
    strokeTo: Paint.commands.strokeTo,
};

/** A point in a node's own 3D space. */
export type Vec3 = readonly [number, number, number];

/** A line segment from one point to another. */
export type Segment3D = readonly [Vec3, Vec3];

/** A stroke `weight`, `dash` or `dashOffset` of 1 is this many scene units: weights are thousandths of a unit. */
export const STROKE_UNIT = 0.001;

/** The surface options {@link material} takes: `type` picks the shading, and every other field is laid over the result. */
export type MaterialOptions =
    | ({ readonly type?: "basic" } & Partial<Omit<BasicMaterial3D, "type">>)
    | ({ readonly type: "standard" } & Partial<Omit<StandardMaterial3D, "type">>);

/** The colour a fill layer is when it is one flat colour with no blend; `null` for anything else. */
function solidOf(layer: FillResolved | undefined): { color: NormalizedColor; alpha: number } | null {
    if (layer === undefined || layer.type !== "solid") return null;
    if (layer.blend !== undefined) return null;
    const color = layer.color;
    return { color, alpha: (color[3] ?? 1) * (layer.opacity ?? 1) };
}

/**
 * The material a surface painted with `fill` wears. Unlit (`basic`) by default; `{ type: "standard" }` lights it.
 *
 * - **One solid layer** becomes `color` with its alpha as `opacity`, so `fillTo` between colours tweens the uniforms
 *   and allocates nothing.
 * - **Anything else** (a gradient, an image, a stack of layers) goes through `resolveFill3D` and becomes a `map`.
 * - **An empty fill** gives an invisible material (`visible: false`), as an empty 2D fill paints nothing.
 *
 * Fields in `extra` are laid over the result; its `opacity` multiplies the fill's.
 */
export function material(fill: readonly FillResolved[], extra: MaterialOptions = {}): Material3D {
    const { type = "basic", opacity: extraOpacity, ...rest } = extra as MaterialOptions & { opacity?: number };
    const scale = extraOpacity ?? 1;
    if (fill.length === 0) return { type, ...rest, visible: false } as Material3D;
    const solid = fill.length === 1 ? solidOf(fill[0]) : null;
    if (solid !== null) {
        const [r, g, b] = solid.color;
        return { type, color: [r, g, b, 1], opacity: solid.alpha * scale, ...rest } as Material3D;
    }
    const resolved = resolveFill3D(fill as unknown as Fill3D);
    return {
        type,
        ...(resolved.color !== undefined ? { color: resolved.color } : {}),
        ...(resolved.map !== undefined ? { map: resolved.map } : {}),
        ...(extraOpacity !== undefined ? { opacity: extraOpacity } : {}),
        ...rest,
    } as Material3D;
}

/** What {@link lines} takes besides the strokes and segments. */
export interface LinesOptions {
    /**
     * Draw through solids: `depthTest: false, depthWrite: false`, and blended so it draws after every opaque mesh. For
     * the hidden lines a CAD view shows dashed through the body.
     */
    readonly through?: boolean;
    /**
     * Added to both ends of every segment: a surface's normal times the gap. A line laid on a face needs a gap of at
     * least the camera distance ÷ 2000 (`docs/3d.md`, Depth rule 2); a bar centred on a solid's edge needs none. Leave
     * it out to place the segments yourself.
     */
    readonly lift?: Vec3;
    /** A transform for the whole draw, as `Graphics3D.instances` takes one. */
    readonly transform?: Transform3D;
}

/** The unit box each bar scales: 1 long on x, 1 by 1 across. */
export const BAR: Geometry3D = { type: "box", width: 1, height: 1, depth: 1 };

/** The turn that carries +x onto the unit direction `d`. */
function turnOnto(dx: number, dy: number, dz: number): Quaternion {
    // About +x cross d, by the angle between them; straight back along -x turns half way round y.
    if (dx <= -0.9999) return { x: 0, y: 1, z: 0, w: 0 };
    const qy = -dz;
    const qz = dy;
    const qw = 1 + dx;
    const l = Math.hypot(qy, qz, qw);
    return { x: 0, y: qy / l, z: qz / l, w: qw / l };
}

/** A square bar from `p` to `q`, `w` across, running `extend` past each end. */
export function bar(p: Vec3, q: Vec3, w: number, extend = 0): Transform3D {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const dz = q[2] - p[2];
    const len = Math.hypot(dx, dy, dz) || 1e-9;
    return {
        position: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2],
        quaternion: turnOnto(dx / len, dy / len, dz / len),
        scale: [len + extend * 2, w, w],
    };
}

/** The pattern a `dash` repeats, in scene units: an odd list runs twice, as in SVG; `null` for a solid line. */
function dashPattern(dash: readonly number[] | undefined): number[] | null {
    if (dash === undefined || dash.length === 0) return null;
    const units = dash.map((d) => Math.max(0, d) * STROKE_UNIT);
    const pattern = units.length % 2 === 1 ? [...units, ...units] : units;
    return pattern.reduce((sum, d) => sum + d, 0) > 1e-9 ? pattern : null;
}

/** The stretches `[from, to]` along a segment `length` long that a dash pattern draws, starting `offset` into it. */
export function dashes(length: number, pattern: readonly number[], offset = 0): [number, number][] {
    const period = pattern.reduce((sum, d) => sum + d, 0);
    const out: [number, number][] = [];
    if (period <= 0 || length <= 0) return out;
    // Start at the beginning of the period the offset falls in, before the segment.
    let at = -(((offset % period) + period) % period);
    let i = 0;
    const end = length - 1e-9;
    while (at < end) {
        const d = pattern[i % pattern.length]!;
        if (i % 2 === 0 && d > 0) {
            const from = Math.max(0, at);
            const to = Math.min(length, at + d);
            if (to - from > 1e-9) out.push([from, to]);
        }
        at += d;
        i++;
    }
    return out;
}

/** The bars one stroke layer draws along `segments`. */
function barsFor(stroke: StrokeResolved, segments: readonly Segment3D[], lift: Vec3 | undefined): Transform3D[] {
    const w = stroke.weight * STROKE_UNIT;
    // `round` has no round end to draw on a box, so it ends flush, as `butt` does.
    const extend = stroke.cap === "square" ? w / 2 : 0;
    const pattern = dashPattern(stroke.dash);
    const offset = stroke.dashOffset * STROKE_UNIT;
    const out: Transform3D[] = [];
    for (const [a, b] of segments) {
        const p: Vec3 = lift ? [a[0] + lift[0], a[1] + lift[1], a[2] + lift[2]] : a;
        const q: Vec3 = lift ? [b[0] + lift[0], b[1] + lift[1], b[2] + lift[2]] : b;
        const length = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        if (length <= 1e-9) continue;
        if (pattern === null) {
            out.push(bar(p, q, w, extend));
            continue;
        }
        const at = (s: number): Vec3 => {
            const t = s / length;
            return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
        };
        for (const [from, to] of dashes(length, pattern, offset)) out.push(bar(at(from), at(to), w, extend));
    }
    return out;
}

/** The unlit material one stroke layer draws with, or `null` when it would draw nothing. */
function strokeMaterial(stroke: StrokeResolved, through: boolean): Material3D | null {
    const solid = stroke.fill.map(solidOf).find((s) => s !== null) ?? null;
    if (solid === null || solid.alpha <= 0) return null;
    const [r, g, b] = solid.color;
    const blended = solid.alpha < 1 || through;
    return {
        type: "basic",
        color: [r, g, b, 1],
        opacity: solid.alpha,
        ...(blended ? { transparent: true, depthWrite: false } : {}),
        ...(through ? { depthTest: false } : {}),
    } as Material3D;
}

/**
 * Draws `segments` with each layer of `stroke`, one `g3.instances` call of unit boxes per layer, bottom to top.
 *
 * - **`weight`, `dash` and `dashOffset` are thousandths of a scene unit**: weight 5.5 is a 0.0055-wide bar, a CAD
 *   hairline on a model a few units across.
 * - **Caps**: `square` runs each bar (and each dash) half the weight past its ends, so outline corners close; `butt`
 *   ends flush. `round` ends flush too, as `butt` does: a box has no round end.
 * - **Colour** is the layer's first solid fill, its alpha the bar's `opacity` (below 1 the bars blend and stop writing
 *   depth). A layer with no solid fill, or nothing opaque in it, draws nothing; so does an empty `stroke`.
 * - `align`, `join`, markers and the shape of `startCap`/`endCap` are 2D path ideas and are ignored.
 */
export function lines(g3: Graphics3D, stroke: readonly StrokeResolved[], segments: readonly Segment3D[], options: LinesOptions = {}): Graphics3D {
    const through = options.through ?? false;
    for (const layer of stroke) {
        if (!(layer.weight > 0)) continue;
        const ink = strokeMaterial(layer, through);
        if (ink === null) continue;
        const bars = barsFor(layer, segments, options.lift);
        if (bars.length === 0) continue;
        g3.instances(BAR, ink, bars, options.transform ? { transform: options.transform } : undefined);
    }
    return g3;
}
