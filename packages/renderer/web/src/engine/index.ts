// @motionscript/renderer: the wgpu renderer that @motionscript/browser's
// createBrowserEngine() draws with. Hosts use that entry; this one is for it.

import type { MeasureContext2D, PlatformDeps } from "@motionscript/core";
import { loadRendererWasm, prewarmDevice } from "../backend-wgpu";
import { WgpuStorageAdapter } from "./storage";
import { WgpuSurfaceContext } from "./surface";
import { measureText, shaperFor } from "./text";

export { onWgpuEvent } from "./faults";
export type { WgpuEvent } from "./faults";
export { ShaderPreview, validateShader, WGSL_PRELUDE } from "./shader-preview";
export type { ShaderDiagnostic, ShaderField, ShaderPreviewInput, ShaderReport, ShaderScope, ShaderStatus } from "./shader-preview";
export type { WgpuStorageAdapter, WgpuSurfaceContext };

export interface WgpuRendererOptions {
    /** Where `ms_renderer_bg.wasm` is served; defaults to beside this module. */
    wasmUrl?: string | URL;
    /** Fetches an asset's bytes (images, video, audio, fonts); defaults to `fetch`, rejecting on a failed response. */
    loadBytes?: (src: string) => Promise<Blob>;
}

/** What a platform draws a session's frames with, and the storage and measurement they read from. */
export interface WgpuRenderer {
    createStorageAdapter(deps: PlatformDeps): WgpuStorageAdapter;
    createRenderContext(storage: WgpuStorageAdapter): WgpuSurfaceContext;
    createMeasureContext(storage: WgpuStorageAdapter): MeasureContext2D;
    dispose?(): void;
}

/** Whether this browser can run the renderer (WebGPU with an adapter). */
export async function isWgpuSupported(): Promise<boolean> {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    try {
        return (await gpu.requestAdapter()) != null;
    } catch {
        return false;
    }
}

/**
 * Loads the renderer's WASM. Rejects where WebGPU is unavailable only once a
 * surface mounts; check {@link isWgpuSupported} first.
 */
export async function createWgpuRenderer(options: WgpuRendererOptions = {}): Promise<WgpuRenderer> {
    await loadRendererWasm(options.wasmUrl);
    // Started, not awaited: the device comes up while the host loads fonts and
    // builds its document, and the first mount waits for what is left.
    prewarmDevice().catch(() => {});
    const { loadBytes } = options;
    return {
        createStorageAdapter({ catalog, viewport, fps }: PlatformDeps): WgpuStorageAdapter {
            return new WgpuStorageAdapter(catalog, viewport, fps, loadBytes);
        },
        createRenderContext(storage: WgpuStorageAdapter): WgpuSurfaceContext {
            return new WgpuSurfaceContext(storage, storage.size);
        },
        createMeasureContext(storage: WgpuStorageAdapter): MeasureContext2D {
            const shaper = shaperFor(storage);
            return { measureText: (...args) => measureText(shaper, ...args) };
        },
    };
}
