/** What the polar charts (pie, radial) share: slices, ring geometry, the hole's summary and the selection fade. */

import { clamp, fillOps, type Fill, type FillResolved, type TextStyle, type Vector2 } from "@motionscript/sdk"

/** One resolved slice, which the ring and legend consume; the chart resolves it from `data` and two field names. */
export interface PieSlice {
  /** Label and legend caption. */
  category: string
  /** The wedge covers `value / (sum of all values)`. */
  value: number
  /** Wedge and swatch paint. */
  fill: Fill
}

export const DEG = Math.PI / 180

/**
 * Opacity of a slice under the selection: 1 while nothing is out (`focus` is the
 * most-grown pop) and for the selected slice itself, falling toward `dimOpacity`
 * for the rest as the selection grows.
 */
export function selectionFade(focus: number, dimOpacity: number, pop: number): number {
  if (focus <= 0) return 1
  return 1 - (1 - clamp(dimOpacity, 0, 1)) * focus * (1 - pop)
}

/** The point at radius `r`, angle `a` on a ring about the origin in centred y-up space. Angles run clockwise from 12 o'clock. */
export function ringPoint(r: number, a: number): Vector2 {
  return { x: r * Math.sin(a), y: r * Math.cos(a) }
}

/** The summary set in the ring's hole. */
export interface CenterConfig {
  labelStyle: TextStyle
  captionStyle: TextStyle
}

/** How far everything outside the selection fades while any slice is selected; fainter than a gapless chart's, as a ring's slices touch. */
export const PIE_SPOTLIGHT_DIM = 0.15

const resolvedFills = new WeakMap<object, FillResolved[]>()

export function resolvedFill(fill: Fill): FillResolved[] {
  if (typeof fill !== "object" || fill === null) return fillOps.resolve(fill)
  let resolved = resolvedFills.get(fill)
  if (resolved === undefined) resolvedFills.set(fill, resolved = fillOps.resolve(fill))
  return resolved
}

/** Each slice's paint, resolved once per fill object. */
export function ringFills(slices: readonly PieSlice[]): FillResolved[][] {
  return slices.map((slice) => resolvedFill(slice.fill))
}

