import { lerpFill3D, resolveFill3D, type Fill3D } from "@/render3d/fill3d";
import type { Geometry3D } from "@/render3d/geometry";
import { Graphics3D, resolveMaterialShorthand3D, type MaterialShorthand3D } from "@/render3d/graphics3d";
import type { Material3D, Shading3D } from "@/render3d/material";
import type { Texture3D } from "@/render3d/texture";
import type { Blend3D, Faces3D } from "@/render3d/transform";
import type { Values } from "@/components/factory/api";
import { Types } from "@/components/factory/types";
import { optional, optionalColor } from "@/components/modules/three-entries";

/** `Mesh3D`'s surface: a material, or the shorthand entries one is built from. */
export const state = {
    material: optional<Material3D | readonly Material3D[]>(),
    fill: Types.custom<Fill3D>("white", { lerp: lerpFill3D }),
    opacity: optional<number>(),
    roughness: optional<number>(),
    metalness: optional<number>(),
    emission: optionalColor(),
    emissionStrength: optional<number>(),
    normalMap: optional<Texture3D>(),
    roughnessMap: optional<Texture3D>(),
    metalnessMap: optional<Texture3D>(),
    aoMap: optional<Texture3D>(),
    alphaMap: optional<Texture3D>(),
    envMapIntensity: optional<number>(),
    wireframe: optional<boolean>(),
    shading: optional<Shading3D>(),
    faces: optional<Faces3D>(),
    vertexColors: optional<boolean>(),
    blend: optional<Blend3D>(),
    unlit: Types.custom(false),
};

type MaterialState = Values<typeof state>;

const SHORTHAND_KEYS = [
    "opacity", "roughness", "metalness",
    "emission", "emissionStrength", "normalMap", "roughnessMap",
    "metalnessMap", "aoMap", "alphaMap", "envMapIntensity", "wireframe",
    "shading", "faces", "vertexColors", "blend",
] as const;

/** The entries that are set, as a material shorthand. */
export function shorthand(s: MaterialState): MaterialShorthand3D {
    const out: Record<string, unknown> = {};
    if (s.material !== undefined) out.material = s.material;
    if (s.fill !== undefined) out.fill = s.fill;
    for (const key of SHORTHAND_KEYS) if (s[key] !== undefined) out[key] = s[key];
    if (s.unlit) out.unlit = true;
    return out as MaterialShorthand3D;
}

/** `geometry` with this surface; nothing without one. */
export function mesh(s: MaterialState, geometry: Geometry3D | undefined): Graphics3D {
    const g3 = new Graphics3D();
    if (geometry) g3.mesh(geometry, resolveMaterialShorthand3D(shorthand(s)));
    return g3;
}

/** The one material instanced copies share: the first, when the shorthand resolves to several. */
export function single(s: MaterialState): Material3D {
    const resolved = resolveMaterialShorthand3D(shorthand(s));
    return (Array.isArray(resolved) ? resolved[0] : resolved) as Material3D;
}

const POINTS_KEYS = ["opacity", "alphaMap", "blend", "vertexColors"] as const;

/** A points material: the given one, or the fill's colour and map with what a point cloud reads. */
export function points(s: MaterialState): Material3D {
    if (s.material !== undefined) return (Array.isArray(s.material) ? s.material[0] : s.material) as Material3D;
    const material: Record<string, unknown> = { type: "points" };
    const fill = resolveFill3D(s.fill);
    if (fill.color !== undefined) material.color = fill.color;
    if (fill.map !== undefined) material.map = fill.map;
    for (const key of POINTS_KEYS) if (s[key] !== undefined) material[key] = s[key];
    return material as unknown as Material3D;
}
