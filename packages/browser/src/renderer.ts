import { createWgpuRenderer, isWgpuSupported, type WgpuRenderer } from "@motionscript/renderer";
import { loadAssetBytes } from "./asset-bytes";

/** Where the renderer's WebAssembly is served, for every entry that draws. */
export interface RendererWasmOption {
    /** URL of `ms_renderer_bg.wasm`; defaults to beside `@motionscript/renderer`'s module, which a bundler resolves. */
    rendererWasmUrl?: string | URL;
}

/**
 * This browser cannot run the WebGPU renderer: no `navigator.gpu`, or no
 * adapter behind it. Every entry that draws (an engine, a still, an export,
 * a timeline's audio mix) rejects with it before drawing anything.
 */
export class WebGpuUnavailableError extends Error {
    constructor() {
        super("Motion Script draws with WebGPU, and this browser has no WebGPU adapter.");
        this.name = "WebGpuUnavailableError";
    }
}

/**
 * The renderer every entry draws with, or {@link WebGpuUnavailableError}.
 * `gpu: false` is for an entry that only measures text, which needs no device.
 */
export async function loadRenderer(options: RendererWasmOption = {}, { gpu = true } = {}): Promise<WgpuRenderer> {
    if (gpu && !(await isWgpuSupported())) throw new WebGpuUnavailableError();
    return createWgpuRenderer({ wasmUrl: options.rendererWasmUrl, loadBytes: loadAssetBytes });
}
