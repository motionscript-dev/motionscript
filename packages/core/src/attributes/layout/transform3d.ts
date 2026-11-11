import { Alignment } from "@/attributes/layout/alignment";

/** The out-of-plane transform as one bag, shorthand for the individual `rotationX` / `rotationY` / `depth` / `perspective` / `backfaceVisible` / `flipHorizontal` / `flipVertical` / `transformOrigin` props on {@link Node2D}. Only sugar: {@link expandTransform3D} writes each field onto the prop it names before anything reads either, so a tween of `transform3D.rotationY` and of `rotationY` are the same tween. Named `NodeTransform3D` because `Transform3D` in `render3d` places a mesh in a real 3D scene; this tilts a flat node as a browser tilts a `<div>`. */
export interface NodeTransform3D {
    /** Tilt about the horizontal axis, degrees. Positive tips the top away. */
    rotationX?: number;
    /** Tilt about the vertical axis, degrees. Positive swings the right edge away. */
    rotationY?: number;
    /** In-plane rotation belonging to the 3D block, degrees. Separate from the node's own `rotation`. */
    rotationZ?: number;
    /** Push along the view axis in px (CSS `translateZ`). Inert without `perspective`. */
    depth?: number;
    /** Viewer distance in px. `0` (default) is a parallel projection — no perspective. */
    perspective?: number;
    /** Whether the node still paints once it has turned past edge-on. Default `true`. */
    backfaceVisible?: boolean;
    /** Mirror across the vertical centre line (CSS `scaleX(-1)`). */
    flipHorizontal?: boolean;
    /** Mirror across the horizontal centre line (CSS `scaleY(-1)`). */
    flipVertical?: boolean;
    /** The point the whole transform turns about — CSS `transform-origin`. Defaults to the node's `pivot`. */
    origin?: Alignment;
}

/** The prop each {@link NodeTransform3D} field expands to. `origin` is the one rename. */
const TRANSFORM_3D_KEYS: ReadonlyArray<[keyof NodeTransform3D, string]> = [
    ["rotationX", "rotationX"],
    ["rotationY", "rotationY"],
    ["rotationZ", "rotationZ"],
    ["depth", "depth"],
    ["perspective", "perspective"],
    ["backfaceVisible", "backfaceVisible"],
    ["flipHorizontal", "flipHorizontal"],
    ["flipVertical", "flipVertical"],
    ["origin", "transformOrigin"],
];

/** Expands the `transform3D` shorthand onto the individual props in place. An explicitly named prop in the same object wins over the bag's field (as `size` vs `width`); a whole-bag callback is left alone, having no per-field value to distribute. */
/** @internal */
export function expandTransform3D(props: Record<string, unknown>): void {
    const bag = props.transform3D;
    if (bag === undefined || bag === null || typeof bag !== "object") return;
    const source = bag as Record<string, unknown>;
    for (const [field, prop] of TRANSFORM_3D_KEYS) {
        const value = source[field];
        if (value !== undefined && props[prop] === undefined) props[prop] = value;
    }
}
