/** Backend seams for 3D runtime and resource loading. Core describes 3D scenes but can't import `three`, so it declares the capability here and the backend registers an implementation at module load (like `StorageAdapter`, `Ticker`; "core owns *whether*, backend owns *how*"). With no backend registered every function is an inert no-op, keeping core usable headless and in unit tests. */

import type { Disposer } from "@/assets/record";

/** Loads the backend's 3D runtime. Idempotent and memoised by the backend. */
export type Canvas3DWarmup = () => Promise<void>;

/** Loads a resource core can't decode itself; `kind` picks the backend loader and the returned {@link Disposer} frees the parsed result when the asset window moves past it. */
export type Canvas3DResourceKind = "hdr" | "exr" | "gltf" | "obj" | "cubemap";
export type Canvas3DResourceLoader = (kind: Canvas3DResourceKind, src: string) => Promise<Disposer>;

/** The cache key a loader-backed resource is tracked and stored under. Stated once because **two packages must agree and neither owns both ends**: core's `declare3DResources` declares the key into the asset scope and the backend's loader later looks the parsed result up by it; a hand-built string could cache under a key nothing reads (a model that silently never appears). `src` goes last and unescaped (a URL may hold colons), so a reader splits on the first two separators and takes the rest whole; see {@link parseCanvas3DResourceKey}. */
export function canvas3DResourceKey(kind: Canvas3DResourceKind, src: string): string {
    return `three:${kind}:${src}`;
}

/** The `kind` and `src` a {@link canvas3DResourceKey} was built from, or `null` when the string isn't one. The backend's warm queue holds keys, not pairs, and `warmPendingCanvas3D` re-drives whatever is outstanding from only that. */
export function parseCanvas3DResourceKey(
    key: string,
): { kind: Canvas3DResourceKind; src: string } | null {
    if (!key.startsWith("three:")) return null;
    const rest = key.slice("three:".length);
    const split = rest.indexOf(":");
    if (split <= 0) return null;
    return {
        kind: rest.slice(0, split) as Canvas3DResourceKind,
        src: rest.slice(split + 1),
    };
}

let warmup: Canvas3DWarmup | null = null;
let resourceLoader: Canvas3DResourceLoader | null = null;

/** Registers the 3D runtime loader; called by the backend before it draws, never at import. */
export function registerCanvas3DWarmup(fn: Canvas3DWarmup): void {
    warmup = fn;
}

/** Registers the loader for resource types core can't decode (HDR/EXR env maps, glTF/OBJ models); called once by the backend. */
export function registerCanvas3DResourceLoader(fn: Canvas3DResourceLoader): void {
    resourceLoader = fn;
}

/**
 * Kicks off loading the 3D runtime. `Canvas3D.declareAssets()` loads it through the asset timeline before any frame
 * draws, so the first 3D frame normally finds it resident and the render pass stays synchronous (the renderer keeps
 * a per-frame fallback).
 *
 * @internal
 */
export function warmCanvas3D(): Promise<void> | void {
    return warmup?.();
}

/** The registered resource loader, or `null` when no backend supplied one. @internal */
export function canvas3DResourceLoader(): Canvas3DResourceLoader | null {
    return resourceLoader;
}

/** True when a backend has registered a 3D runtime. @internal */
export function hasCanvas3DBackend(): boolean {
    return warmup !== null;
}
