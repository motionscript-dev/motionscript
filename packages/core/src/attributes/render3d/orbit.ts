/** The vocabulary of an orbit camera and the lerps a 3D component tweens with. Shared by unrelated node types (a globe, a surface plot) that have a camera, not a subject, in common, so it belongs to none of them. */
import {
  parseColor,
  type Color,
  type NormalizedColor,
} from "@/attributes/shape/fill/color/parser"
import type { Vector3 } from "@/render3d/vector3"

/** Mapper: any {@link Color} to a normalized RGBA tuple. Resolved at *write* time because a tuple interpolates per channel while `"#3B82F6"` cannot; the tuple is still a valid `Color`. */
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

/** Interpolates two numbers, tolerating non-finite endpoints: a resolved options bag can hold `Infinity` (unset `maxZoom` = no ceiling) and the plain form yields `NaN`. Non-finite endpoints hold `from` and switch at the end. */
export function lerpFinite(from: number, to: number, t: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return t < 1 ? from : to
  return from + (to - from) * t
}

/** Interpolates a geometry-indexing value (segment or division count), rounded since a fractional count is meaningless to its loops. */
export function lerpCount(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t)
}

/** Tweens a value with no in-between (a flag, a representation) by holding `from` until the tween lands. A mid-tween flip reads as a glitch, and snapping at the *midpoint* would land the change while the command still ran. */
export function snapValue<T>(from: T, to: T, t: number): T {
  return t < 1 ? from : to
}

/** {@link snapValue}, narrowed to a boolean where that is all a caller has. */
export const snapFlag: (from: boolean, to: boolean, t: number) => boolean =
  snapValue

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
 * A stored `orbit` in the camera's own terms. A stored `orbit` is measured from **+X** and the camera's from **+Z**
 * (head-on): a quarter turn apart. Converting at this one seam keeps every existing document framed exactly as it
 * was; redefining the stored field would silently rotate every saved 3D scene by ninety degrees.
 */
export function cameraOrbit(orbit: number): number {
  return 90 - orbit
}

/** The Cartesian position for a spherical placement. Spherical suits a timeline: each number tweens independently, where a raw `[x, y, z]` couples "spin" and "pull back" and cuts a chord through the sphere. The camera takes the three numbers itself (see {@link cameraOrbit}); this places something *else* spherically (a light, a marker ring). */
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

/** A camera placement to move *to*, every axis optional: the argument of `orbitTo`. An object rather than positional numbers because the common edit is one axis. `zoom` rather than {@link Orbit}'s `distance`, the nodes' prop name. */
export interface OrbitTarget {
    /** Angle about the vertical axis, in degrees. */
    orbit?: number
    /** Angle above the ground plane, in degrees. */
    elevation?: number
    /** Distance from the target. */
    zoom?: number
}

/** `target` as props to write, omitting axes it does not name: an explicit `undefined` destination would tween towards `NaN`. */
export function orbitProps(target: OrbitTarget): Record<string, number> {
    const props: Record<string, number> = {}
    if (target.orbit !== undefined) props.orbit = target.orbit
    if (target.elevation !== undefined) props.elevation = target.elevation
    if (target.zoom !== undefined) props.zoom = target.zoom
    return props
}
