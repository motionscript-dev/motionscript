/**
 * The vocabulary of an orbit camera, and the lerps a 3D component tweens with.
 *
 * Unrelated node types are flown by one — a globe, a surface plot — and they
 * are unrelated on purpose: what they share is a camera, not a subject. So this
 * belongs to none of them, and a package per subject would either duplicate it
 * or make one depend on another.
 */
import {
  parseColor,
  type Color,
  type NormalizedColor,
} from "@/attributes/shape/fill/color/parser"
import type { Vector3 } from "@/render3d/vector3"

// --- Colour ----------------------------------------------------------------

/**
 * Mapper: any {@link Color} → a normalized RGBA tuple.
 *
 * Resolving at *write* time rather than at draw time is the point. A tuple can
 * be interpolated channel by channel; `"#3B82F6"` cannot, and re-parsing a
 * string per frame would be wasted work besides. The tuple is still a valid
 * `Color`, so it goes straight back to `Graphics3D` with no conversion.
 */
export function resolveColor3D(value: Color): NormalizedColor {
  return typeof value === "string" ? parseColor(value) : value
}

/** Tween: per-channel interpolation of two resolved colours. */
export function lerpColor3D(
  from: NormalizedColor,
  to: NormalizedColor,
  t: number
): NormalizedColor {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
    from[3] + (to[3] - from[3]) * t,
  ]
}

// --- Numbers ---------------------------------------------------------------

/**
 * Interpolates two numbers, tolerating non-finite endpoints.
 *
 * A resolved options bag can legitimately hold `Infinity` (an unset `maxZoom`
 * means "no ceiling"), and the plain form would produce `NaN` from
 * `Infinity + (Infinity - Infinity) * t`. Non-finite endpoints hold `from` and
 * switch at the end instead.
 */
export function lerpFinite(from: number, to: number, t: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return t < 1 ? from : to
  return from + (to - from) * t
}

/**
 * Interpolates a value that indexes geometry — a segment or division count.
 * Rounded, because a fractional count is meaningless to the loops that consume
 * it.
 */
export function lerpCount(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t)
}

/**
 * Tweens a value that has no in-between — a flag, a representation, a colour
 * scheme — by holding `from` until the tween lands.
 *
 * There is no halfway point between a wireframe and a solid surface, and a
 * mid-tween flip reads as a glitch rather than a transition, so the switch
 * happens once at the end. Snapping at the *midpoint* would be worse still: the
 * change would land while the command was still running, so a `to` would appear
 * to finish early.
 */
export function snapValue<T>(from: T, to: T, t: number): T {
  return t < 1 ? from : to
}

/** {@link snapValue}, narrowed to a boolean where that is all a caller has. */
export const snapFlag: (from: boolean, to: boolean, t: number) => boolean =
  snapValue

// --- Camera ----------------------------------------------------------------

/** A camera placement in spherical terms — what `orbit`/`elevation`/`zoom` hold. */
export interface Orbit {
  /** Angle about the vertical axis, in **degrees**. */
  orbit: number
  /** Angle above the ground plane, in **degrees**. 0 is edge-on, 90 straight down. */
  elevation: number
  /** Distance from the target. */
  distance: number
}

/**
 * A stored `orbit` in the camera's own terms.
 *
 * The engine's camera takes `orbit`/`elevation`/`distance` directly now,
 * which is what these nodes always wanted — but the two conventions disagree
 * about zero: a stored `orbit` here is measured from **+X**, and the camera
 * measures from **+Z** (head-on). A quarter turn separates them.
 *
 * Converting at this one seam is what keeps every document that already holds an
 * `orbit` value framed exactly as it was. Redefining the stored field instead
 * would silently rotate every saved 3D scene by ninety degrees, which is not a
 * change a scene can notice or a reader can debug.
 */
export function cameraOrbit(orbit: number): number {
  return 90 - orbit
}

/**
 * The Cartesian position for a spherical camera placement.
 *
 * Spherical is the useful parameterisation for a timeline: each of the three
 * numbers is independently tweenable and means something an author can reason
 * about, whereas tweening a raw `[x, y, z]` couples "spin" and "pull back"
 * together and cuts a chord through the sphere on the way.
 *
 * The **camera** no longer goes through this: it takes the three numbers itself
 * (see {@link cameraOrbit}), so converting to a position and back was one more
 * place for the two conventions to drift. What is left is placing something
 * *else* spherically — a light on an arc, a marker ring.
 */
export function orbitPosition({ orbit, elevation, distance }: Orbit): Vector3 {
  const orbitRad = orbit * (Math.PI / 180)
  const elevationRad = elevation * (Math.PI / 180)
  const horizontal = Math.cos(elevationRad) * distance
  return {
    x: Math.cos(orbitRad) * horizontal,
    y: Math.sin(elevationRad) * distance,
    z: Math.sin(orbitRad) * horizontal,
  }
}

/**
 * A camera placement to move *to*, with every axis optional.
 *
 * The argument `orbitTo` takes, shared by every node that frames a 3D scene
 * spherically — a globe, a surface plot. One object rather than
 * three positional numbers because the common edit is one axis: "pull back" and
 * "spin round" are separate intentions, and a positional form would make each
 * of them restate the two it does not mean.
 *
 * `zoom` rather than {@link Orbit}'s `distance`, because that is what these
 * nodes call the prop.
 */
export interface OrbitTarget {
    /** Angle about the vertical axis, in degrees. */
    orbit?: number
    /** Angle above the ground plane, in degrees. */
    elevation?: number
    /** Distance from the target. */
    zoom?: number
}

/**
 * `target` as props to write, with the axes it does not name left out.
 *
 * Omitted rather than passed as `undefined`: a tween reads its `from` off the
 * node when the command is built, and handing it an explicit `undefined`
 * destination would interpolate towards `NaN` rather than leaving the axis
 * alone.
 */
export function orbitProps(target: OrbitTarget): Record<string, number> {
    const props: Record<string, number> = {}
    if (target.orbit !== undefined) props.orbit = target.orbit
    if (target.elevation !== undefined) props.elevation = target.elevation
    if (target.zoom !== undefined) props.zoom = target.zoom
    return props
}
