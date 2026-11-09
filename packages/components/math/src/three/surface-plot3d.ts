import {
    colorOps,
    component3d,
    Geo,
    Graphics3D,
    Mat,
    Material,
    Types,
    type ChildSpace3D,
    type Color,
    type Geometry3D,
    type Material3D,
    type Mesh3DProps,
    type NodeOf,
    type NormalizedColor,
    type Values,
    type Vector3,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Blend3D as _Blend3D,
    type Color as _Color,
    type Faces3D as _Faces3D,
    type Fill3D as _Fill3D,
    type Node3D as _Node3D,
    type Node3DProps as _Node3DProps,
    type NormalizedColor as _NormalizedColor,
    type Shading3D as _Shading3D,
    type Texture3D as _Texture3D,
} from "@motionscript/sdk";
import type { Interval } from "../kit/coords";
import { parseSurface, surfaceParams, type SurfaceEquation } from "../kit/equation3d";
import type { ExpressionScope } from "../kit/expression";
import { PLOT_COLOR } from "../kit/furniture";
import { clamp } from "../kit/geometry";
import { colorAt, lerpScale, readScale } from "../kit/scale";
import { lerpParams, lerpSource, readSource, revisionOf, scopeFor, type PlotSource } from "../kit/source";
import { domainEntry, meshEntries } from "./entries";
import { graphEntry, graphOf, type GraphSpace } from "./space";

export interface SurfacePlot3dProps extends Mesh3DProps {
    expression?: string | PlotSource;
    uDomain?: Interval | null;
    vDomain?: Interval | null;
    params?: ExpressionScope;
    segments?: number;
    colorScale?: Color[];
    meshLines?: number;
    meshColor?: Color;
    floorShadow?: number;
}

/** A graph point for grid coordinate `(u, v)`, both 0 to 1, written into `out`. */
type SurfaceSampler = (u: number, v: number, out: Vector3) => void;

const state = {
    ...meshEntries,
    expression: Types.custom<string | PlotSource, PlotSource>("", {
        resolve: readSource,
        lerp: lerpSource,
        kind: "surfaceEquation",
    }),
    /**
     * The span of each variable that is drawn: x and y for a height, which run
     * the width of the axes when left out, u and v for a parametric surface,
     * which run from 0 to 1.
     */
    uDomain: domainEntry(-3, 3),
    vDomain: domainEntry(-3, 3),
    /** The equation's named values: any name in it that is not a variable, a function or a constant. */
    params: Types.custom<ExpressionScope>({}, { lerp: lerpParams }),
    /** How finely the surface is sampled, each way. */
    segments: Types.number(48, { min: 2, max: 256, step: 1, animatable: false }),
    /** Colours by height, lowest first, over the axes' z range. Empty paints the surface in its fill. */
    colorScale: Types.custom<Color[], NormalizedColor[]>([], { resolve: readScale, lerp: lerpScale, kind: "vector" }),
    /** How many lines are drawn across the surface each way; zero leaves it bare. */
    meshLines: Types.number(12, { min: 0, max: 64, step: 1, animatable: false }),
    meshColor: Types.custom<Color, Color>("#0b1220", { kind: "color" }),
    /** The opacity of the surface's shadow, laid flat on the floor of the axes and coloured by height; zero draws none. */
    floorShadow: Types.number(0, { min: 0, max: 1, step: 0.01 }),
    graph: graphEntry(),
};

/** What a surface is drawn from: its own entries, as its node and its helpers read them. */
export type SurfaceValues = Values<typeof state> & { readonly x: number; readonly y: number; readonly z: number };

/**
 * A surface in a 3D graph: a height over x and y (`sin(x) * cos(y)`), or three
 * parts in u and v. A point put inside it rides it.
 */
export const SurfacePlot3d = component3d({
    key: "surfacePlot3d",
    state,
    defaults: { fill: PLOT_COLOR },
    commands: {
        /** Change the equation, the surface bending from the one into the other. */
        morphTo: { args: ["expression"] },
        /** Animate the equation's named values. */
        paramsTo: { args: ["params"] },
        /** Animate the spans that are drawn. */
        domainTo: { args: ["uDomain", "vDomain"] },
    },
    space: (s) => surfaceSpace(s),
    render: (ctx, s) => ctx.draw(ctx.declaring ? declaredSurface(s) : drawSurface(s)),
});

export type SurfacePlot3d = NodeOf<typeof SurfacePlot3d>;

/**
 * The surface's height above its own origin at graph `(x, y)`, or `NaN`
 * where it has none or is not a height. What a point riding it reads.
 */
export function surfaceValueAt(surface: Pick<SurfaceValues, "expression" | "params">, x: number, y: number): number {
    const { source, blend } = surface.expression;
    const value = heightOf(surface, source, x, y);
    if (!blend) return value;
    const from = heightOf(surface, blend.from, x, y);
    return from + (value - from) * blend.t;
}

/** A point inside a surface stands on it: its `x` and `y` say where, and its height is the surface's. */
function surfaceSpace(s: SurfaceValues): ChildSpace3D | null {
    const space = graphOf(s);
    if (!space) return null;
    return {
        toLocal: (x, y, z) => {
            const height = surfaceValueAt(s, x, y);
            return space.offset(x, y, Number.isFinite(height) ? height : z);
        },
    };
}

/** Its paint on a stand-in: only a material loads, and reading no equation keeps a morph from re-declaring. */
function declaredSurface(s: SurfaceValues): Graphics3D {
    const paint = Material.shorthand(s);
    return new Graphics3D().plane(s.colorScale.length > 0 ? { ...paint, fill: "white" } : paint);
}

function drawSurface(s: SurfaceValues): Graphics3D {
    const g3 = new Graphics3D();
    const space = graphOf(s);
    const lines = space ? meshLines(s, space) : [];
    const scaled = s.colorScale.length > 0;
    // A surface is seen from both sides; a vertex colour multiplies the fill, so a scale is shown on white.
    const surface = { ...s, faces: s.faces ?? "both", ...(scaled ? { vertexColors: true, fill: "white" } : {}) };
    for (const op of Material.mesh(surface, space ? surfaceGeometry(s, space) : undefined).ops()) {
        if (op.kind !== "mesh") continue;
        g3.mesh(op.geometry, mapMaterials(op.material, (material) => ({
            ...material,
            // Pushed back a hair so the lines drawn on it are not fought for, and blended rather than a hole when faded.
            ...(lines.length > 0 ? { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } : {}),
            ...((s.opacity ?? 1) < 1 ? { depthWrite: false } : {}),
        } as Material3D)), op.transform);
    }
    if (lines.length > 0) {
        const color = colorOps.resolve(s.meshColor);
        g3.line({ points: lines, segments: true, stroke: { fill: color }, opacity: color[3] * (s.opacity ?? 1) });
    }
    const shadow = space && s.floorShadow > 0 ? floorShadow(s, space) : undefined;
    if (shadow) {
        g3.mesh(shadow, Mat.basic({
            color: scaled ? "white" : PLOT_COLOR,
            vertexColors: scaled,
            opacity: s.floorShadow * (s.opacity ?? 1),
            transparent: true,
            // Translucent and under everything: writing depth would hide the floor's grid lines behind it.
            depthWrite: false,
            faces: "both",
        }));
    }
    return g3;
}

function surfaceGeometry(s: SurfaceValues, space: GraphSpace): Geometry3D | undefined {
    const sample = sampler(s, space);
    if (!sample) return undefined;
    const scale = s.colorScale;
    const point: Vector3 = { x: 0, y: 0, z: 0 };
    const low = space.offset(0, 0, space.zRange[0] - s.z).y;
    const high = space.offset(0, 0, space.zRange[1] - s.z).y;
    return Geo.parametric({
        segments: Math.max(2, Math.round(s.segments)),
        vertex: (u, v) => {
            sample(u, v, point);
            return space.offset(point.x, point.y, point.z);
        },
        ...(scale.length > 0
            ? { color: (_u, _v, position) => colorAt(scale, high > low ? (position.y - low) / (high - low) : 0) }
            : {}),
        computeNormals: true,
        revision: revisionOf(`${keyOf(s, space)}|${JSON.stringify(scale)}`),
    });
}

function heightOf(surface: Pick<SurfaceValues, "params">, source: string, x: number, y: number): number {
    const equation = equationOf(source);
    if (equation?.kind !== "height") return NaN;
    return equation.f(x, y, scopeFor(surfaceParams(source), surface.params));
}

function keyOf(s: SurfaceValues, space: GraphSpace): string {
    const { source, blend } = s.expression;
    return [source, blend?.from, blend?.t, space.revision, s.uDomain, s.vDomain, JSON.stringify(s.params), s.x, s.y, s.z].join("|");
}

function sampler(s: SurfaceValues, space: GraphSpace): SurfaceSampler | null {
    const { source, blend } = s.expression;
    const to = surfaceOf(s, source, space);
    if (!to || !blend) return to;
    const from = surfaceOf(s, blend.from, space);
    if (!from) return to;
    const start: Vector3 = { x: 0, y: 0, z: 0 };
    return (u, v, out) => {
        from(u, v, start);
        to(u, v, out);
        out.x = start.x + (out.x - start.x) * blend.t;
        out.y = start.y + (out.y - start.y) * blend.t;
        out.z = start.z + (out.z - start.z) * blend.t;
    };
}

/** `source` as graph points, measured from the surface's own position. */
function surfaceOf(s: SurfaceValues, source: string, space: GraphSpace): SurfaceSampler | null {
    const equation = equationOf(source);
    if (!equation) return null;
    const params = scopeFor(surfaceParams(source), s.params);
    if (equation.kind === "parametric") {
        const [u0, u1] = s.uDomain ?? [0, 1];
        const [v0, v1] = s.vDomain ?? [0, 1];
        const { x, y, z } = equation;
        return (u, v, out) => {
            const a = u0 + (u1 - u0) * u;
            const b = v0 + (v1 - v0) * v;
            out.x = finite(x(a, b, params));
            out.y = finite(y(a, b, params));
            out.z = finite(z(a, b, params));
        };
    }
    const [x0, x1] = s.uDomain ?? [space.xRange[0] - s.x, space.xRange[1] - s.x];
    const [y0, y1] = s.vDomain ?? [space.yRange[0] - s.y, space.yRange[1] - s.y];
    // Held inside the axes: a pole would otherwise stretch one triangle across the scene.
    const low = space.zRange[0] - s.z;
    const high = space.zRange[1] - s.z;
    const { f } = equation;
    return (u, v, out) => {
        out.x = x0 + (x1 - x0) * u;
        out.y = y0 + (y1 - y0) * v;
        out.z = clamp(finite(f(out.x, out.y, params)), low, high);
    };
}

function floorShadow(s: SurfaceValues, space: GraphSpace): Geometry3D | undefined {
    const sample = sampler(s, space);
    if (!sample) return undefined;
    const scale = s.colorScale;
    const [low, high] = space.zRange;
    const floor = low - s.z;
    const point: Vector3 = { x: 0, y: 0, z: 0 };
    return Geo.parametric({
        segments: Math.max(2, Math.round(s.segments)),
        vertex: (u, v) => {
            sample(u, v, point);
            return space.offset(point.x, point.y, floor);
        },
        ...(scale.length > 0
            ? {
                color: (u: number, v: number) => {
                    sample(u, v, point);
                    return colorAt(scale, high > low ? (point.z + s.z - low) / (high - low) : 0);
                },
            }
            : {}),
        revision: revisionOf(`${keyOf(s, space)}|${JSON.stringify(scale)}|floor`),
    });
}

/** The last lines drawn for each surface, kept while what they are drawn from is unchanged. */
const linesDrawn = new WeakMap<object, { readonly key: string; readonly lines: Vector3[] }>();

function meshLines(s: SurfaceValues, space: GraphSpace): Vector3[] {
    const count = Math.round(s.meshLines);
    const sample = count > 0 ? sampler(s, space) : null;
    if (!sample) return [];
    const steps = Math.max(2, Math.round(s.segments));
    const key = `${keyOf(s, space)}|${count}|${steps}`;
    const kept = linesDrawn.get(s);
    if (kept?.key === key) return kept.lines;
    const lines: Vector3[] = [];
    const point: Vector3 = { x: 0, y: 0, z: 0 };
    const at = (u: number, v: number): Vector3 => {
        sample(u, v, point);
        return space.offset(point.x, point.y, point.z);
    };
    for (let i = 0; i <= count; i++) {
        const fixed = i / count;
        for (let j = 0; j < steps; j++) {
            lines.push(at(fixed, j / steps), at(fixed, (j + 1) / steps));
            lines.push(at(j / steps, fixed), at((j + 1) / steps, fixed));
        }
    }
    linesDrawn.set(s, { key, lines });
    return lines;
}

function equationOf(source: string): SurfaceEquation | null {
    const equation = parseSurface(source, surfaceParams(source));
    return equation instanceof Error ? null : equation;
}

// A hole in the data is drawn flat rather than as a hole in the mesh.
function finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function mapMaterials(
    material: Material3D | readonly Material3D[],
    change: (material: Material3D) => Material3D,
): Material3D | readonly Material3D[] {
    return Array.isArray(material) ? (material as readonly Material3D[]).map(change) : change(material as Material3D);
}
