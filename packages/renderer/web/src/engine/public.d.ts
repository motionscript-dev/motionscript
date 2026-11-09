// The package's published types (dist/index.d.ts): the engine entry's surface.
import type { EngineRenderContext, MeasureContext2D, PlatformDeps, StorageAdapter } from "@motionscript/core";

export interface WgpuRendererOptions {
    /** Where `ms_renderer_bg.wasm` is served; defaults to beside this module. */
    wasmUrl?: string | URL;
    /** Fetches an asset's bytes (images, video, audio, fonts); defaults to `fetch`, rejecting on a failed response. */
    loadBytes?: (src: string) => Promise<Blob>;
}

/** The renderer's asset storage: decoded images and video frames, and font bytes. */
export interface WgpuStorageAdapter extends StorageAdapter {}

/** A session's WebGPU surface. */
export type WgpuSurfaceContext = EngineRenderContext & {
    /** Settles once the surface `mount` began can draw (its device is up). */
    whenMounted(): Promise<void>;
    /** The frame last drawn, copied into a fresh 2D canvas, or `undefined` before one was. */
    snapshotCanvas(): HTMLCanvasElement | undefined;
};

/** What a platform draws a session's frames with, and the storage and measurement they read from. */
export interface WgpuRenderer {
    createStorageAdapter(deps: PlatformDeps): WgpuStorageAdapter;
    createRenderContext(storage: WgpuStorageAdapter): WgpuSurfaceContext;
    createMeasureContext(storage: WgpuStorageAdapter): MeasureContext2D;
    dispose?(): void;
}

/** Whether this browser can run the renderer (WebGPU with an adapter). */
export declare function isWgpuSupported(): Promise<boolean>;

/** A GPU fault on the page. Every surface shares one device, so each is news for all of them. */
export type WgpuEvent =
    | { type: "device-lost"; reason: string; message: string }
    | { type: "device-restored" }
    | { type: "gpu-error"; error: "validation" | "out-of-memory" | "internal"; message: string }
    | { type: "crashed"; message: string };

/**
 * Calls `listener` on every GPU fault on the page; returns the unsubscribe.
 * A lost device is replaced and every live surface remounted on the new one
 * (`device-restored` once it is up); each fault also reaches every surface's
 * render issues, and fails an export under way with a `RenderBackendError`.
 */
export declare function onWgpuEvent(listener: (event: WgpuEvent) => void): () => void;

/**
 * Loads the renderer's WASM, for @motionscript/browser's createBrowserEngine()
 * to draw with. Rejects where WebGPU is unavailable only once a surface mounts;
 * check {@link isWgpuSupported} first.
 */
export declare function createWgpuRenderer(options?: WgpuRendererOptions): Promise<WgpuRenderer>;

// ── User shaders (WGSL) ─────────────────────────────────────────────────────

export type ShaderScope = "fill" | "effect";

/** One problem in an author's source. `line`/`column` are 1-based; 0 = not in the source. */
export interface ShaderDiagnostic {
    line: number;
    column: number;
    length: number;
    message: string;
    /** `naga`: the renderer's validation; `browser`: the GPU's own compile (`getCompilationInfo`). */
    source: "naga" | "browser";
}

/** One member of the source's `struct Params`, as WGSL's uniform layout places it. */
export interface ShaderField {
    name: string;
    /** Byte offset in `Params`. */
    offset: number;
    /** 0 f32, 1 i32, 2 u32. */
    scalar: number;
    /** Components per element (1–4). */
    components: number;
    /** Elements (array length or matrix columns), `stride` bytes apart. */
    elements: number;
    stride: number;
    /** The WGSL type (`vec3<f32>`, `array<vec4<f32>, 4>`). */
    type: string;
}

export interface ShaderReport {
    ok: boolean;
    diagnostics: ShaderDiagnostic[];
    fields: ShaderField[];
    /** Size of `Params` in bytes. */
    size: number;
    /** The assembled module. */
    wgsl?: string;
}

/**
 * Validates a WGSL fill or effect with naga (loading the renderer's WASM on
 * first use): diagnostics located in `source`, and the reflected `Params`.
 */
export declare function validateShader(scope: ShaderScope, source: string, wasmUrl?: string | URL): Promise<ShaderReport>;

/** What the renderer puts in front of an author's code, for an editor to show. */
export declare const WGSL_PRELUDE: Record<ShaderScope, string>;

export interface ShaderPreviewInput {
    scope: ShaderScope;
    source: string;
    /** `Params` values by member name. */
    uniforms: Record<string, number | readonly number[]>;
    /** Seconds (`in.time`). */
    time: number;
    /** Effects: run over what is beneath the shape (`mode: "backdrop"`) rather than the shape's own content. */
    backdrop?: boolean;
    /** Effects: how the output composites onto the input (core blend name); absent = replaces it. */
    blendMode?: string;
    /** Effects: px the effect may draw or read past the shape. */
    reach?: number;
    /** Effects: the whole frame (default), or an inset rounded rect so the untouched content shows around it. */
    frame?: "full" | "inset";
    /** The content underneath, cover-fitted, in place of the test pattern (or of nothing, under a fill). */
    image?: ImageBitmap | null;
    /** Before/after: left of `split × width` shows the content without the shader. */
    split?: number | null;
    /** A fill's texture (`sample_texture`). */
    texture?: ImageBitmap | null;
}

export interface ShaderStatus {
    state: "compiling" | "ready" | "failed" | "empty";
    /** naga's, then the browser's. */
    diagnostics: ShaderDiagnostic[];
}

/**
 * One preview surface on its own WebGPU device. `draw` never waits: a program
 * still compiling draws what lies beneath, and the last input is drawn again
 * when it is ready (`onDraw` says so).
 */
export declare class ShaderPreview {
    /** Called after a redraw the preview made by itself (a program became ready). */
    onDraw: (() => void) | null;
    static create(canvas: HTMLCanvasElement | OffscreenCanvas, wasmUrl?: string | URL): Promise<ShaderPreview>;
    /** Draws `input` at the canvas's current size. */
    draw(input: ShaderPreviewInput): ShaderStatus;
    /** Draws `input` once its program has compiled, and resolves to the frame (straight alpha). */
    pixels(input: ShaderPreviewInput): Promise<ImageData>;
    /** The same, encoded. */
    snapshot(input: ShaderPreviewInput, type?: string, quality?: number): Promise<Blob>;
    /** Settles once every program drawn so far is ready or failed. */
    whenReady(): Promise<void>;
    /** A program's state and diagnostics (compiling it if it is new). */
    status(scope: ShaderScope, source: string): ShaderStatus;
    destroy(): void;
}
