/* tslint:disable */
/* eslint-disable */

export class MsText {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Glyph outline → `[verbCount, verbs…, x0, y0, x1, y1, …]` in px, y down.
     */
    glyph_path(font: number, glyph: number, size: number, weight: number): Float32Array;
    /**
     * Paragraph layout in paragraph space; see [`encode`]. `align`: 0 left,
     * 1 right, 2 center, 3 justify, 4 start, 5 end. `max_width <= 0` = no wrap.
     */
    layout(text: string, runs: Float32Array | number[], families: string, line_height: number, align: number, max_width: number, box_width: number): Float32Array;
    /**
     * `measureText` → `[width, height]`.
     */
    measure_text(text: string, size: number, family: string, weight: number, letter_spacing: number, slant: number): Float32Array;
    constructor();
    /**
     * Registers font bytes under `family`; returns the font id, or -1.
     */
    register_font(bytes: Uint8Array | number[], family: string): number;
    set_default_fallbacks(ids: Uint32Array | number[]): void;
    set_family_fallbacks(family: string, ids: Uint32Array | number[]): void;
    /**
     * `layoutTextBlock` → `[width, height, lineCount, per line: start, end,
     * top, bottom, caretCount, carets…]`, or empty for no layout.
     * `font_size` NaN = autofit. `valign`: 0 top, 1 center, 2 bottom.
     */
    text_block(text: string, runs: Float32Array | number[], families: string, font_size: number, min_font_size: number, line_height: number, align: number, valign: number, wrap: boolean, width: number, height: number): Float32Array;
    /**
     * Text on a path: shapes one unwrapped left-aligned line and places it
     * along `points` (a polyline, `[x0, y0, x1, y1, …]`) per `align`.
     * Returns 7 numbers per glyph: the glyph id, then its affine matrix
     * `[a, b, c, d, e, f]` (see `PlacedGlyph::matrix`). Newlines become
     * spaces; the whitespace around them is collapsed by the caller, since it
     * changes run lengths.
     */
    text_on_path(text: string, runs: Float32Array | number[], families: string, line_height: number, align: number, points: Float32Array | number[]): Float32Array;
}

export class Renderer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    adapter_info(): string;
    /**
     * Applies the first `words` words of the delta buffer to the scene.
     */
    apply(words: number): void;
    /**
     * Creates a renderer drawing into an `HTMLCanvasElement` or `OffscreenCanvas`.
     */
    static create(canvas: any, width: number, height: number): Promise<Renderer>;
    /**
     * Pointer (byte offset into WASM memory) of a word buffer holding at least
     * `min_words` words. May reallocate, so callers re-read the pointer and
     * refresh their views after calling it.
     */
    delta_buffer(min_words: number): number;
    delta_capacity(): number;
    /**
     * Names of the built-in effects, in `OP_EFFECTS` index order.
     */
    effect_names(): string[];
    /**
     * Drops the shared device and its pipelines, so the next `prewarm` or
     * `create` asks for a new one. For a host that learnt of a lost device
     * before wgpu's own callback ran.
     */
    static forget_device(): void;
    free_image(id: number): void;
    /**
     * The `GPUDevice` this renderer draws with.
     */
    gpu_device(): any;
    /**
     * Forces the next render to rebuild the frame program even if no delta
     * arrived, to measure the full CPU path.
     */
    invalidate(): void;
    /**
     * core's `measureText`: `[width, height]`.
     */
    measure_text(text: string, size: number, family: string, weight: number, letter_spacing: number, slant: number): Float32Array;
    /**
     * Gets the GPU device every renderer on the page shares ready, ahead of the first `create`.
     */
    static prewarm(): Promise<void>;
    /**
     * Renders the scene offscreen and resolves to RGBA8 pixels (row-major,
     * tightly packed). The promise yields a `Uint8Array`.
     */
    read_pixels(): Promise<any>;
    /**
     * Registers font bytes under a family name; returns the font id, or
     * -1 if the bytes aren't a font.
     */
    register_font(bytes: Uint8Array | number[], family: string): number;
    /**
     * Renders the current scene to the canvas.
     */
    render(): void;
    resize(width: number, height: number): void;
    /**
     * Scene `scene`'s texture `tex` (an encoder texture id) is image
     * `image`: an uploaded image or a surface.
     */
    scene3d_bind(scene: number, tex: number, image: number, srgb: boolean): void;
    /**
     * Scene `scene`'s texture `tex` from straight RGBA8 rows (a data texture).
     */
    scene3d_pixels(scene: number, tex: number, rgba: Uint8Array | number[], width: number, height: number, srgb: boolean): void;
    /**
     * What the last 3D scenes recorded that `ms-render3d` doesn't draw.
     */
    scene3d_skipped(id: number): string[];
    set_options(linear: boolean, dither: boolean): void;
    /**
     * A 3D scene (the word stream `web/src/r3d/encode.ts` writes from
     * core's `Scene3D`) as image `id`, drawn at `width`×`height` px on
     * this renderer's device and sampled by image paints like any image.
     */
    set_scene3d(id: number, width: number, height: number, words: Uint32Array | number[]): void;
    /**
     * Image `id` is the 2D subtree under node `root` (a detached group),
     * drawn at `width`×`height` px whenever the scene changes: a
     * `Tex.surface` source for 3D maps, and an image for image paints.
     */
    set_surface(id: number, root: number, width: number, height: number): void;
    /**
     * Validates user shader `source` (`kind` 0 = fill, 1 = effect) and,
     * when valid, adds it as program `id` on this device. Its draws are
     * skipped until `shader_build`; the caller compiles the pipelines
     * asynchronously first (see `web/src/user-shaders.ts`). Returns the
     * report `validate_shader` does, as JSON.
     */
    shader_add(id: number, kind: number, source: string): string;
    /**
     * Creates program `id`'s pipelines; from the next render it draws.
     */
    shader_build(id: number): void;
    /**
     * The output formats of a user program's pipelines, in order (WebGPU names).
     */
    shader_formats(kind: number): string[];
    shader_remove(id: number): void;
    /**
     * [build ms, encode+submit ms, apply ms, prims, ops, layers, passes,
     *  draws, culled, outlines built this frame, pool textures, pool MiB,
     *  cached outline segments, prims reused from recorded subtrees,
     *  prims left on the GPU from the previous build, 3D decode + set ms,
     *  3D draw CPU ms, 3D map refresh ms, surfaces redrawn, surfaces]
     */
    stats(): Float64Array;
    /**
     * core's `layoutTextBlock` for a text node already in the scene, flat:
     * `[width, height, lineCount, then per line: start, end, top,
     * bottom, caretCount, carets…]`; empty when there is none.
     */
    text_block_layout(id: number): Float32Array;
    /**
     * Uploads image `id` from an `ImageBitmap`, `VideoFrame`,
     * `HTMLImageElement`, `HTMLVideoElement`, `HTMLCanvasElement` or
     * `OffscreenCanvas` (a GPU copy). Call again with each new video
     * frame; the texture is reused. `mipmaps` for still images.
     */
    upload_image(id: number, source: any, mipmaps: boolean): void;
    /**
     * Resolves once the GPU has finished all submitted work.
     */
    wait_gpu(): Promise<any>;
}

/**
 * Called with the message when the renderer panics, just before the trap.
 */
export function set_panic_listener(listener?: Function | null): void;

/**
 * `panic = "abort"` traps, and the instance is not safe to call again
 * (a `RefCell` may be left borrowed), so the host is told what happened
 * before the trap unwinds into whichever call it was. Unwinding on
 * wasm32 needs a nightly std.
 */
export function start(): void;

/**
 * Validates a user shader without a device: `kind` 0 = fill, 1 = effect.
 * JSON `{ ok, diagnostics: [{ line, column, length, message }], fields:
 * [{ name, offset, scalar, components, elements, stride, type }], size, wgsl }`;
 * `line` is 1-based in `source`, 0 for a problem outside it.
 */
export function validate_shader(kind: number, source: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_mstext_free: (a: number, b: number) => void;
    readonly __wbg_renderer_free: (a: number, b: number) => void;
    readonly mstext_glyph_path: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly mstext_layout: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number];
    readonly mstext_measure_text: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly mstext_new: () => number;
    readonly mstext_register_font: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly mstext_set_default_fallbacks: (a: number, b: number, c: number) => void;
    readonly mstext_set_family_fallbacks: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly mstext_text_block: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => [number, number];
    readonly mstext_text_on_path: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number];
    readonly renderer_adapter_info: (a: number) => [number, number];
    readonly renderer_apply: (a: number, b: number) => [number, number];
    readonly renderer_create: (a: any, b: number, c: number) => any;
    readonly renderer_delta_buffer: (a: number, b: number) => number;
    readonly renderer_delta_capacity: (a: number) => number;
    readonly renderer_effect_names: (a: number) => [number, number];
    readonly renderer_forget_device: () => void;
    readonly renderer_free_image: (a: number, b: number) => void;
    readonly renderer_gpu_device: (a: number) => any;
    readonly renderer_invalidate: (a: number) => void;
    readonly renderer_measure_text: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly renderer_prewarm: () => any;
    readonly renderer_read_pixels: (a: number) => any;
    readonly renderer_register_font: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly renderer_render: (a: number) => [number, number];
    readonly renderer_resize: (a: number, b: number, c: number) => void;
    readonly renderer_scene3d_bind: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly renderer_scene3d_pixels: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly renderer_scene3d_skipped: (a: number, b: number) => [number, number];
    readonly renderer_set_options: (a: number, b: number, c: number) => void;
    readonly renderer_set_scene3d: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly renderer_set_surface: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly renderer_shader_add: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly renderer_shader_build: (a: number, b: number) => void;
    readonly renderer_shader_formats: (a: number, b: number) => [number, number];
    readonly renderer_shader_remove: (a: number, b: number) => void;
    readonly renderer_stats: (a: number) => [number, number];
    readonly renderer_text_block_layout: (a: number, b: number) => [number, number];
    readonly renderer_upload_image: (a: number, b: number, c: any, d: number) => [number, number];
    readonly renderer_wait_gpu: (a: number) => any;
    readonly set_panic_listener: (a: number) => void;
    readonly start: () => void;
    readonly validate_shader: (a: number, b: number, c: number) => [number, number];
    readonly wasm_bindgen_1191a70febc59fc___convert__closures_____invoke___js_sys_2044d24e9c2bb073___Function_fn_wasm_bindgen_1191a70febc59fc___JsValue_____wasm_bindgen_1191a70febc59fc___sys__Undefined___js_sys_2044d24e9c2bb073___Function_fn_wasm_bindgen_1191a70febc59fc___JsValue_____wasm_bindgen_1191a70febc59fc___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_1191a70febc59fc___convert__closures_____invoke___wasm_bindgen_1191a70febc59fc___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_1191a70febc59fc___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_1191a70febc59fc___convert__closures_____invoke___wasm_bindgen_1191a70febc59fc___sys__JsNullable_wgpu_1da0beaa27c83114___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_1191a70febc59fc___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_1191a70febc59fc___convert__closures_____invoke___wasm_bindgen_1191a70febc59fc___sys__JsNullable_wgpu_1da0beaa27c83114___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_1191a70febc59fc___JsError___true__46: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_1191a70febc59fc___convert__closures_____invoke___wasm_bindgen_1191a70febc59fc___sys__JsNullable_wgpu_1da0beaa27c83114___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_1191a70febc59fc___JsError___true__47: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_1191a70febc59fc___convert__closures_____invoke___wgpu_1da0beaa27c83114___backend__webgpu__webgpu_sys__gen_GpuDeviceLostInfo__GpuDeviceLostInfo______true_: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
