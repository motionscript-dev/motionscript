/** Structural walks over a built {@link Graphics3D} or {@link Scene3D}. {@link forEachTexture3D} sweeps for textures: asset discovery uses it during precomp to decide what to load and the renderer at paint time to find surface textures to rasterize first. One shared sweep stops the two drifting: a texture slot added to a material must be seen by both, or a map loads and never draws (or draws and never loads). */

import type { Graphics3D } from "./graphics3d";
import { Scene3D } from "./scene3d";
import type { Material3D } from "./material";
import { looksLikeAssetPath, type Texture3D } from "./texture";

/** Material fields that hold a {@link Texture3D}. */
export const TEXTURE_KEYS: readonly string[] = [
    "map", "alphaMap", "aoMap", "normalMap", "displacementMap", "envMap",
    "lightMap", "emissionMap", "roughnessMap", "metalnessMap", "specularMap",
    "gradientMap", "matcap", "clearcoatMap", "clearcoatNormalMap",
    "clearcoatRoughnessMap", "transmissionMap", "thicknessMap",
];

/** True for a texture descriptor object (vs. a plain uniform value). Structural, as {@link Texture3D} has no `type` discriminant: each member is branded by its own payload key. */
export function isTextureLike(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    return "src" in value || "data" in value || "source" in value;
}

/** Visits every {@link Texture3D} a scene references (material map slots, shader and post-effect uniforms), duplicates included. Does **not** cover model/environment resources, which go through the backend's loader (see `declare3DResources`). */
export function forEachTexture3D(g3: Graphics3D | Scene3D, visit: (texture: Texture3D) => void): void {
    const uniforms = (bag: Record<string, unknown> | undefined): void => {
        if (!bag) return;
        for (const key in bag) {
            const value = bag[key];
            // A bare string is a texture path only when it looks like one; any other string is a colour uniform.
            if ((typeof value === "string" && looksLikeAssetPath(value)) || isTextureLike(value)) {
                visit(value as Texture3D);
            }
        }
    };

    const material = (value: Material3D | readonly Material3D[] | undefined): void => {
        if (value === undefined) return;
        const list = Array.isArray(value) ? value : [value as Material3D];
        for (const entry of list) {
            const bag = entry as unknown as Record<string, unknown>;
            for (const key of TEXTURE_KEYS) {
                if (bag[key] !== undefined) visit(bag[key] as Texture3D);
            }
            // A shader's uniforms can hold textures too.
            uniforms(bag.uniforms as Record<string, unknown> | undefined);
        }
    };

    for (const op of g3.ops()) {
        switch (op.kind) {
            case "mesh":
            case "points":
            case "line":
            case "instances":
                material(op.material);
                break;
            case "sprite":
                material(op.material);
                break;
            case "model":
                if (op.override) {
                    for (const key in op.override) material(op.override[key]);
                }
                break;
            // push/pop/light reference no textures.
        }
    }

    // Only a whole scene has a post chain. The environment's panorama isn't visited: the backend's HDR/EXR loader handles it, declared by `trackEnvironment`.
    if (!(g3 instanceof Scene3D)) return;

    for (const effect of g3.postEffects()) {
        uniforms((effect as { uniforms?: Record<string, unknown> }).uniforms);
    }
}
