/* tslint:disable */
/* eslint-disable */

export class R3d {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static create(canvas: any, width: number, height: number): Promise<R3d>;
    /**
     * Renders and resolves to tightly packed RGBA8 rows (premultiplied,
     * sRGB-encoded, like three's canvas). Yields a `Uint8Array`.
     */
    read_pixels(): Promise<any>;
    /**
     * Renders the current scene to the canvas.
     */
    render(): void;
    resize(width: number, height: number): void;
    /**
     * Decodes a scene stream (`web/src/r3d/encode.ts`) and makes it current.
     */
    set_scene(words: Uint32Array | number[]): void;
    /**
     * What the current scene recorded and this renderer skipped.
     */
    skipped(): string[];
    /**
     * [decode ms, encode+submit ms, draws, instances, triangles, shadow maps,
     *  cached geometries, pipelines]
     */
    stats(): Float64Array;
    /**
     * Uploads straight-alpha RGBA8 pixels (first row at v = 0) as texture
     * `id`, mipmapped; `srgb` for colour maps.
     */
    upload_texture(id: number, rgba: Uint8Array | number[], width: number, height: number, srgb: boolean): void;
    /**
     * Resolves once the GPU has finished all submitted work.
     */
    wait_gpu(): Promise<any>;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_r3d_free: (a: number, b: number) => void;
    readonly r3d_create: (a: any, b: number, c: number) => any;
    readonly r3d_read_pixels: (a: number) => any;
    readonly r3d_render: (a: number) => [number, number];
    readonly r3d_resize: (a: number, b: number, c: number) => void;
    readonly r3d_set_scene: (a: number, b: number, c: number) => [number, number];
    readonly r3d_skipped: (a: number) => [number, number];
    readonly r3d_stats: (a: number) => [number, number];
    readonly r3d_upload_texture: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly r3d_wait_gpu: (a: number) => any;
    readonly wasm_bindgen_c54cff2367d5891d___convert__closures_____invoke___js_sys_5cb9a9fb1a86bdfe___Function_fn_wasm_bindgen_c54cff2367d5891d___JsValue_____wasm_bindgen_c54cff2367d5891d___sys__Undefined___js_sys_5cb9a9fb1a86bdfe___Function_fn_wasm_bindgen_c54cff2367d5891d___JsValue_____wasm_bindgen_c54cff2367d5891d___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_c54cff2367d5891d___convert__closures_____invoke___wasm_bindgen_c54cff2367d5891d___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_c54cff2367d5891d___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_c54cff2367d5891d___convert__closures_____invoke___wasm_bindgen_c54cff2367d5891d___sys__JsNullable_wgpu_a064b5c3144d01e0___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_c54cff2367d5891d___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_c54cff2367d5891d___convert__closures_____invoke___wasm_bindgen_c54cff2367d5891d___sys__JsNullable_wgpu_a064b5c3144d01e0___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_c54cff2367d5891d___JsError___true__12: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_c54cff2367d5891d___convert__closures_____invoke___wasm_bindgen_c54cff2367d5891d___sys__JsNullable_wgpu_a064b5c3144d01e0___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_c54cff2367d5891d___JsError___true__13: (a: number, b: number, c: any) => [number, number];
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
