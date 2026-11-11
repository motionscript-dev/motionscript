import {
    component3d,
    Geo,
    Graphics3D,
    Material,
    Types,
    type Geometry3D,
    type NodeOf,
    type Values,
    type Vector3,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Blend3D as _Blend3D,
    type Color as _Color,
    type Faces3D as _Faces3D,
    type Fill3D as _Fill3D,
    type Material3D as _Material3D,
    type Node3D as _Node3D,
    type Node3DProps as _Node3DProps,
    type NormalizedColor as _NormalizedColor,
    type Shading3D as _Shading3D,
    type Texture3D as _Texture3D,
} from "@motionscript/sdk";
import { parseSpaceCurve, spaceCurveParams, type SpaceCurveEquation } from "../kit/equation3d";
import type { ExpressionScope } from "../kit/expression";
import { PLOT_COLOR } from "../kit/furniture";
import { clamp } from "../kit/geometry";
import { lerpParams, lerpSource, readSource, scopeFor, type PlotSource } from "../kit/source";
import { domainEntry, meshEntries } from "./entries";
import { graphEntry, graphOf, type GraphSpace } from "./space";

const state = {
    ...meshEntries,
    expression: Types.custom<string | PlotSource, PlotSource>("", {
        resolve: readSource,
        lerp: lerpSource,
        kind: "spaceCurveEquation",
    }),
    /** The span of `t` that is drawn; 0 to 1 when left out. */
    domain: domainEntry(0, 1),
    params: Types.custom<ExpressionScope>({}, { lerp: lerpParams }),
    /** How many points the curve is drawn through. */
    samples: Types.number(160, { min: 2, max: 2000, step: 1, animatable: false }),
    /** The radius of the line, in scene units. */
    thickness: Types.number(0.04, { min: 0.001, step: 0.005 }),
    /** The part of the curve that is drawn, as shares of its length in `t`. */
    start: Types.number(0, { min: 0, max: 1, step: 0.01 }),
    end: Types.number(1, { min: 0, max: 1, step: 0.01 }),
    graph: graphEntry(),
};

type CurveValues = Values<typeof state>;

/** A curve through a 3D graph, three parts in `t`: `(cos(t), sin(t), t / 4)`. */
export const CurvePlot3d = component3d({
    key: "curvePlot3d",
    state,
    defaults: { fill: PLOT_COLOR },
    commands: {
        /** Change the equation, the curve bending from the one into the other. */
        morphTo: { args: ["expression"] },
        /** Animate the equation's named values. */
        paramsTo: { args: ["params"] },
        /** Animate the span of `t` that is drawn. */
        domainTo: { args: ["domain"] },
        /** Draw the curve on, or wipe it off: animates `start` and `end`. */
        progressTo: { args: ["start", "end"] },
    },
    // Declaring, its paint on a stand-in: only a material loads, and the curve's points are not sampled.
    render: (ctx, s) => ctx.draw(ctx.declaring ? new Graphics3D().plane(Material.shorthand(s)) : Material.mesh(s, curveGeometry(s))),
});

export type CurvePlot3d = NodeOf<typeof CurvePlot3d>;

function curveGeometry(s: CurveValues): Geometry3D | undefined {
    const space = graphOf(s);
    if (!space) return undefined;
    const points = pointsOf(s, space);
    if (points.length < 2) return undefined;
    return Geo.tube({ points, radius: s.thickness, segments: [points.length - 1, 8] });
}

/** The last run drawn for each curve, kept while what it is drawn from is unchanged. */
const runs = new WeakMap<object, { readonly key: string; readonly run: Vector3[] }>();

function pointsOf(s: CurveValues, space: GraphSpace): Vector3[] {
    const { source, blend } = s.expression;
    const start = clamp(s.start, 0, 1);
    const end = clamp(s.end, 0, 1);
    const samples = Math.max(2, Math.round(s.samples));
    const key = [source, blend?.from, blend?.t, space.revision, s.domain, JSON.stringify(s.params), start, end, samples].join("|");
    const kept = runs.get(s);
    if (kept?.key === key) return kept.run;
    const run: Vector3[] = [];
    runs.set(s, { key, run });
    const to = curveOf(s, source);
    if (!to || !(end > start)) return run;
    const from = blend ? curveOf(s, blend.from) : null;
    const steps = Math.max(1, Math.round(samples * (end - start)));
    const a: Vector3 = { x: 0, y: 0, z: 0 };
    const b: Vector3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i <= steps; i++) {
        const u = start + ((end - start) * i) / steps;
        if (!to(u, b)) continue;
        if (from && blend) {
            if (!from(u, a)) continue;
            b.x = a.x + (b.x - a.x) * blend.t;
            b.y = a.y + (b.y - a.y) * blend.t;
            b.z = a.z + (b.z - a.z) * blend.t;
        }
        run.push(space.offset(b.x, b.y, b.z));
    }
    return run;
}

/** `source` as a graph point for a share `u` of its span, or `false` where it has none. */
function curveOf(s: CurveValues, source: string): ((u: number, out: Vector3) => boolean) | null {
    const equation = equationOf(source);
    if (!equation) return null;
    const params = scopeFor(spaceCurveParams(source), s.params);
    const [t0, t1] = s.domain ?? [0, 1];
    const { x, y, z } = equation;
    return (u, out) => {
        const t = t0 + (t1 - t0) * u;
        out.x = x(t, 0, params);
        out.y = y(t, 0, params);
        out.z = z(t, 0, params);
        return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
    };
}

function equationOf(source: string): SpaceCurveEquation | null {
    const equation = parseSpaceCurve(source, spaceCurveParams(source));
    return equation instanceof Error ? null : equation;
}
