import type { Vector2 } from "@/attributes/layout/vector2";
import type { AssetScope } from "@/assets/scope";
import type { Color, NormalizedColor } from "../fill/color/parser";
import { parseColor } from "../fill/color/parser";

/** `foreground` (default) is the node's own content; `backdrop` is what is already painted beneath it, clipped to the node's silhouette (Figma-style). */
export type EffectMode = "foreground" | "backdrop";

/**
 * How a backend must realise an effect: `"filter"` (default) transforms colours in place and composes as a
 * plain image filter; `"shader"` resamples pixel positions, so it needs the content snapshotted into a texture.
 */
export type EffectSurface = "filter" | "shader";

/** `"both"` is `{ x: 1, y: 1 }`; a {@link Vector2} gives fractional control per axis. */
export type EffectAxis = "x" | "y" | "both" | Vector2;

export function resolveEffectAxis(axis: EffectAxis): Vector2 {
    switch (axis) {
        case "x": return { x: 1, y: 0 };
        case "y": return { x: 0, y: 1 };
        case "both": return { x: 1, y: 1 };
        default: return { x: axis.x, y: axis.y };
    }
}

export function sameEffectAxis(a: EffectAxis, b: EffectAxis): boolean {
    const av = resolveEffectAxis(a);
    const bv = resolveEffectAxis(b);
    return av.x === bv.x && av.y === bv.y;
}

/**
 * Colour options are stored **as authored** (CSS string, theme alias or tuple), not parsed at build time, so a
 * raw effect literal behaves like the builder form and a theme alias resolves against the current `setTheme`.
 */
export function resolveEffectColor(color: Color): NormalizedColor {
    return Array.isArray(color) ? color : parseColor(color);
}

/** Do two colour options resolve to the same RGBA? (`'red'` === `'#ff0000'`.) */
export function sameEffectColor(a: Color, b: Color): boolean {
    if (a === b) return true;
    const av = resolveEffectColor(a);
    const bv = resolveEffectColor(b);
    return av[0] === bv[0] && av[1] === bv[1] && av[2] === bv[2] && av[3] === bv[3];
}

/** Omitted `mode` is `"foreground"`; one uniform field means the backdrop classifier never branches on `type`. */
export interface ModedEffect {
    mode?: EffectMode;
    /**
     * Confine the effect's output to the node's own silhouette rather than the rectangle its bleed would fill
     * (a bloom that doesn't halo the page, a blur that doesn't fray the edge). Honoured on both render paths;
     * redundant in `mode: 'backdrop'`, which is already confined.
     */
    clip?: boolean;
}

/** Cross-cutting options accepted by every effect builder. A new chain-wide option goes here and in {@link EFFECT_OPTION_KEYS}. */
export type EffectOptions = ModedEffect;

/** The {@link EffectOptions} keys {@link withEffectOptions} copies; `satisfies` keeps it in step with the interface. */
export const EFFECT_OPTION_KEYS = ["mode", "clip"] as const satisfies readonly (keyof EffectOptions)[];

/** Merges options onto a built effect, **skipping undefined keys**: `equals()` compares `mode` directly, so an explicit `mode: undefined` would differ from an unset one. */
export function withEffectOptions<T extends object>(base: T, options?: EffectOptions): T & EffectOptions {
    const out = { ...base } as T & EffectOptions;
    if (!options) return out;
    for (const key of EFFECT_OPTION_KEYS) {
        const value = options[key];
        // Written through a widened view: `out[key]` would narrow to `never` under a union key.
        if (value !== undefined) (out as Record<string, unknown>)[key] = value;
    }
    return out;
}

/** Every builder takes one argument; those with a dominant scalar also accept it directly, so `blur(8)` equals `blur({ radius: 8 })`. `key` is the field a bare number maps onto. */
export function scalarOptions<O extends object>(
    arg: number | O | undefined,
    key: keyof O,
): Partial<O> & EffectOptions {
    if (arg === undefined) return {};
    if (typeof arg === "number") return { [key]: arg } as Partial<O> & EffectOptions;
    return arg;
}

export interface EffectData<T> {
    lerp: (from: T, to: T, t: number) => T;

    equals: (a: T, b: T) => boolean;

    /** Defaults to `"filter"`; may be a predicate when the surface depends on fields (a foreground shader composes as a filter, the same effect in backdrop mode resamples). */
    surface?: EffectSurface | ((effect: T) => EffectSurface);

    /**
     * Normalise an authored effect, called once per property write via `resolveChainEffects`, so this is the one
     * place a stored document can be migrated forward. **Return the effect unchanged when nothing needs
     * rewriting**: it runs on every write and identity avoids churn.
     */
    resolve?(effect: T): T;

    /** Declare textures the effect samples, as an image fill does; an undeclared asset reads as "no texture". */
    declare?(effect: T, assets: AssetScope): void;
}
