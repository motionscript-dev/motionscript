import { Types, type DataRecord, type Vector2, type TextStyle as _TextStyle } from "@motionscript/sdk"

import { niceRange, num, type ChartSeries, type Range } from "../kit/shared"
import { VALUE_TEXT } from "../kit/style"
import type { XScale } from "./x-scale"

/** One polyline of a {@link LineChart}: {@link ChartSeries} under the name for what it draws here. */
export type LineSeries = ChartSeries

/**
 * A rectangular slice of the plot in data units, the input to `spotlightRegion`
 * and `zoomTo`. Either axis may be omitted: `{ x: [60, 100] }` is a full-height
 * band. A reversed range reads the same as a forward one.
 */
export interface PlotRegion {
  /** Omit to span the full plot width. */
  x?: Range
  /** Omit to span the full plot height. */
  y?: Range
}

/**
 * A {@link PlotRegion} in the plot's centred pixel space (origin at the centre,
 * y-up), the frame the series points live in. An axis the author left unbounded
 * has its edges pinned to the plot's own and draws no rule.
 */
export interface RegionBox {
  left: number
  right: number
  bottom: number
  top: number
  xBounded: boolean
  yBounded: boolean
}

/** The "no region" resting value. */
export const EMPTY_REGION_BOX: RegionBox = {
  left: 0,
  right: 0,
  bottom: 0,
  top: 0,
  xBounded: false,
  yBounded: false,
}

/** Whether `box` is non-degenerate, so there is something to spotlight. */
export function hasRegion(box: RegionBox): boolean {
  return box.right > box.left && box.top > box.bottom
}

/**
 * Resolve a {@link PlotRegion} against the plot rectangle (centred pixel space)
 * and the data ranges its edges span. An omitted axis takes the plot's own
 * edges; a given one is clamped to the plot.
 */
export function resolveRegionBox(
  region: PlotRegion | null | undefined,
  plot: { left: number; right: number; bottom: number; top: number },
  xScale: Range,
  yScale: Range
): RegionBox {
  if (!region || (region.x === undefined && region.y === undefined)) {
    return EMPTY_REGION_BOX
  }

  const span = (
    range: Range | undefined,
    [min, max]: Range,
    lo: number,
    hi: number
  ): [number, number, boolean] => {
    if (range === undefined || max <= min) return [lo, hi, false]
    const a = Math.min(range[0], range[1])
    const b = Math.max(range[0], range[1])
    const toPx = (v: number) => lo + ((v - min) / (max - min)) * (hi - lo)
    return [
      Math.max(lo, Math.min(hi, toPx(a))),
      Math.max(lo, Math.min(hi, toPx(b))),
      true,
    ]
  }

  const [left, right, xBounded] = span(region.x, xScale, plot.left, plot.right)
  const [bottom, top, yBounded] = span(region.y, yScale, plot.bottom, plot.top)
  return { left, right, bottom, top, xBounded, yBounded }
}

/**
 * The parts of `points` inside `box`, as contiguous sub-polylines: a series is
 * drawn dimmed in full, then these runs are re-drawn at full strength. Segments
 * are clipped, not filtered by endpoint, so a line entering mid-segment is cut
 * exactly on the boundary.
 */
export function clipPolylineToBox(
  points: Vector2[],
  box: RegionBox
): Vector2[][] {
  if (points.length < 2 || !hasRegion(box)) return []

  const runs: Vector2[][] = []
  let run: Vector2[] = []

  for (let i = 1; i < points.length; i++) {
    const seg = clipSegment(points[i - 1], points[i], box)
    if (!seg) {
      // Misses the box: close the open run.
      if (run.length >= 2) runs.push(run)
      run = []
      continue
    }
    const [a, b] = seg
    // Continues the open run if it starts where the last ended; otherwise the line left and came back.
    if (run.length > 0 && samePoint(run[run.length - 1], a)) run.push(b)
    else {
      if (run.length >= 2) runs.push(run)
      run = [a, b]
    }
  }
  if (run.length >= 2) runs.push(run)
  return runs
}

/** Points within half a pixel are the same point, for run-joining purposes. */
function samePoint(a: Vector2, b: Vector2): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
}

/** Liang-Barsky clip of one segment against `box`: the surviving `[start, end]`, or `null` when wholly outside. */
function clipSegment(
  a: Vector2,
  b: Vector2,
  box: RegionBox
): [Vector2, Vector2] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1

  // Each edge as (p, q): the segment survives where p*t <= q.
  const edges: [number, number][] = [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.bottom],
    [dy, box.top - a.y],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this edge: outside it, the whole segment is out.
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ]
}

/**
 * One series' `[x, y]` points, sorted along x so the polyline traces left to
 * right. A row missing its y contributes 0 rather than a gap, since dropping it
 * would silently bridge the hole.
 */
export function seriesPoints(
  data: DataRecord[],
  x: XScale,
  series: LineSeries
): [x: number, y: number][] {
  return data
    .map((row, i): [number, number] => [x.at(i), num(row, series.field)])
    .sort((a, b) => a[0] - b[0])
}

export function yExtent(data: DataRecord[], series: LineSeries[]): Range {
  let lo = Infinity
  let hi = -Infinity
  for (const row of data)
    for (const s of series) {
      const v = num(row, s.field)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  return lo <= hi ? [lo, hi] : [0, 1]
}

/**
 * The explicit `range`, else the data's y extent nudged out to tidy step bounds.
 * `divisions` (one fewer than the marker count) only shapes the step when
 * `range` is omitted.
 */
export function resolveYScale(
  data: DataRecord[],
  series: LineSeries[],
  range: Range | undefined,
  divisions: number
): Range {
  return range ?? niceRange(yExtent(data, series), divisions)
}

/** How the series sit on one another: apart, each on the sum of those before it, or as shares of the row's total. */
export type LineStack = "none" | "stacked" | "percent"

/** One series as drawn: its `[x, y]` points along x, and the line its area fills down to (`null`: the baseline). */
export interface StackedSeries {
  readonly points: [x: number, y: number][]
  readonly base: [x: number, y: number][] | null
}

/**
 * Every series' points under `stack`, rows in x order. A series contributes its
 * values times its weight (`1` when missing), so a series sinking out of a stack
 * lowers the ones above it. `percent` reads each row as shares of its total
 * magnitude, so the top of a full stack is 100.
 */
export function stackSeries(
  data: DataRecord[],
  x: XScale,
  series: readonly LineSeries[],
  stack: LineStack,
  weights: readonly number[] = []
): StackedSeries[] {
  const order = data.map((_, i) => i).sort((a, b) => x.at(a) - x.at(b))
  if (stack !== "stacked" && stack !== "percent") {
    return series.map((s) => ({ points: order.map((r): [number, number] => [x.at(r), num(data[r], s.field)]), base: null }))
  }
  const weight = (i: number) => Math.max(0, weights[i] ?? 1)
  const totals = order.map((r) => series.reduce((sum, s, i) => sum + Math.abs(num(data[r], s.field) * weight(i)), 0))
  const running = order.map(() => 0)
  return series.map((s, i) => {
    const base = order.map((r, k): [number, number] => [x.at(r), running[k]])
    const points = order.map((r, k): [number, number] => {
      const value = num(data[r], s.field) * weight(i)
      running[k] += stack === "percent" ? (totals[k] > 0 ? (value / totals[k]) * 100 : 0) : value
      return [x.at(r), running[k]]
    })
    return { points, base }
  })
}

/** The lowest and highest y anything in `stacks` reaches, its bases included. */
export function stackExtent(stacks: readonly StackedSeries[]): Range {
  let lo = Infinity
  let hi = -Infinity
  for (const { points, base } of stacks)
    for (const [, y] of [...points, ...(base ?? [])]) {
      if (y < lo) lo = y
      if (y > hi) hi = y
    }
  return lo <= hi ? [lo, hi] : [0, 1]
}

/** How a series' line runs between its points. */
export type LineCurve = "smooth" | "linear" | "step"

/** Points along a cubic Bezier segment, its start left out. */
const SAMPLES = 16

/**
 * The drawn path through `points` (ordered along x) as a polyline: the points
 * themselves for `linear`; for `step`, level runs that change at the midpoint
 * between neighbours; for `smooth`, a monotone cubic (Fritsch-Carlson, as d3's
 * `curveMonotoneX`), which never overshoots the data between two points.
 */
export function curvePoints(points: readonly Vector2[], curve: LineCurve): Vector2[] {
  if (curve === "step") {
    const out: Vector2[] = points.length > 0 ? [points[0]] : []
    for (let i = 1; i < points.length; i++) {
      const mid = (points[i - 1].x + points[i].x) / 2
      out.push({ x: mid, y: points[i - 1].y }, { x: mid, y: points[i].y }, points[i])
    }
    return out
  }
  if (curve !== "smooth" || points.length < 3) return [...points]
  const tangents = monotoneTangents(points)
  const out: Vector2[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dx = (b.x - a.x) / 3
    const c1 = { x: a.x + dx, y: a.y + dx * tangents[i - 1] }
    const c2 = { x: b.x - dx, y: b.y - dx * tangents[i] }
    for (let k = 1; k <= SAMPLES; k++) {
      const t = k / SAMPLES
      const u = 1 - t
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
      })
    }
  }
  return out
}

function monotoneTangents(points: readonly Vector2[]): number[] {
  const n = points.length
  const slope = (i: number) => {
    const h = points[i + 1].x - points[i].x
    return h === 0 ? 0 : (points[i + 1].y - points[i].y) / h
  }
  const m = new Array<number>(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    const h0 = points[i].x - points[i - 1].x
    const h1 = points[i + 1].x - points[i].x
    const s0 = slope(i - 1)
    const s1 = slope(i)
    const p = h0 + h1 === 0 ? 0 : (s0 * h1 + s1 * h0) / (h0 + h1)
    m[i] = (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  }
  m[0] = endTangent(slope(0), m[1])
  m[n - 1] = endTangent(slope(n - 2), m[n - 2])
  return m
}

/** d3's one-sided end tangent, held to the end segment's own direction and to three times its slope, past which it would overshoot. */
function endTangent(secant: number, inner: number): number {
  const t = (3 * secant - inner) / 2
  if (secant === 0 || Math.sign(t) !== Math.sign(secant)) return 0
  return Math.abs(t) > 3 * Math.abs(secant) ? 3 * secant : t
}

/** The part of `points` (ordered along x) left of `x`, ending on the point where it crosses `x`. */
export function cutAt(points: readonly Vector2[], x: number): Vector2[] {
  if (points.length === 0 || x < points[0].x) return []
  const out: Vector2[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.x <= x) {
      out.push(p)
      continue
    }
    const a = points[i - 1]
    if (a && p.x > a.x) out.push({ x, y: a.y + ((p.y - a.y) * (x - a.x)) / (p.x - a.x) })
    break
  }
  return out
}

/**
 * `polygon` clipped to `box` (Sutherland-Hodgman against each edge in turn).
 * The box is convex, so the result is the part inside, possibly with seams of
 * no width where a concave outline leaves and re-enters, which fill as nothing.
 */
export function clipPolygonToBox(polygon: readonly Vector2[], box: RegionBox): Vector2[] {
  if (polygon.length < 3 || !hasRegion(box)) return []
  const edges: ((p: Vector2) => number)[] = [
    (p) => p.x - box.left,
    (p) => box.right - p.x,
    (p) => p.y - box.bottom,
    (p) => box.top - p.y,
  ]
  let out: Vector2[] = [...polygon]
  for (const inside of edges) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      const dc = inside(cur)
      const dp = inside(prev)
      if (dc >= 0) {
        if (dp < 0) out.push(crossing(prev, cur, dp, dc))
        out.push(cur)
      } else if (dp >= 0) out.push(crossing(prev, cur, dp, dc))
    }
    if (out.length === 0) return []
  }
  return out
}

function crossing(a: Vector2, b: Vector2, da: number, db: number): Vector2 {
  const t = da / (da - db)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** A line chart's own look: how each series is stroked, dotted and filled. */
export const LINE_MARKS = {
  strokeWidth: Types.number(4, { min: 0, max: 24, step: 0.5, unit: "px" }),
  curve: Types.oneOf(["smooth", "linear", "step"] as const),
  dots: Types.boolean(false),
  /** Each dot's diameter. */
  dotSize: Types.number(12, { min: 0, max: 48, step: 1, unit: "px" }),
  /** Fill under each line: none, the series colour, or the colour fading to nothing at the baseline. */
  area: Types.oneOf(["none", "solid", "gradient"] as const),
  /** The fill's opacity at the line. */
  areaOpacity: Types.number(0.4, { min: 0, max: 1, step: 0.05 }),
}

export const LINE_LABELS = {
  /** Read as the chart is built: each point's value printed above or below it, or none. */
  values: Types.oneOf(["none", "above", "below"] as const, { animatable: false }),
  ...VALUE_TEXT,
}
