import type { Euler3, Quaternion, Vector3Input } from "./vector3";

/** Shadow tuning for a light. `mapSize`, `near`, `far`, `bias` and `normalBias` are derived by the renderer (the right bias depends on scene scale); {@link params} is applied straight onto the light's `shadow` object for the rare scene that overrides one. */
export interface ShadowOptions3D {
    /** 0 hard-edged → 1 very soft. Default 0.5. */
    softness?: number;
    /** Half-extent of a directional light's orthographic shadow frustum, world units. Sized to the scene bounds when omitted; too large is blocky, too small clips. */
    extent?: number;
    /** Escape hatch, assigned onto the renderer's shadow object. */
    params?: Record<string, unknown>;
}

/**
 * A node's relationship to shadows. Objects default to `true` (cast and receive) with the viewport's own `shadows`
 * switch deciding, so enabling shadows is enough without tagging every mesh. For a light it says whether it casts a
 * shadow map, and the object form tunes that map.
 *
 * Every light casting by default is a real cost once shadows are on (a point light needs a six-face cube map):
 * turn fill lights off with `shadow={false}` and leave the key light casting.
 */
export type Shadow3D = boolean | "cast" | "receive" | ShadowOptions3D;

export function shadowCasts(mode: Shadow3D | undefined): boolean {
    if (mode === undefined || mode === true) return true;
    if (mode === false) return false;
    return mode === "cast" || typeof mode === "object";
}

export function shadowReceives(mode: Shadow3D | undefined): boolean {
    if (mode === undefined || mode === true) return true;
    if (mode === false) return false;
    return mode === "receive" || typeof mode === "object";
}

/** A light's shadow tuning, or `null` when it casts none. */
export function resolveShadowOptions3D(mode: Shadow3D | undefined): ShadowOptions3D | null {
    if (!shadowCasts(mode)) return null;
    return typeof mode === "object" ? mode : {};
}

/**
 * Placement of a single 3D object; an omitted field means identity, so `{}` is a no-op. Rotation is in **degrees**
 * (matching 2D `rotation`); the renderer converts. No hand-written key: a node stamps its id on the scope it opens,
 * and a drawable is keyed by that id plus a content signature, so conditional builders reuse the right cache entry.
 */
export interface Transform3D {
    /** Position in the parent's local space. Default origin. */
    position?: Vector3Input;
    /** Euler rotation in **degrees**, applied in `order` (default `"XYZ"`); ignored when {@link quaternion} is set. */
    rotation?: Vector3Input | Euler3;
    /** Unit quaternion; wins over {@link rotation}. Use it (with `slerpQuaternion`) for tumbles where Euler would gimbal. */
    quaternion?: Quaternion;
    /** Per-axis scale; a scalar scales uniformly. Default 1. */
    scale?: Vector3Input;
    /** World-space point to orient toward, applied after {@link position}; wins over {@link rotation} and {@link quaternion}. */
    lookAt?: Vector3Input;
    /** Hide without removing (keeps the cached object alive). Default true. */
    visible?: boolean;
    /** Shadow participation. Default `true` — see {@link Shadow3D}. */
    shadow?: Shadow3D;
    /** Draw-order override, for tuning transparent sorting. */
    renderOrder?: number;
    /**
     * Node identity, stamped by `Scene3D.begin` so the renderer caches a group against the node that opened it; never written by an author.
     *
     * @internal
     */
    key?: string;
}

/** Which faces of a surface are rasterized. */
export type Faces3D = "front" | "back" | "both";

/** How a drawn colour combines with what is already in the framebuffer. */
export type Blend3D = "normal" | "additive" | "subtractive" | "multiply" | "none";
