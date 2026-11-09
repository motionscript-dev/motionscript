// The contract every effect port implements: one WGSL file in
// crates/renderer/src/effects/<type>.wgsl plus one file here, both named after
// core's effect `type`, the latter a `definePort` (_pack.ts) naming the pass's
// parameters. Both sides are discovered automatically (build.rs and
// `import.meta.glob`), so adding an effect never touches a shared file.

/** An extra texture an effect samples via `aux_texel` (a LUT, noise, an atlas). */
export interface AuxTexture {
    /** Cache key: the same key reuses the uploaded texture. */
    key: string;
    width: number;
    height: number;
    /** RGBA8, straight (unpremultiplied) alpha, row-major. */
    pixels: Uint8ClampedArray;
}

export interface Packed {
    /** Up to `MAX_PARAMS` (64) floats, laid out by `definePort` and read in WGSL through the generated `param_<name>()`. */
    params: number[];
    /** Logical px the effect can draw past its input (the layer grows by it). */
    reach?: number;
    /** Blur feeding `blurred()`: sigma along `angle`, sigma across it (logical px), angle in radians. */
    blur?: [number, number, number];
    aux?: AuxTexture;
    /** Read the node outline's inside distance field (`field(p)`, `max_distance()` in WGSL). */
    field?: boolean;
}

export interface EffectPort<E = any> {
    /** core's effect `type`; also the WGSL file name. */
    type: string;
    /**
     * The engine's path for this effect (core's `surface`). The engine applies
     * every shader-surface effect (in order) before every filter-surface one,
     * whatever the authored order; the adapter reproduces that.
     */
    surface: "shader" | "filter";
    /** The engine runs it only as a backdrop effect (`mode: "backdrop"`). */
    backdropOnly?: boolean;
    /** Authored effect (with core's defaults filled in) → WGSL inputs, or null for a no-op. */
    pack(effect: E): Packed | null;
    /** Effects for the parity harness, built with core's `Effects` builder. */
    cases(): object[];
}

export const PORTS: Map<string, EffectPort> = new Map(
    Object.entries(import.meta.glob<{ default: EffectPort }>("./*.ts", { eager: true }))
        .filter(([path]) => !path.includes("/_"))
        .map(([, m]) => [m.default.type, m.default]),
);
