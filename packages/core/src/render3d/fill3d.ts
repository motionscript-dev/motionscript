import { type Color, type NormalizedColor, parseColor } from "@/attributes/shape/fill/color/parser";
import { lerpColor } from "@/attributes/shape/fill/lerp";
import type { Fill } from "@/attributes/shape/fill/chain";
// A value import, unlike the type-only ones in `texture.ts`: building the rect a fill chain paints into needs the
// recorder. Safe because `render/graphics2d` reaches only the effects chain at runtime, never back into `render3d`.
import { Graphics2D } from "@/render/graphics2d";
import { looksLikeAssetPath } from "./texture";
import type { SurfaceSource3D, Texture3D } from "./texture";

export { looksLikeAssetPath };

/** What a surface is made of: the same value a 2D `fill` takes (colour, gradient, image, video, noise, layer stack, and, since a `Node2D` subtree or `Graphics2D` is a fill too, any 2D content), so a mesh and a rect share one vocabulary. */
export type Fill3D = Color | Fill | Texture3D | SurfaceSource3D;

/** What a {@link Fill3D} contributes to a material descriptor. */
export interface ResolvedFill3D {
    color?: Color;
    map?: Texture3D;
}

/** Sizing for the buffer a rich fill is rasterized into. */
export interface Fill3DOptions {
    /** Default 512. */
    width?: number;
    /** Default 512. */
    height?: number;
}

const DEFAULT_SIZE = 512;

/**
 * Resolves a {@link Fill3D} into the material fields it describes, by what the fill *is*: a **colour** stays a colour
 * (`material.color`, the common case, so it must not allocate a texture); a **texture** (asset path or `Texture3D`
 * descriptor) becomes `map`; **anything richer** (gradient, layer stack, `Node2D` subtree, `Graphics2D`, nested
 * `Scene3D`) is painted into an offscreen buffer and bound as `map` via the `Tex.surface` machinery. That last arm
 * makes the 2D and 3D fill vocabularies one: `Fills.canvas3D(scene)` in a chain renders 3D into a layer of a mesh's material.
 */
export function resolveFill3D(
    fill: Fill3D | undefined,
    options: Fill3DOptions = {},
): ResolvedFill3D {
    if (fill === undefined || fill === null) return {};

    if (typeof fill === "string") {
        // A bare string is ambiguous between a colour and an asset path; resolved as the material handler resolved a `color` that looked like a file.
        return looksLikeAssetPath(fill) ? { map: fill } : { color: fill };
    }

    if (Array.isArray(fill)) {
        // A `Color` is also an array, of numbers; a fill chain is an array of layers (strings or objects).
        if (fill.every((entry) => typeof entry === "number")) {
            return { color: fill as unknown as Color };
        }
        return { map: rasterized(fill as Fill, options) };
    }

    if (typeof fill === "object") {
        if (isSurfaceSourceValue(fill)) return { map: surfaceFor(fill as SurfaceSource3D, options) };
        if (isTextureDescriptor(fill)) return { map: fill as Texture3D };
        if (isSolidLayer(fill)) return { color: (fill as { color: Color }).color };
    }

    return { map: rasterized(fill as Fill, options) };
}

/** A surface texture painting `source` directly. Identity comes from the source object, which `Tex.surface` already requires to be hoisted, so a source that goes out of scope stops being cached. */
function surfaceFor(source: SurfaceSource3D, options: Fill3DOptions): Texture3D {
    return {
        source,
        width: options.width ?? DEFAULT_SIZE,
        height: options.height ?? DEFAULT_SIZE,
    };
}

/** A surface texture painting a fill chain into a rect that fills the buffer. Marked `static` with a derived identity: a chain describes the same pixels every frame unless one of its values moved, and without both a gradient on a cube would re-rasterize and re-upload a 512² buffer sixty times a second. A chain holding something live (a video layer, `Fills.canvas3D`) still re-rasterizes, as those carry object identity that `fillIdentity` folds in. */
function rasterized(fill: Fill, options: Fill3DOptions): Texture3D {
    const width = options.width ?? DEFAULT_SIZE;
    const height = options.height ?? DEFAULT_SIZE;
    return {
        source: new Graphics2D().rect({ width, height }).fill(fill),
        width,
        height,
        static: true,
        identity: `fill:${fillIdentity(fill)}:${width}x${height}`,
    };
}

function isTextureDescriptor(value: object): boolean {
    return "src" in value || "data" in value || ("source" in value && "width" in value);
}

/** True for 2D content to be painted rather than a descriptor. Structural like `resolveSurfaceSource` (an `instanceof` would close a module cycle). A `Scene3D` also exposes `ops()` so it is excluded: it is a fill layer (`Fills.canvas3D`) and goes through the chain arm to composite with the rest of the stack. */
function isSurfaceSourceValue(value: object): boolean {
    const bag = value as Record<string, unknown>;
    if (typeof bag.cameraDescriptor === "function") return false;
    if (typeof bag.ops === "function") return true;
    return typeof bag.id === "string" && typeof bag.attach === "function";
}

function isSolidLayer(value: object): boolean {
    const bag = value as Record<string, unknown>;
    if (bag.type !== "solid" || bag.color === undefined) return false;
    // Anything beyond the colour (opacity, blend, reference space) is a composite the colour slot can't express.
    return bag.opacity === undefined && bag.blend === undefined && bag.space === undefined;
}

/** Interpolates two fills. Colours interpolate; anything else holds the start and swaps at the end (there is no halfway between a gradient and a photograph; cross-fade with a stack and a tweened layer opacity, as in 2D). The colour test is cheap and allocation-free: resolving a rich fill builds a `Graphics2D` and texture descriptor, wasted on a tween that snaps. */
export function lerpFill3D(from: Fill3D, to: Fill3D, t: number): Fill3D {
    const start = asPlainColor(from);
    const end = asPlainColor(to);
    if (start !== null && end !== null) {
        return lerpColor(normalize(start), normalize(end), t) as unknown as Fill3D;
    }
    return t < 1 ? from : to;
}

/** The colour a fill *is*, or `null` when it is anything richer. No allocation. */
function asPlainColor(fill: Fill3D | undefined): Color | null {
    if (fill === undefined || fill === null) return null;
    if (typeof fill === "string") return looksLikeAssetPath(fill) ? null : fill;
    if (Array.isArray(fill)) {
        return fill.every((entry) => typeof entry === "number") ? (fill as unknown as Color) : null;
    }
    if (typeof fill === "object" && isSolidLayer(fill)) return (fill as { color: Color }).color;
    return null;
}

function normalize(color: Color): NormalizedColor {
    return Array.isArray(color) ? (color as NormalizedColor) : parseColor(color);
}

const objectIds = new WeakMap<object, string>();
let objectCounter = 0;

/** A stable key for a fill value. Plain data is walked and sorted; anything with its own prototype (`Scene3D`, `Graphics2D`, video source) is keyed by object identity, cheaper than serialising and honest since two instances are two things. A `FillChain` is unwrapped first so building one inline gives the same key. */
function fillIdentity(value: unknown): string {
    if (value === null || typeof value !== "object") return String(value);
    if (Array.isArray(value)) return `[${value.map(fillIdentity).join(",")}]`;

    const list = (value as { list?: unknown }).list;
    if (Array.isArray(list)) return fillIdentity(list);

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        let id = objectIds.get(value);
        if (id === undefined) {
            id = `@${objectCounter++}`;
            objectIds.set(value, id);
        }
        return id;
    }

    const bag = value as Record<string, unknown>;
    return `{${Object.keys(bag).sort().map((key) => `${key}:${fillIdentity(bag[key])}`).join(",")}}`;
}
