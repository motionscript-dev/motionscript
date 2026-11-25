import type { Color } from "@/attributes/shape/fill/color/parser";
import type { Stroke } from "@/attributes/shape/stroke/stroke";
import { lerpFill3D, type Fill3D } from "@/render3d/fill3d";
import type { Bevel3D, Geometry3D, PolyhedronGeometry3D, BoxGeometry3D, CapsuleGeometry3D, CircleGeometry3D, ConeGeometry3D, CylinderGeometry3D, ExtrudeGeometry3D, LatheGeometry3D, PlaneGeometry3D, RingGeometry3D, SphereGeometry3D, TorusGeometry3D, TorusKnotGeometry3D, TubeGeometry3D } from "@/render3d/geometry";
import { Graphics3D, type LineStroke3D, type ModelAnimation3D } from "@/render3d/graphics3d";
import type { Material3D, Shading3D } from "@/render3d/material";
import type { Segments3D } from "@/render3d/segments";
import type { Transform3D, Blend3D, Faces3D } from "@/render3d/transform";
import type { Vector3Input } from "@/render3d/vector3";
import type { NodeOf, Type } from "@/components/factory/api";
import { component3d } from "@/components/factory/component3d";
import { Types } from "@/components/factory/types";
import * as Material from "@/components/modules/material";
import * as Paint3D from "@/components/modules/paint3d";
import { optional, optionalBoolean, optionalNumber, optionalNumeric, optionalPath, optionalPoints, stated } from "@/components/modules/three-entries";
import type { Vector2 } from "@/attributes/layout/vector2";
import { resolveVector3 } from "@/render3d/vector3";
import type { Node3DProps } from "@/components/trees/three/node3d";
import type { Texture3D } from "@/render3d/texture";

/** The 3D tree: groups, meshes, other drawables, lights, camera, fog and environment. */

export const Group3D = component3d({ key: "group3d" });
export type Group3D = NodeOf<typeof Group3D>;

const mesh = { geometry: optional<Geometry3D>(), ...Material.state };

export const Mesh3D = component3d({
    key: "mesh3d",
    state: mesh,
    render: (ctx, s) => ctx.draw(Material.mesh(s, s.geometry)),
});
export type Mesh3D = NodeOf<typeof Mesh3D>;

const size = () => optionalNumber({ min: 0, step: 0.1 });
const angle = () => optionalNumber({ step: 1, unit: "°" });
const segments = () => optionalNumeric<Segments3D>({ min: 1, step: 1 });
const sweep = { startAngle: angle(), sweep: angle() };
const SWEEP_KEYS = ["startAngle", "sweep"] as const;

/** A mesh of one built-in shape: `keys` are the entries its geometry descriptor takes. */
function shape3d<const K extends string, const S extends Record<string, Type<unknown>>>(
    key: K, type: Geometry3D["type"], own: S, keys: readonly string[],
) {
    return component3d({
        key,
        state: { ...mesh, ...own },
        render: (ctx, s) => ctx.draw(Material.mesh(s as never, stated<Geometry3D>(type, s, keys))),
    });
}

export const Box3D = shape3d("box3d", "box", {
    width: size(), height: size(), depth: size(),
    cornerRadius: optionalNumber({ min: 0, step: 0.01 }), segments: segments(),
}, ["width", "height", "depth", "cornerRadius", "segments"]);
export type Box3D = NodeOf<typeof Box3D>;

export const Sphere3D = shape3d("sphere3d", "sphere", {
    radius: size(), segments: segments(), ...sweep,
    startLatitude: angle(), latitudeSweep: angle(),
}, ["radius", "segments", "startLatitude", "latitudeSweep", ...SWEEP_KEYS]);
export type Sphere3D = NodeOf<typeof Sphere3D>;

export const Plane3D = shape3d("plane3d", "plane", {
    width: size(), height: size(), segments: segments(),
}, ["width", "height", "segments"]);
export type Plane3D = NodeOf<typeof Plane3D>;

export const Cylinder3D = shape3d("cylinder3d", "cylinder", {
    radius: optionalNumeric<number | readonly [number, number]>({ min: 0, step: 0.1 }), height: size(),
    segments: segments(), capped: optionalBoolean(), ...sweep,
}, ["radius", "height", "segments", "capped", ...SWEEP_KEYS]);
export type Cylinder3D = NodeOf<typeof Cylinder3D>;

export const Cone3D = shape3d("cone3d", "cone", {
    radius: size(), height: size(), segments: segments(), capped: optionalBoolean(), ...sweep,
}, ["radius", "height", "segments", "capped", ...SWEEP_KEYS]);
export type Cone3D = NodeOf<typeof Cone3D>;

export const Torus3D = shape3d("torus3d", "torus", {
    radius: size(), thickness: optionalNumber({ min: 0, step: 0.05 }), segments: segments(), ...sweep,
}, ["radius", "thickness", "segments", ...SWEEP_KEYS]);
export type Torus3D = NodeOf<typeof Torus3D>;

export const TorusKnot3D = shape3d("torus-knot3d", "torusKnot", {
    radius: size(), thickness: optionalNumber({ min: 0, step: 0.05 }), segments: segments(),
    windings: optionalNumeric<readonly [number, number]>({ min: 1, step: 1 }),
}, ["radius", "thickness", "segments", "windings"]);
export type TorusKnot3D = NodeOf<typeof TorusKnot3D>;

export const Circle3D = shape3d("circle3d", "circle", {
    radius: size(), segments: segments(), ...sweep,
}, ["radius", "segments", ...SWEEP_KEYS]);
export type Circle3D = NodeOf<typeof Circle3D>;

export const Ring3D = shape3d("ring3d", "ring", {
    radius: size(), innerRadius: size(), segments: segments(), ...sweep,
}, ["radius", "innerRadius", "segments", ...SWEEP_KEYS]);
export type Ring3D = NodeOf<typeof Ring3D>;

export const Capsule3D = shape3d("capsule3d", "capsule", {
    radius: size(), height: size(), segments: segments(),
}, ["radius", "height", "segments"]);
export type Capsule3D = NodeOf<typeof Capsule3D>;

export const Polyhedron3D = component3d({
    key: "polyhedron3d",
    state: { ...mesh, shape: Types.oneOf(["tetrahedron", "octahedron", "icosahedron", "dodecahedron"] as const, { default: "icosahedron" }), radius: size(), segments: optionalNumeric<Segments3D>({ min: 0, step: 1 }) },
    render: (ctx, s) => ctx.draw(Material.mesh(s, stated<Geometry3D>("polyhedron", s, ["shape", "radius", "segments"]))),
});
export type Polyhedron3D = NodeOf<typeof Polyhedron3D>;

/** A 2D outline swept into a solid `depth` deep; a path with no outline draws nothing. */
export const Extrude3D = component3d({
    key: "extrude3d",
    state: {
        ...mesh, path: optionalPath(), depth: optionalNumber({ min: 0, step: 0.05 }), segments: segments(),
        bevel: optionalNumeric<number | Bevel3D>({ min: 0, step: 0.01 }),
    },
    render: (ctx, s) => {
        if (typeof s.path === "string" ? s.path.trim() === "" : !s.path) return;
        ctx.draw(Material.mesh(s, stated<Geometry3D>("extrude", s, ["path", "depth", "segments", "bevel"])));
    },
});
export type Extrude3D = NodeOf<typeof Extrude3D>;

/** A profile of `{ x, y }` points (`x` the radius, `y` the height) turned about the vertical axis. */
export const Lathe3D = component3d({
    key: "lathe3d",
    state: { ...mesh, points: optionalPoints<Vector2 | Vector3Input>("vector2"), segments: segments(), ...sweep },
    render: (ctx, s) => {
        if ((s.points?.length ?? 0) < 2) return;
        const points = s.points!.map((p): Vector3Input => {
            const v = resolveVector3(p as Vector3Input);
            return [v.x, v.y, 0];
        });
        ctx.draw(Material.mesh(s, { ...stated<Geometry3D>("lathe", s, ["segments", ...SWEEP_KEYS]), points } as Geometry3D));
    },
});
export type Lathe3D = NodeOf<typeof Lathe3D>;

/** A round cross-section `radius` wide swept along `points`. */
export const Tube3D = component3d({
    key: "tube3d",
    state: { ...mesh, points: optionalPoints<Vector3Input>("vector3"), radius: size(), segments: segments(), closed: optionalBoolean() },
    render: (ctx, s) => {
        if ((s.points?.length ?? 0) < 2) return;
        ctx.draw(Material.mesh(s, stated<Geometry3D>("tube", s, ["points", "radius", "segments", "closed"])));
    },
});
export type Tube3D = NodeOf<typeof Tube3D>;

export const Instances3D = component3d({
    key: "instances3d",
    state: { ...mesh, instances: optional<readonly Transform3D[]>(), colors: optional<readonly Color[]>() },
    render: (ctx, s) => {
        if (!s.geometry || !s.instances?.length) return;
        ctx.draw(new Graphics3D().instances(s.geometry, Material.single(s), s.instances, { colors: s.colors }));
    },
});
export type Instances3D = NodeOf<typeof Instances3D>;

export const Points3D = component3d({
    key: "points3d",
    state: mesh,
    render: (ctx, s) => {
        if (s.geometry) ctx.draw(new Graphics3D().points(s.geometry, Material.points(s)));
    },
});
export type Points3D = NodeOf<typeof Points3D>;

/** Consecutive points as segments (pairs of them with `pairs`), and the last back to the first when `closed`. */
function lineSegments(points: readonly Vector3Input[], closed: boolean, pairs: boolean): Paint3D.Segment3D[] {
    const at = points.map((p): Paint3D.Vec3 => {
        const v = resolveVector3(p);
        return [v.x, v.y, v.z];
    });
    const out: Paint3D.Segment3D[] = [];
    for (let i = 0; i + 1 < at.length; i += pairs ? 2 : 1) out.push([at[i], at[i + 1]]);
    if (closed && !pairs && at.length > 2) out.push([at[at.length - 1], at[0]]);
    return out;
}

/** The first solid colour a stroke's layers name: what a line drawn from a geometry takes. */
function strokeColor(stroke: readonly { readonly fill: readonly unknown[] }[]): Color | undefined {
    for (const layer of stroke) {
        for (const fill of layer.fill) {
            if ((fill as { type?: string }).type === "solid") return (fill as { color: Color }).color;
        }
    }
    return undefined;
}

/** A polyline through `points`, painted with `stroke` as a 3D component's lines are; a `geometry` or `material` draws it as a GPU line instead. */
export const Line3D = component3d({
    key: "line3d",
    state: {
        points: optionalPoints<Vector3Input>("vector3"),
        geometry: optional<Geometry3D>(),
        closed: Types.custom(false),
        segments: Types.custom(false),
        stroke: Paint3D.state.stroke,
        opacity: optionalNumber({ min: 0, max: 1, step: 0.01 }),
        material: optional<Material3D>(),
    },
    defaults: { stroke: { fill: "#ffffff", weight: 20 } },
    commands: { strokeTo: Paint3D.commands.strokeTo },
    render: (ctx, s) => {
        if (s.geometry || s.material) {
            if (!s.geometry && !s.points?.length) return;
            const color = strokeColor(s.stroke);
            const stroke: LineStroke3D | undefined = color === undefined ? undefined : { fill: color };
            ctx.draw(new Graphics3D().line({
                points: s.geometry ? undefined : s.points, geometry: s.geometry, closed: s.closed, segments: s.segments,
                stroke, opacity: s.opacity, material: s.material,
            }));
            return;
        }
        if ((s.points?.length ?? 0) < 2) return;
        ctx.draw(Paint3D.lines(new Graphics3D(), s.stroke, lineSegments(s.points!, s.closed, s.segments)));
    },
});
export type Line3D = NodeOf<typeof Line3D>;

export const Sprite3D = component3d({
    key: "sprite3d",
    state: {
        fill: Types.custom<Fill3D | undefined>(undefined, { lerp: lerpFill3D as never, kind: "fills" }),
        opacity: optionalNumber({ min: 0, max: 1, step: 0.01 }),
        material: optional<Material3D>(),
    },
    render: (ctx, s) => ctx.draw(new Graphics3D().sprite({ fill: s.fill as Fill3D, opacity: s.opacity, material: s.material })),
});
export type Sprite3D = NodeOf<typeof Sprite3D>;

export const Model3D = component3d({
    key: "model3d",
    state: {
        src: optional<string>(),
        animation: optional<readonly ModelAnimation3D[] | ModelAnimation3D>(),
        override: optional<Readonly<Record<string, Material3D>>>(),
    },
    render: (ctx, s) => {
        if (s.src) ctx.draw(new Graphics3D().model({ src: s.src, animation: s.animation, override: s.override }));
    },
});
export type Model3D = NodeOf<typeof Model3D>;

/**
 * A loaded model with its animation as two flat entries, `clip` (a name, or the index as a string; empty is the
 * first) and `clipTime` (seconds), since the timeline tweens a number but `Model3D.animation` is a list of records.
 * Still sampled at an explicit time, so seeking and playing give the same pose. Before a file is picked it draws an
 * unlit wireframe unit box, as a node recording no geometry has no box to pick or outline. Not registered: an
 * editor's node, not document API.
 */
export const ModelView3D = component3d({
    key: "modelView3d",
    state: {
        src: optional<string>(),
        animation: optional<readonly ModelAnimation3D[] | ModelAnimation3D>(),
        override: optional<Readonly<Record<string, Material3D>>>(),
        clip: "",
        clipTime: 0,
    },
    render: (ctx, s) => {
        if (!s.src) {
            ctx.draw(new Graphics3D().box({
                width: 1, height: 1, depth: 1,
                material: { type: "basic", color: "#6b7280", wireframe: true, transparent: true, opacity: 0.7 },
            }));
            return;
        }
        ctx.draw(new Graphics3D().model({ src: s.src, animation: { clip: modelClip(s.clip), time: s.clipTime }, override: s.override }));
    },
});
export type ModelView3D = NodeOf<typeof ModelView3D>;

/** A clip name, or a whole number as an index (`"0"` is the first clip, not one named `0`), or unset when empty. */
function modelClip(clip: string): string | number | undefined {
    const trimmed = clip.trim();
    if (trimmed === "") return undefined;
    const index = Number(trimmed);
    return Number.isInteger(index) && index >= 0 ? index : trimmed;
}

// What code building a 3D node names its props as.

type ParamsOf<G extends { type: string }> = Omit<G, "type">;

export type Group3DProps = Node3DProps;

/** The material shorthand as node props: exactly the keys {@link MaterialShorthand3D} promotes onto `Graphics3D` sugar methods, so `Box3D({ fill: "red" })` and `g3.box({ fill: "red" })` describe the same mesh, and each is tweenable. Renderer knobs (`depthWrite`, `alphaTest`, ...) live only on a `Mat.*` descriptor passed through {@link material}; `transparent` is derived; texture slots are fills. */
export interface Material3DProps {
    /** A full descriptor (or an array, for multi-material). Wins over the rest. */
    material: Material3D | readonly Material3D[] | undefined;
    /** What the surface is made of — the same value a 2D `fill` takes. */
    fill: Fill3D;
    opacity: number;
    roughness: number;
    metalness: number;
    emission: Color | undefined;
    emissionStrength: number;
    normalMap: Texture3D | undefined;
    roughnessMap: Texture3D | undefined;
    metalnessMap: Texture3D | undefined;
    aoMap: Texture3D | undefined;
    alphaMap: Texture3D | undefined;
    envMapIntensity: number;
    wireframe: boolean;
    /** Facet or smooth shading. Default `"smooth"`. */
    shading: Shading3D;
    /** Which faces to rasterize. Default `"front"`. */
    faces: Faces3D;
    vertexColors: boolean;
    blend: Blend3D;
    /** Shade with an unlit `basic` material instead of `standard`. */
    unlit: boolean;
}

export interface Mesh3DProps extends Node3DProps, Partial<Material3DProps> {
    /** The geometry to draw. Set directly, or built from a geometry component's entries. */
    geometry: Geometry3D;
}

export interface Box3DProps extends Mesh3DProps, Partial<ParamsOf<BoxGeometry3D>> { }

export interface Sphere3DProps extends Mesh3DProps, Partial<ParamsOf<SphereGeometry3D>> { }

export interface Plane3DProps extends Mesh3DProps, Partial<ParamsOf<PlaneGeometry3D>> { }

export interface Cylinder3DProps extends Mesh3DProps, Partial<ParamsOf<CylinderGeometry3D>> { }

export interface Cone3DProps extends Mesh3DProps, Partial<ParamsOf<ConeGeometry3D>> { }

export interface Torus3DProps extends Mesh3DProps, Partial<ParamsOf<TorusGeometry3D>> { }

export interface TorusKnot3DProps extends Mesh3DProps, Partial<ParamsOf<TorusKnotGeometry3D>> { }

export interface Circle3DProps extends Mesh3DProps, Partial<ParamsOf<CircleGeometry3D>> { }

export interface Ring3DProps extends Mesh3DProps, Partial<ParamsOf<RingGeometry3D>> { }

export interface Capsule3DProps extends Mesh3DProps, Partial<ParamsOf<CapsuleGeometry3D>> { }

export interface Polyhedron3DProps extends Mesh3DProps, Partial<ParamsOf<PolyhedronGeometry3D>> { }

export interface Extrude3DProps extends Mesh3DProps, Partial<ParamsOf<ExtrudeGeometry3D>> { }

export interface Lathe3DProps extends Mesh3DProps, Partial<Omit<ParamsOf<LatheGeometry3D>, "points">> {
    /** The profile: `x` is the radius, `y` the height. */
    points: readonly (Vector2 | Vector3Input)[];
}

export interface Tube3DProps extends Mesh3DProps, Partial<ParamsOf<TubeGeometry3D>> { }

export interface Instances3DProps extends Mesh3DProps {
    /** Per-instance placement. Its length drives the instance count. */
    instances: readonly Transform3D[];
    /** Per-instance tint. Needs a material that reads instance colour. */
    colors: readonly Color[] | undefined;
}

export type Points3DProps = Mesh3DProps;

export interface Line3DProps extends Node3DProps {
    /** The polyline's vertices. Give this or {@link geometry}, not both. */
    points: readonly Vector3Input[];
    /** An explicit geometry to draw the lines of (`Geo.edges(...)` for a wireframe outline); wins over {@link points}. */
    geometry: Geometry3D;
    closed: boolean;
    segments: boolean;
    /** A paint, as a 2D stroke: each layer's weight and dash in thousandths of a scene unit. */
    stroke: Stroke;
    opacity: number | undefined;
    material: Material3D | undefined;
}

export interface Sprite3DProps extends Node3DProps {
    /** What the billboard shows — the same value a 2D `fill` takes. */
    fill: Fill3D;
    opacity: number | undefined;
    material: Material3D | undefined;
}

export interface Model3DProps extends Node3DProps {
    /** Path to a glTF/GLB file. **Only glTF/GLB loads**; any other format (an OBJ included) resolves to an empty slot and draws nothing. */
    src: string;
    /** Baked animation clips, each sampled at an **explicit** time so a model is identical whether played forward or scrubbed to. */
    animation: readonly ModelAnimation3D[] | ModelAnimation3D | undefined;
    /** Replace materials on the loaded graph, keyed by mesh or material name. */
    override: Readonly<Record<string, Material3D>> | undefined;
}
