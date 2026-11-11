import type { BufferGeometry3D } from "@/render3d/geometry";
import type { Color } from "@/attributes/shape/fill/color/parser";

import { resolveColor3D } from "@/attributes/render3d/orbit"

/** How the ground plane is drawn — the fields the Canvas 3D's schema states. */
export interface Grid3DOptions {
  /** Total extent of the grid, in scene units. It spans `±size / 2` on both axes. */
  size: number
  /** How many cells across. One minor line per cell boundary. */
  divisions: number
  /** Every Nth minor line is drawn in {@link majorColor} instead. */
  majorEvery: number
  minorColor: Color
  majorColor: Color
  /** The line through `z = 0`. Red by convention, in every 3D tool there is. */
  axisXColor: Color
  /** The line through `x = 0`. Blue by the same convention. */
  axisZColor: Color
  /** Whether to draw the two axis lines at all. */
  showAxes: boolean
  /** What the far edge fades into (the colour behind the grid). Lerps each vertex's *colour* toward this instead of dropping alpha, since the descriptor has no per-vertex alpha; over an opaque background the two are indistinguishable and this needs no blending or sort order. A {@link Color} because it is read off the node's fill stack (`Canvas3DView.fadeColor`), where a resolved paint holds a normalized tuple. */
  fadeTo: Color
  /** How much of the way to the edge the fade has finished, in `[0, 1]`; `0` disables it. Distance is radial from the origin, so the grid dissolves into a disc rather than leaving four corners visible after the edges have gone (a horizon, not a square table). */
  fade: number
}

/** The ground plane as one buffer of line segments. **One geometry, not three**: minor lines, major lines and axes differ only in colour (a vertex attribute), so three ops would be three draw calls and three chances for the sort order to bury an axis. One op with `vertexColors: true` on one unlit material also allows the distance fade, which varies along each line. The arrays are freshly allocated, so the caller caches them (see {@link Canvas3DView}, which marks the result `staticData`); rebuilding per frame would be ~10k floats and a full re-upload. */
export function gridGeometry3D(options: Grid3DOptions): BufferGeometry3D {
  const { size, divisions, majorEvery, showAxes, fade } = options

  const half = size / 2
  const step = size / divisions
  const minor = rgb(options.minorColor)
  const major = rgb(options.majorColor)
  const axisX = rgb(options.axisXColor)
  const axisZ = rgb(options.axisZColor)
  const fadeTo = rgb(options.fadeTo)

  const position: number[] = []
  const color: number[] = []

  /** One segment, with each end faded by its own distance from the origin. */
  const segment = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    tint: readonly [number, number, number]
  ): void => {
    // y is a hair above zero for the axes only (see the call sites).
    position.push(ax, 0, az, bx, 0, bz)
    pushFaded(color, tint, fadeTo, fadeAt(ax, az, half, fade))
    pushFaded(color, tint, fadeTo, fadeAt(bx, bz, half, fade))
  }

  for (let i = 0; i <= divisions; i++) {
    const offset = -half + i * step
    // Counted from the centre line so "every Nth" is symmetric about the origin; otherwise major lines drift off-centre on an odd division count.
    const fromCentre = Math.abs(i - divisions / 2)
    const isCentre = Math.abs(offset) < step / 2
    // Centre lines are the axes' own: skipped when axes are drawn, ordinary major lines otherwise.
    if (isCentre && showAxes) continue

    const tint =
      Number.isInteger(fromCentre) && fromCentre % majorEvery === 0
        ? major
        : minor

    segment(offset, -half, offset, half, tint)
    segment(-half, offset, half, offset, tint)
  }

  if (showAxes) {
    // Same plane as the grid: the axes replace the two centre lines rather than sitting over them, so nothing z-fights.
    segment(-half, 0, half, 0, axisX)
    segment(0, -half, 0, half, axisZ)
  }

  return {
    type: "buffer",
    position: new Float32Array(position),
    color: new Float32Array(color),
    // Nothing here is lit (a grid is emissive), so asking for normals would be a wasted pass.
    computeNormals: false,
    // True only because the caller caches: see this module's note.
    staticData: true,
  }
}

/** How faded a point is, in `[0, 1]` (1 is fully the background). Squared falloff: a linear ramp over a plane at a shallow angle reads as a hard edge, compressing most of the ramp into the last pixels before the horizon. */
function fadeAt(
  x: number,
  z: number,
  half: number,
  fade: number
): number {
  if (fade <= 0) return 0
  const distance = Math.hypot(x, z) / half
  const start = 1 - fade
  if (distance <= start) return 0
  const t = Math.min(1, (distance - start) / Math.max(fade, 1e-6))
  return t * t
}

/** Push one vertex colour, lerped `t` of the way from `tint` toward `fadeTo`. */
function pushFaded(
  out: number[],
  tint: readonly [number, number, number],
  fadeTo: readonly [number, number, number],
  t: number
): void {
  out.push(
    tint[0] + (fadeTo[0] - tint[0]) * t,
    tint[1] + (fadeTo[1] - tint[1]) * t,
    tint[2] + (fadeTo[2] - tint[2]) * t
  )
}

/** A colour as the linear RGB triple a vertex attribute holds. `resolveColor3D` gives normalized sRGB but three reads vertex colours as **linear**; skipping the conversion paints an sRGB 0.16 at about 0.4 (a grid that shouts instead of whispering). */
function rgb(value: Color): [number, number, number] {
  const [r, g, b] = resolveColor3D(value)
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
}

/** The sRGB transfer function, inverted. three's own `SRGBToLinear`. */
function srgbToLinear(channel: number): number {
  return channel < 0.04045
    ? channel * 0.0773993808
    : Math.pow(channel * 0.9478672986 + 0.0521327014, 2.4)
}
