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
  /**
   * What the far edge fades into — the colour behind the grid.
   *
   * Fading is done by lerping each vertex's *colour* toward this rather than by
   * dropping its alpha, because a vertex colour is RGB and there is nowhere to
   * put a per-vertex alpha in the descriptor (see {@link BufferGeometry3D}). Over
   * an opaque background the two are indistinguishable, and this one costs no
   * blending and no sort order.
   *
   * A {@link Color} rather than a string, because it is read off the node's fill
   * stack now — see `Canvas3DView.fadeColor` — and a resolved paint holds its
   * colour as a normalized tuple.
   */
  fadeTo: Color
  /**
   * How much of the way to the edge the fade has finished, in `[0, 1]`.
   *
   * `0` disables it. Distance is measured radially from the origin rather than
   * per-axis, so the grid dissolves into a disc — which is what stops the four
   * corners from staying visible long after the edges have gone, and is why the
   * horizon in a viewport reads as a horizon rather than as a square table.
   */
  fade: number
}

/**
 * The ground plane, as one buffer of line segments.
 *
 * **One geometry, not three.** The minor lines, the major lines and the two axes
 * differ only in colour, and colour is a vertex attribute — so drawing them as
 * three ops with three materials would be three draw calls, three cache entries
 * and three chances for the sort order to put an axis under the grid it is
 * supposed to sit in. Baking the colour per vertex makes it one op with
 * `vertexColors: true` on a single unlit material, which is also the only way to
 * get the distance fade at all: it varies *along* each line, and a material's
 * colour is uniform across the primitive it paints.
 *
 * The returned arrays are freshly allocated, so the caller is expected to cache
 * them — see {@link Canvas3DView}, which does, and marks the result
 * `staticData` on the strength of it. Rebuilding this every frame would be
 * ~10k floats of allocation and a full re-upload for a picture that only changes
 * when somebody edits a field.
 */
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
    // y is a hair above zero for the axes only — see the call sites. Everything
    // here is the same plane otherwise.
    position.push(ax, 0, az, bx, 0, bz)
    pushFaded(color, tint, fadeTo, fadeAt(ax, az, half, fade))
    pushFaded(color, tint, fadeTo, fadeAt(bx, bz, half, fade))
  }

  for (let i = 0; i <= divisions; i++) {
    const offset = -half + i * step
    // The index counted from the centre line, so "every Nth" is symmetrical
    // about the origin rather than about the grid's far corner — otherwise the
    // major lines drift off-centre on an odd division count.
    const fromCentre = Math.abs(i - divisions / 2)
    const isCentre = Math.abs(offset) < step / 2
    // The centre lines are the axes' own, so they are skipped here when the axes
    // are being drawn and left as ordinary major lines when they are not.
    if (isCentre && showAxes) continue

    const tint =
      Number.isInteger(fromCentre) && fromCentre % majorEvery === 0
        ? major
        : minor

    segment(offset, -half, offset, half, tint)
    segment(-half, offset, half, offset, tint)
  }

  if (showAxes) {
    // The X axis runs along x with z pinned at 0, and vice versa. Same plane as
    // the grid: they replace the two centre lines rather than sitting over them,
    // so there is nothing to z-fight with.
    segment(-half, 0, half, 0, axisX)
    segment(0, -half, 0, half, axisZ)
  }

  return {
    type: "buffer",
    position: new Float32Array(position),
    color: new Float32Array(color),
    // Nothing here is lit — a grid is emissive by nature — so there are no
    // normals to derive and asking for them would be a wasted pass.
    computeNormals: false,
    // True only because the caller caches: see this module's note.
    staticData: true,
  }
}

/**
 * How faded a point is, in `[0, 1]`, where 1 is fully the background.
 *
 * Squared falloff rather than linear, because a linear ramp over a plane seen at
 * a shallow angle reads as a hard edge — most of the ramp is compressed into the
 * last few pixels before the horizon. The square spends more of its range near
 * the camera, where the perspective is stretching it back out.
 */
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

/**
 * A colour as the linear RGB triple a vertex attribute holds.
 *
 * `resolveColor3D` gives normalized sRGB; three reads vertex colours as
 * **linear**, so each channel is converted. Skipping this is the classic
 * washed-out-grid bug: an sRGB 0.16 uploaded as linear paints at about 0.4,
 * which is why a grid that should whisper ends up shouting.
 */
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
