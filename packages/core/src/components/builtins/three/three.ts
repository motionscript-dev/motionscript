import type { Color } from "@/attributes/shape/fill/color/parser";
import { ORBIT_CAMERA_DEFAULTS, type CameraData3D } from "@/render3d/camera";
import { lerpFill3D, type Fill3D } from "@/render3d/fill3d";
import type { Geometry3D, PolyhedronGeometry3D, BoxGeometry3D, CapsuleGeometry3D, CircleGeometry3D, ConeGeometry3D, CylinderGeometry3D, ExtrudeGeometry3D, LatheGeometry3D, PlaneGeometry3D, RingGeometry3D, SphereGeometry3D, TorusGeometry3D, TorusKnotGeometry3D, TubeGeometry3D } from "@/render3d/geometry";
import { Graphics3D, type LineStroke3D, type ModelAnimation3D } from "@/render3d/graphics3d";
import type { LightData3D, AmbientLightData3D, AreaLightData3D, DirectionalLightData3D, HemisphereLightData3D, PointLightData3D, SpotLightData3D } from "@/render3d/light";
import type { Material3D, Shading3D } from "@/render3d/material";
import type { EnvironmentData3D, FogData3D } from "@/render3d/scene-settings";
import type { Segments3D } from "@/render3d/segments";
import type { Transform3D, Blend3D, Faces3D } from "@/render3d/transform";
import type { Vector3Input } from "@/render3d/vector3";
import type { NodeOf } from "@/components/factory/api";
import { component3d } from "@/components/factory/component3d";
import { Types } from "@/components/factory/types";
import * as Material from "@/components/modules/material";
import { defined, optional, optionalColor, optionalNumber, optionalVector3, stated } from "@/components/modules/three-entries";
import type { Node3DProps } from "@/components/trees/three/node3d";
import type { Texture3D } from "@/render3d/texture";

/**
 * The 3D tree: groups, meshes and the other drawables, lights, the camera, fog
 * and the environment. Each draws the `Graphics3D` or scene call its class did.
 */

export const Group3D = component3d({ key: "group3d" });
export type Group3D = NodeOf<typeof Group3D>;

// ---- meshes -----------------------------------------------------------------

const mesh = { geometry: optional<Geometry3D>(), ...Material.state };

export const Mesh3D = component3d({
    key: "mesh3d",
    state: mesh,
    render: (ctx, s) => ctx.draw(Material.mesh(s, s.geometry)),
});
export type Mesh3D = NodeOf<typeof Mesh3D>;

const sweep = { startAngle: optional<number>(), sweep: optional<number>() };
const SWEEP_KEYS = ["startAngle", "sweep"] as const;

/** A mesh of one built-in shape: `keys` are the entries its geometry descriptor takes. */
function shape3d<const K extends string, const S extends Record<string, ReturnType<typeof optional>>>(
    key: K, type: Geometry3D["type"], own: S, keys: readonly string[],
) {
    return component3d({
        key,
        state: { ...mesh, ...own },
        render: (ctx, s) => ctx.draw(Material.mesh(s as never, stated<Geometry3D>(type, s, keys))),
    });
}

export const Box3D = shape3d("box3d", "box", {
    width: optional<number>(), height: optional<number>(), depth: optional<number>(),
    cornerRadius: optional<number>(), segments: optional<Segments3D>(),
}, ["width", "height", "depth", "cornerRadius", "segments"]);
export type Box3D = NodeOf<typeof Box3D>;

export const Sphere3D = shape3d("sphere3d", "sphere", {
    radius: optional<number>(), segments: optional<Segments3D>(), ...sweep,
    startLatitude: optional<number>(), latitudeSweep: optional<number>(),
}, ["radius", "segments", "startLatitude", "latitudeSweep", ...SWEEP_KEYS]);
export type Sphere3D = NodeOf<typeof Sphere3D>;

export const Plane3D = shape3d("plane3d", "plane", {
    width: optional<number>(), height: optional<number>(), segments: optional<Segments3D>(),
}, ["width", "height", "segments"]);
export type Plane3D = NodeOf<typeof Plane3D>;

export const Cylinder3D = shape3d("cylinder3d", "cylinder", {
    radius: optional<number | readonly [number, number]>(), height: optional<number>(),
    segments: optional<Segments3D>(), capped: optional<boolean>(), ...sweep,
}, ["radius", "height", "segments", "capped", ...SWEEP_KEYS]);
export type Cylinder3D = NodeOf<typeof Cylinder3D>;

export const Cone3D = shape3d("cone3d", "cone", {
    radius: optional<number>(), height: optional<number>(), segments: optional<Segments3D>(), capped: optional<boolean>(), ...sweep,
}, ["radius", "height", "segments", "capped", ...SWEEP_KEYS]);
export type Cone3D = NodeOf<typeof Cone3D>;

export const Torus3D = shape3d("torus3d", "torus", {
    radius: optional<number>(), thickness: optional<number>(), segments: optional<Segments3D>(), ...sweep,
}, ["radius", "thickness", "segments", ...SWEEP_KEYS]);
export type Torus3D = NodeOf<typeof Torus3D>;

export const TorusKnot3D = shape3d("torus-knot3d", "torusKnot", {
    radius: optional<number>(), thickness: optional<number>(), segments: optional<Segments3D>(),
    windings: optional<readonly [number, number]>(),
}, ["radius", "thickness", "segments", "windings"]);
export type TorusKnot3D = NodeOf<typeof TorusKnot3D>;

export const Circle3D = shape3d("circle3d", "circle", {
    radius: optional<number>(), segments: optional<Segments3D>(), ...sweep,
}, ["radius", "segments", ...SWEEP_KEYS]);
export type Circle3D = NodeOf<typeof Circle3D>;

export const Ring3D = shape3d("ring3d", "ring", {
    radius: optional<number>(), innerRadius: optional<number>(), segments: optional<Segments3D>(), ...sweep,
}, ["radius", "innerRadius", "segments", ...SWEEP_KEYS]);
export type Ring3D = NodeOf<typeof Ring3D>;

export const Capsule3D = shape3d("capsule3d", "capsule", {
    radius: optional<number>(), height: optional<number>(), segments: optional<Segments3D>(),
}, ["radius", "height", "segments"]);
export type Capsule3D = NodeOf<typeof Capsule3D>;

export const Polyhedron3D = component3d({
    key: "polyhedron3d",
    state: { ...mesh, shape: Types.custom<PolyhedronGeometry3D["shape"]>("icosahedron"), radius: optional<number>(), segments: optional<Segments3D>() },
    render: (ctx, s) => ctx.draw(Material.mesh(s, stated<Geometry3D>("polyhedron", s, ["shape", "radius", "segments"]))),
});
export type Polyhedron3D = NodeOf<typeof Polyhedron3D>;

export const Extrude3D = shape3d("extrude3d", "extrude", {
    path: optional<unknown>(), depth: optional<number>(), segments: optional<Segments3D>(), bevel: optional<unknown>(),
}, ["path", "depth", "segments", "bevel"]);
export type Extrude3D = NodeOf<typeof Extrude3D>;

export const Lathe3D = shape3d("lathe3d", "lathe", {
    points: optional<readonly unknown[]>(), segments: optional<Segments3D>(), ...sweep,
}, ["points", "segments", ...SWEEP_KEYS]);
export type Lathe3D = NodeOf<typeof Lathe3D>;

export const Tube3D = shape3d("tube3d", "tube", {
    points: optional<readonly Vector3Input[]>(), radius: optional<number>(), segments: optional<Segments3D>(), closed: optional<boolean>(),
}, ["points", "radius", "segments", "closed"]);
export type Tube3D = NodeOf<typeof Tube3D>;

// ---- other drawables ----------------------------------------------------------

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

export const Line3D = component3d({
    key: "line3d",
    state: {
        points: optional<readonly Vector3Input[]>(),
        geometry: optional<Geometry3D>(),
        closed: Types.custom(false),
        segments: Types.custom(false),
        stroke: optional<LineStroke3D>(),
        opacity: optional<number>(),
        material: optional<Material3D>(),
    },
    render: (ctx, s) => {
        if (!s.geometry && !s.points?.length) return;
        ctx.draw(new Graphics3D().line({
            points: s.geometry ? undefined : s.points, geometry: s.geometry, closed: s.closed, segments: s.segments,
            stroke: s.stroke, opacity: s.opacity, material: s.material,
        }));
    },
});
export type Line3D = NodeOf<typeof Line3D>;

export const Sprite3D = component3d({
    key: "sprite3d",
    state: {
        fill: Types.custom<Fill3D | undefined>(undefined, { lerp: lerpFill3D as never }),
        opacity: optional<number>(),
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
 * A loaded model with its animation restated as two flat entries: `clip` (a
 * clip name, or its index in the file as a string; empty is the first) and
 * `clipTime` (seconds into it). The timeline tweens a number, and
 * `Model3D.animation` is a list of records, so "play the walk cycle" is a tween
 * of `clipTime` here. The clip is still sampled at an explicit time, so seeking
 * and playing to a frame give the same pose.
 *
 * Before a file is picked it draws an unlit wireframe unit box: a node that
 * records no geometry has no box to pick, select or outline. Not registered: an
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

// ---- lights -------------------------------------------------------------------

/** A light that casts no shadow unless asked: shadow maps cost a render each. */
const castsNoShadow = { shadow: false } as const;

export const AmbientLight3D = component3d({
    key: "ambient-light3d",
    state: { color: optionalColor(), intensity: optional<number>() },
    render: (ctx, s) => ctx.light(stated<LightData3D>("ambient", s, ["color", "intensity"])),
});
export type AmbientLight3D = NodeOf<typeof AmbientLight3D>;

export const HemisphereLight3D = component3d({
    key: "hemisphere-light3d",
    state: { sky: optionalColor(), ground: optionalColor(), intensity: optional<number>() },
    render: (ctx, s) => ctx.light(stated<LightData3D>("hemisphere", s, ["sky", "ground", "intensity"])),
});
export type HemisphereLight3D = NodeOf<typeof HemisphereLight3D>;

export const DirectionalLight3D = component3d({
    key: "directional-light3d",
    state: { color: optionalColor(), intensity: optional<number>(), target: optionalVector3("origin") },
    defaults: castsNoShadow,
    render: (ctx, s) => ctx.light(stated<LightData3D>("directional", s, ["color", "intensity", "target", "shadow"])),
});
export type DirectionalLight3D = NodeOf<typeof DirectionalLight3D>;

export const PointLight3D = component3d({
    key: "point-light3d",
    state: { color: optionalColor(), intensity: optional<number>(), distance: optional<number>(), decay: optional<number>() },
    defaults: castsNoShadow,
    render: (ctx, s) => ctx.light(stated<LightData3D>("point", s, ["color", "intensity", "distance", "decay", "shadow"])),
});
export type PointLight3D = NodeOf<typeof PointLight3D>;

export const SpotLight3D = component3d({
    key: "spot-light3d",
    state: {
        color: optionalColor(), intensity: optional<number>(), distance: optional<number>(), angle: optional<number>(),
        penumbra: optional<number>(), decay: optional<number>(), target: optionalVector3("origin"),
    },
    defaults: castsNoShadow,
    render: (ctx, s) => ctx.light(stated<LightData3D>("spot", s, ["color", "intensity", "distance", "angle", "penumbra", "decay", "target", "shadow"])),
});
export type SpotLight3D = NodeOf<typeof SpotLight3D>;

export const AreaLight3D = component3d({
    key: "area-light3d",
    state: { color: optionalColor(), intensity: optional<number>(), width: optional<number>(), height: optional<number>() },
    render: (ctx, s) => ctx.light(stated<LightData3D>("area", s, ["color", "intensity", "width", "height"])),
});
export type AreaLight3D = NodeOf<typeof AreaLight3D>;

// ---- camera, fog, environment -------------------------------------------------

const CAMERA_KEYS = ["target", "orbit", "elevation", "distance", "fov", "frustumHeight", "near", "far", "zoom"] as const;
const ORBIT_KEYS = ["orbit", "elevation", "distance"] as const;

export const Camera3D = component3d({
    key: "camera3d",
    state: {
        type: Types.custom<CameraData3D["type"]>("perspective"),
        target: optionalVector3("origin"),
        orbit: optional<number>(),
        elevation: optional<number>(),
        distance: optional<number>(),
        fov: optional<number>(),
        frustumHeight: optional<number>(),
        near: optional<number>(),
        far: optional<number>(),
        zoom: optional<number>(),
    },
    commands: {
        /** Only the given angles move, each from where it stands (the orbit default while unset). */
        orbitTo: {
            args: {
                orbit: optionalNumber({ step: 1, unit: "°" }),
                elevation: optionalNumber({ min: -89, max: 89, step: 1, unit: "°" }),
                distance: optionalNumber({ min: 0.01, step: 0.1 }),
            },
            run: (timeline, s) => {
                const from = {
                    orbit: s.orbit ?? ORBIT_CAMERA_DEFAULTS.orbit,
                    elevation: s.elevation ?? ORBIT_CAMERA_DEFAULTS.elevation,
                    distance: s.distance ?? ORBIT_CAMERA_DEFAULTS.distance,
                };
                return timeline.animate((t) => {
                    const out: Record<string, number> = {};
                    for (const key of ORBIT_KEYS) {
                        const end = timeline.args[key];
                        if (end !== undefined) out[key] = from[key] + (end - from[key]) * t;
                    }
                    return out;
                });
            },
        },
        lookTo: { args: ["target"] },
    },
    render: (ctx, s) => {
        const data: Record<string, unknown> = { type: s.type };
        for (const key of CAMERA_KEYS) if (s[key] !== undefined) data[key] = s[key];
        ctx.camera(data as unknown as CameraData3D);
    },
});
export type Camera3D = NodeOf<typeof Camera3D>;

export const Fog3D = component3d({
    key: "fog3d",
    state: { color: optionalColor(), near: optional<number>(), far: optional<number>(), density: optional<number>() },
    render: (ctx, s) => {
        const out: FogData3D = {};
        if (s.color !== undefined) out.color = s.color as Color;
        if (s.density !== undefined) out.density = s.density;
        else {
            if (s.near !== undefined) out.near = s.near;
            if (s.far !== undefined) out.far = s.far;
        }
        ctx.fog(out);
    },
});
export type Fog3D = NodeOf<typeof Fog3D>;

export const Environment3D = component3d({
    key: "environment3d",
    state: {
        src: optional<string>(),
        faces: optional<readonly string[]>(),
        preset: optional<"studio">(),
        intensity: optional<number>(),
        background: optional<boolean>(),
        blur: optional<number>(),
    },
    render: (ctx, s) => {
        if (s.src === undefined && s.faces === undefined && s.preset === undefined) return ctx.environment(null);
        const out = defined<EnvironmentData3D>(s, ["src", "faces", "preset", "intensity", "background", "blur"]);
        if (s.rotationX || s.rotationY || s.rotationZ) out.rotation = [s.rotationX, s.rotationY, s.rotationZ];
        ctx.environment(out);
    },
});
export type Environment3D = NodeOf<typeof Environment3D>;

// What code building a 3D node names its props as.

/** Params of a geometry descriptor, minus its discriminant. */
type ParamsOf<G extends { type: string }> = Omit<G, "type">;
/** A light's params, minus its discriminant and its shadow, which is a node prop of its own. */
type LightParamsOf<L extends { type: string }> = Omit<L, "type" | "shadow">;

export type Group3DProps = Node3DProps;

/**
 * The material shorthand, as node props.
 *
 * Exactly the keys {@link MaterialShorthand3D} promotes onto the `Graphics3D`
 * sugar methods, so `Box3D({ fill: "red", roughness: 0.3 })` and
 * `g3.box({ fill: "red", roughness: 0.3 })` describe the same mesh — and each is
 * a real prop here, so any of them can be tweened.
 *
 * Ten props, where there were twenty-four. What went is everything that was a
 * renderer knob rather than a design decision — `depthWrite`, `depthTest`,
 * `alphaTest`, `toneMapped`, `polygonOffset`, `dithering` — which now live only
 * on a `Mat.*` descriptor passed through {@link material}; plus `transparent`,
 * which is derived; plus five texture slots, which are fills.
 */
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

// ─── box ─────────────────────────────────────────────────────────────────────

export interface Box3DProps extends Mesh3DProps, Partial<ParamsOf<BoxGeometry3D>> { }

// ─── sphere ──────────────────────────────────────────────────────────────────

export interface Sphere3DProps extends Mesh3DProps, Partial<ParamsOf<SphereGeometry3D>> { }

// ─── plane ───────────────────────────────────────────────────────────────────

export interface Plane3DProps extends Mesh3DProps, Partial<ParamsOf<PlaneGeometry3D>> { }

// ─── cylinder ────────────────────────────────────────────────────────────────

export interface Cylinder3DProps extends Mesh3DProps, Partial<ParamsOf<CylinderGeometry3D>> { }

// ─── cone ────────────────────────────────────────────────────────────────────

export interface Cone3DProps extends Mesh3DProps, Partial<ParamsOf<ConeGeometry3D>> { }

// ─── torus ───────────────────────────────────────────────────────────────────

export interface Torus3DProps extends Mesh3DProps, Partial<ParamsOf<TorusGeometry3D>> { }

// ─── torus knot ──────────────────────────────────────────────────────────────

export interface TorusKnot3DProps extends Mesh3DProps, Partial<ParamsOf<TorusKnotGeometry3D>> { }

// ─── circle ──────────────────────────────────────────────────────────────────

export interface Circle3DProps extends Mesh3DProps, Partial<ParamsOf<CircleGeometry3D>> { }

// ─── ring ────────────────────────────────────────────────────────────────────

export interface Ring3DProps extends Mesh3DProps, Partial<ParamsOf<RingGeometry3D>> { }

// ─── capsule ─────────────────────────────────────────────────────────────────

export interface Capsule3DProps extends Mesh3DProps, Partial<ParamsOf<CapsuleGeometry3D>> { }

// ─── polyhedron ──────────────────────────────────────────────────────────────

export interface Polyhedron3DProps extends Mesh3DProps, Partial<ParamsOf<PolyhedronGeometry3D>> { }

// ─── extrude ─────────────────────────────────────────────────────────────────

export interface Extrude3DProps extends Mesh3DProps, Partial<ParamsOf<ExtrudeGeometry3D>> { }

// ─── lathe ───────────────────────────────────────────────────────────────────

export interface Lathe3DProps extends Mesh3DProps, Partial<ParamsOf<LatheGeometry3D>> { }

// ─── tube ────────────────────────────────────────────────────────────────────

export interface Tube3DProps extends Mesh3DProps, Partial<ParamsOf<TubeGeometry3D>> { }

/**
 * The drawables that aren't a single mesh: instanced copies, point clouds,
 * polylines, sprites and loaded models.
 *
 * Each is the node form of the matching `Graphics3D` method, so what it draws and
 * what a builder chain draws are the same descriptor.
 */

// ─── instances ───────────────────────────────────────────────────────────────

export interface Instances3DProps extends Mesh3DProps {
    /** Per-instance placement. Its length drives the instance count. */
    instances: readonly Transform3D[];
    /** Per-instance tint. Needs a material that reads instance colour. */
    colors: readonly Color[] | undefined;
}

// ─── points ──────────────────────────────────────────────────────────────────

export type Points3DProps = Mesh3DProps;

// ─── line ────────────────────────────────────────────────────────────────────

export interface Line3DProps extends Node3DProps {
    /** The polyline's vertices. Give this or {@link geometry}, not both. */
    points: readonly Vector3Input[];
    /**
     * An explicit geometry to draw the lines of — `Geo.edges(...)` for a wireframe
     * outline, say. Wins over {@link points}.
     */
    geometry: Geometry3D;
    /** Join the last point back to the first. */
    closed: boolean;
    /** Treat the points as disjoint start/end pairs rather than one path. */
    segments: boolean;
    /** The line's paint. */
    stroke: LineStroke3D | undefined;
    opacity: number | undefined;
    material: Material3D | undefined;
}

// ─── sprite ──────────────────────────────────────────────────────────────────

export interface Sprite3DProps extends Node3DProps {
    /** What the billboard shows — the same value a 2D `fill` takes. */
    fill: Fill3D;
    opacity: number | undefined;
    material: Material3D | undefined;
}

// ─── model ───────────────────────────────────────────────────────────────────

export interface Model3DProps extends Node3DProps {
    /**
     * Path to a glTF/GLB file. **Only glTF/GLB loads**: any other format, an OBJ
     * included, resolves to an empty slot and draws nothing.
     */
    src: string;
    /**
     * Baked animation clips, each sampled at an **explicit** time — which is what
     * keeps a model identical whether the frame was played forward or scrubbed to.
     */
    animation: readonly ModelAnimation3D[] | ModelAnimation3D | undefined;
    /** Replace materials on the loaded graph, keyed by mesh or material name. */
    override: Readonly<Record<string, Material3D>> | undefined;
}

export interface ModelView3DProps extends Model3DProps {
  /**
   * Which baked clip to sample — a clip name, or its index in the file as a
   * string. Empty means the first clip.
   */
  clip: string
  /** Seconds into that clip. Animate this to play it. */
  clipTime: number
}

// ─── ambient ─────────────────────────────────────────────────────────────────

export interface AmbientLight3DProps extends Node3DProps, Partial<LightParamsOf<AmbientLightData3D>> { }

// ─── hemisphere ──────────────────────────────────────────────────────────────

export interface HemisphereLight3DProps extends Node3DProps, Partial<LightParamsOf<HemisphereLightData3D>> { }

// ─── directional ─────────────────────────────────────────────────────────────

export interface DirectionalLight3DProps extends Node3DProps, Partial<LightParamsOf<DirectionalLightData3D>> { }

// ─── point ───────────────────────────────────────────────────────────────────

export interface PointLight3DProps extends Node3DProps, Partial<LightParamsOf<PointLightData3D>> { }

// ─── spot ────────────────────────────────────────────────────────────────────

export interface SpotLight3DProps extends Node3DProps, Partial<LightParamsOf<SpotLightData3D>> { }

// ─── area ────────────────────────────────────────────────────────────────────

export interface AreaLight3DProps extends Node3DProps, Partial<LightParamsOf<AreaLightData3D>> { }

/**
 * The camera — where the scene is viewed from.
 *
 * **One node, two projections.** `<Camera3D type="orthographic">` is the flat
 * one; there is no second class, because a perspective and an orthographic
 * camera are one object with a projection setting, which is how every editor
 * presents it and how a scene switching between them has to be written.
 *
 *   Camera3D({ target: [0, 0.2, 0], orbit: -18, elevation: 12, distance: 13, fov: 42 })
 *
 *   cam().to({ data: { orbit: 160, elevation: 30 }, duration: 4, easing: easeInOut("quad") });
 *
 * ── Orbit, not trigonometry ───────────────────────────────────────────────────
 * `target`/`orbit`/`elevation`/`distance` place the camera in polar coordinates
 * around the thing it is looking at, which is what a camera move almost always
 * *is*. Written through `position` the same move is a `Math.sin`/`Math.cos` pair
 * recomputed every frame in a prop binding — which is exactly what every scene
 * did before this existed.
 *
 * `position` and `lookAt` still work and are right for a shot pinned to
 * something; setting any polar field takes over, so the two can never be half
 * applied. Either way the camera is a node, so parenting it to a moving
 * `Group3D` carries the shot with the rig.
 *
 * ── What is derived ───────────────────────────────────────────────────────────
 * `near`/`far` come from the scene's own bounds unless you set them, and the
 * aspect ratio always tracks the viewport's layout box — it was a prop whose
 * documentation said "don't set this", and setting it stretched the render.
 * An asymmetric orthographic frustum is a `params` override rather than four
 * more fields.
 *
 * A scene with no camera gets a sensible default framing. A scene that declares
 * more than one keeps the last, since there is only ever one view.
 */
export interface Camera3DProps extends Node3DProps {
    /** `"perspective"` (default) or `"orthographic"`. */
    type: CameraData3D["type"];
    /**
     * The point the camera looks at, and orbits around.
     *
     * On its own it is `lookAt` under a name that reads right beside `orbit`;
     * together with any of the three below it is also the centre they turn about.
     */
    target: Vector3Input | undefined;
    /** Azimuth around {@link target}, in **degrees**. */
    orbit: number | undefined;
    /** Angle above the horizon, in **degrees**. */
    elevation: number | undefined;
    /** Distance from {@link target}. */
    distance: number | undefined;
    /** Perspective only: vertical field of view in **degrees**. Default 50. */
    fov: number | undefined;
    /** Orthographic only: visible world height. Default 10. */
    frustumHeight: number | undefined;
    near: number | undefined;
    far: number | undefined;
    zoom: number | undefined;
}

/**
 * The two scene-wide nodes that are left: fog and environment.
 *
 * `Shadows3D`, `ToneMapping3D` and `PostEffects3D` used to be here and are now
 * props on `Canvas3D`. They were never scene *objects* — a viewport's shadow
 * quality, its tone curve and its post chain are settings of the thing doing the
 * rendering, and writing them as nodes meant a node with no position whose
 * duplicates silently did nothing. `Background3D` is gone entirely: what is drawn
 * behind a 3D scene is the viewport's own 2D `fill`.
 *
 * These two stay nodes because they *are* about the space: fog is a property of
 * the air in it, and an environment is the sky around it. Both are still
 * positionless, so declaring two of the same kind is not an error but only the
 * last takes effect.
 *
 *   Fog3D({ near: 5, far: 30 })
 *   Environment3D({ preset: "studio" })
 */

// ─── fog ─────────────────────────────────────────────────────────────────────

export interface Fog3DProps extends Node3DProps {
    /** Defaults to the viewport's own fill — see below. */
    color: Color | undefined;
    /** Distance at which fog starts. Linear fog. */
    near: number | undefined;
    /** Distance at which fog is total. Linear fog. */
    far: number | undefined;
    /** Exponential-squared falloff. Wins over {@link near}/{@link far}. */
    density: number | undefined;
}

// ─── environment ─────────────────────────────────────────────────────────────

export interface Environment3DProps extends Node3DProps {
    /**
     * A 360° panorama — `.hdr`/`.exr` for real IBL, or a plain image.
     * **Inert today**: no backend loads it, so only `preset` renders.
     */
    src: string | undefined;
    /**
     * Six cubemap faces, in three's order: +X, −X, +Y, −Y, +Z, −Z.
     * **Inert today**: no backend loads them, so only `preset` renders.
     */
    faces: readonly string[] | undefined;
    /** A generated studio interior. Needs no asset. The only environment that renders. */
    preset: "studio" | undefined;
    intensity: number | undefined;
    /** Also draw it behind the scene, as an infinitely distant sky. */
    background: boolean | undefined;
    /** Blur the background only, 0–1. The lighting stays sharp. */
    blur: number | undefined;
}
