import type { Graphics3DOp } from "./graphics3d";
import type { Material3D } from "./material";

/** Development warnings for 3D inputs that are accepted, typed and recorded but acted on by no renderer: the post chain, HDR/EXR/cubemap environments, `params` on a geometry or environment, `extends` on a shader material, OBJ models. Each renders exactly like a scene without it, silently, which costs an afternoon; these say so once per session, in development, naming the input and what to do instead. Nothing here changes what is recorded. */

const warned = new Set<string>();
let development: boolean | undefined;

/** Read once: in Node, `process.env` is a lookup per access. */
function isDevelopment(): boolean {
    return (development ??= process.env.NODE_ENV !== "production");
}

/**
 * Print `message` once per `key`, in development only.
 * @internal
 */
export function warnInert3D(key: string, message: string): void {
    if (!isDevelopment() || warned.has(key)) return;
    warned.add(key);
    console.warn(`[motionscript] ${message}`);
}

/** Forget what has been warned, so a test can see the same warning again. @internal */
export function resetInertWarnings3D(): void {
    warned.clear();
}

/**
 * Check one recorded drawable for inputs the renderer ignores.
 * @internal
 */
export function inspectDrawable3D(op: Graphics3DOp): void {
    if (!isDevelopment()) return;

    if ("geometry" in op) {
        const params = op.geometry.params;
        if (params && Object.keys(params).length > 0) {
            warnInert3D(
                `geometry-params:${op.geometry.type}`,
                `\`params\` on a "${op.geometry.type}" geometry is not applied: three builds a geometry from its named fields and nothing assigns \`params\` onto it. `
                + "Set the geometry's own fields instead. (`params` is applied on materials, lights and cameras.)",
            );
        }
    }

    if ("material" in op) {
        const materials = Array.isArray(op.material) ? op.material : [op.material];
        for (const material of materials as readonly Material3D[]) {
            if (material.type === "shader" && material.extends != null) {
                warnInert3D(
                    "shader-extends",
                    `\`extends: "${material.extends}"\` on a shader material is not applied: the shader replaces the built-in model, so scene lighting, shadows and fog do not reach it. `
                    + "Write the lighting you need in the shader.",
                );
            }
        }
    }

    if (op.kind === "model" && /\.obj(?:$|[?#])/i.test(op.src)) {
        warnInert3D(
            "model-obj",
            `The model "${op.src}" is an OBJ file, and only glTF/GLB models load: it will draw nothing. Convert it to .glb.`,
        );
    }
}
