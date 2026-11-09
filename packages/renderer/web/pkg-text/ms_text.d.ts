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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_mstext_free: (a: number, b: number) => void;
    readonly mstext_glyph_path: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly mstext_layout: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number];
    readonly mstext_measure_text: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly mstext_new: () => number;
    readonly mstext_register_font: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly mstext_set_default_fallbacks: (a: number, b: number, c: number) => void;
    readonly mstext_set_family_fallbacks: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly mstext_text_block: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => [number, number];
    readonly mstext_text_on_path: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
