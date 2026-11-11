import type { Vector2 } from "@/attributes/layout/vector2";
// Type-only, like `Color`: `render3d` is pure data and never reaches into the render or node layers at runtime (see SurfaceSource3D).
import type { Graphics2D } from "@/render/graphics2d";
import type { Node } from "@/components/trees/node/node";
import type { Node2D } from "@/components/trees/2d/node2d";

/** How sampling behaves outside the 0–1 UV range. */
export type TextureWrap3D = "clamp" | "repeat" | "mirror";

/** How texels are blended when the texture is scaled. */
export type TextureFilter3D = "nearest" | "linear";

/** Colour space of the texture's data: `"srgb"` for colours an eye would see (albedo/`map`, `emissiveMap`), linearized before lighting; `"linear"` for data maps (`normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `displacementMap`), which linearizing would corrupt. Each slot defaults correctly. */
export type TextureColorSpace3D = "srgb" | "linear";

/** Sampler state shared by every texture source. */
export interface TextureOptions3D {
    wrapS?: TextureWrap3D;
    wrapT?: TextureWrap3D;
    /** UV scale. `[2, 2]` tiles twice on each axis (needs a `repeat` wrap). */
    repeat?: Vector2 | readonly [number, number];
    offset?: Vector2 | readonly [number, number];
    /** UV rotation in **degrees**, about {@link center}. */
    rotation?: number;
    center?: Vector2 | readonly [number, number];
    magFilter?: TextureFilter3D;
    minFilter?: TextureFilter3D;
    /** Sharpness at grazing angles. Clamped to the GPU's maximum. */
    anisotropy?: number;
    flipY?: boolean;
    colorSpace?: TextureColorSpace3D;
}

/** A texture from the project's asset manifest. `src` is found by the asset-tracking pass and requested through the ordinary image pipeline (as a 2D image fill), so pixels are resident before the frame draws. */
export interface ImageTexture3D extends TextureOptions3D {
    src: string;
}

/** Raw RGBA8888 bytes: the escape hatch for procedurally generated pixels (ramps, noise, LUTs, data as colour). */
export interface DataTexture3D extends TextureOptions3D {
    data: ArrayLike<number>;
    width: number;
    height: number;
    /** Bump to force a re-upload after mutating `data` in place (invisible to identity comparison). See {@link BufferGeometry3D.revision}. */
    revision?: number;
}

/**
 * A texture whose pixels are Motion Script's own 2D output, rasterized offscreen: puts a chart, readout or laid-out UI
 * onto 3D geometry. `source` is a value, a built {@link Graphics2D} or a `Node2D` subtree, supplied directly with no
 * indirection or tree placement.
 *
 *   g3.plane({ map: Tex.surface(scopeGraphics, 1024, 640) })
 *
 * A `Node2D` source is adopted for binding by whatever paints the scene (asset catalog, inherited context, clock, so a
 * webfont shapes and an `<Image>` loads); it is never laid out or painted by the scene tree, only measured against
 * `width` x `height` and drawn into the buffer.
 *
 * **Hoist the source.** Building it inside the scene builder allocates a new subtree every frame (re-binding,
 * re-laying-out, defeating the texture cache, leaking). A hoisted source is a stable identity, so the renderer keys
 * the GPU texture off the source object (a `WeakMap`) and a source that goes out of scope becomes collectable.
 */
export interface SurfaceTexture3D extends TextureOptions3D {
    /** A built `Graphics2D`, or a `Node2D` subtree (typed structurally, see {@link SurfaceSource3D}). */
    source: SurfaceSource3D;
    /** Buffer width in pixels. This *is* the texture's resolution. */
    width: number;
    height: number;
    /**
     * Declares the source's pixels unchanging, so the buffer is rasterized once and reused. Set by `resolveFill3D` for a
     * fill chain; an author's own source is live by default, so an animated `Graphics2D` or prop-driven subtree works
     * with no bookkeeping. Needs {@link identity} to be cacheable.
     *
     * @internal
     */
    static?: boolean;
    /**
     * Cache identity for a synthesized source. An author's source is identified by the object itself (right for a hoisted
     * one); a source built for a fill is fresh every frame, so the value it was derived from supplies one.
     *
     * @internal
     */
    identity?: string;
    /** Ceiling on the buffer's device-pixel ratio, default 1 (the buffer is exactly `width` x `height`). A surface is sampled at whatever size the geometry occupies, so `width`/`height` is the real control; raise this only for a surface viewed close up that reads soft. */
    maxPixelRatio?: number;
}

/** What a {@link SurfaceTexture3D} paints from: a built {@link Graphics2D} or a {@link Node2D} subtree. Both imports are type-only: `render3d` is pure data, and a value import of `Node2D` would close a real cycle. Narrow with {@link resolveSurfaceSource}. */
export type SurfaceSource3D = Graphics2D | Node;

// Declared against the dimension-agnostic base because that is what a built node is typed as, so
// `Tex.surface(new Rect({ ... }), ...)` type-checks without a cast. It must be 2D in fact; `resolveSurfaceSource`
// narrows, and a `Node3D` fails at render time.

/** A {@link SurfaceSource3D} narrowed to the arm its renderer should take. */
export type ResolvedSurfaceSource =
    | { kind: "graphics"; graphics: Graphics2D }
    | { kind: "node"; node: Node2D };

/** Narrows a surface source to the arm that draws it: a `Graphics2D` is replayed into a render context, a `Node2D` is laid out against the buffer and rendered. Structural, not `instanceof` (value imports would close the cycle): `Graphics2D` exposes `ops()` and a `Node2D` doesn't. */
export function resolveSurfaceSource(source: SurfaceSource3D): ResolvedSurfaceSource {
    return typeof (source as Graphics2D).ops === "function"
        ? { kind: "graphics", graphics: source as Graphics2D }
        : { kind: "node", node: source as Node2D };
}

/** A texture reference; a bare string is sugar for `{ src }` (`map: "/wood.png"`). */
export type Texture3D = string | ImageTexture3D | DataTexture3D | SurfaceTexture3D;

export function isDataTexture3D(texture: Texture3D): texture is DataTexture3D {
    return typeof texture !== "string" && "data" in texture;
}

export function isSurfaceTexture3D(texture: Texture3D): texture is SurfaceTexture3D {
    return typeof texture !== "string" && "source" in texture;
}

export function resolveTexture3D(texture: Texture3D): ImageTexture3D | DataTexture3D | SurfaceTexture3D {
    return typeof texture === "string" ? { src: texture } : texture;
}

/** The asset `src` a texture reads from, or `null` for a data or surface texture; the asset-tracking pass uses it, and `null` means "nothing to request". */
export function texture3DSource(texture: Texture3D): string | null {
    if (typeof texture === "string") return texture;
    if (isDataTexture3D(texture) || isSurfaceTexture3D(texture)) return null;
    return texture.src;
}

/** True for a string that names an asset rather than a colour: a leading `/` or `.` is a path, otherwise the extension decides. A bare name like `"wood"` is a colour, as the manifest couldn't resolve it either. */
export function looksLikeAssetPath(value: string): boolean {
    return value.startsWith("/")
        || value.startsWith(".")
        || /\.(png|jpe?g|webp|avif|svg|ktx2?|hdr|exr|mp4|webm|mov)$/i.test(value);
}
