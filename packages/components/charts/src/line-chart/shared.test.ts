import { describe, expect, it } from "vitest"

import {
  EMPTY_REGION_BOX,
  clipPolylineToBox,
  hasRegion,
  resolveRegionBox,
  resolveYScale,
  yExtent,
  type RegionBox,
  clipPolygonToBox,
  curvePoints,
  cutAt,
  stackExtent,
  stackSeries,
} from "./shared"
import { resolveXScale } from "./x-scale"

/**
 * The pure parts of the line chart: how tall its scale is, and where a spotlit
 * region falls on the plot and what part of a line is inside it.
 */

const SERIES = [
  { field: "a", label: "A" },
  { field: "b", label: "B" },
]

describe("yExtent", () => {
  it("is the lowest and highest value across every series' column", () => {
    const rows = [{ a: 3, b: 10 }, { a: -2, b: 4 }, { a: 7, b: 6 }]
    expect(yExtent(rows, SERIES)).toEqual([-2, 10])
  })

  it("reads only the columns the series name", () => {
    expect(yExtent([{ a: 1, b: 2, other: 999 }], SERIES)).toEqual([1, 2])
  })

  it("reads a missing or non-numeric cell as 0, which can pull the extent to zero", () => {
    expect(yExtent([{ a: 5, b: 8 }, { a: 6 }], SERIES)).toEqual([0, 8])
    expect(yExtent([{ a: 5, b: "9" }], SERIES)).toEqual([0, 5])
  })

  it("is [0, 1] for no rows, and for no series", () => {
    expect(yExtent([], SERIES)).toEqual([0, 1])
    expect(yExtent([{ a: 1 }], [])).toEqual([0, 1])
  })

  it("is a point for a single value", () => {
    expect(yExtent([{ a: 4 }], [SERIES[0]])).toEqual([4, 4])
  })
})

describe("resolveYScale", () => {
  const rows = (...values: number[]) => values.map((a) => ({ a }))
  const series = [SERIES[0]]

  it("is the explicit range, as it was given", () => {
    const range: [number, number] = [-5, 100]
    expect(resolveYScale(rows(1, 2), series, range, 4)).toBe(range)
  })

  it("keeps an explicit range that is reversed or empty", () => {
    expect(resolveYScale(rows(1, 2), series, [10, 0], 4)).toEqual([10, 0])
    expect(resolveYScale(rows(1, 2), series, [3, 3], 4)).toEqual([3, 3])
  })

  it("rounds the data's extent out to tidy bounds, a step of the size that many divisions make", () => {
    // 0..8 in four divisions is a step of 2.
    expect(resolveYScale(rows(0, 8), series, undefined, 4)).toEqual([0, 8])
    // 3..17 in four divisions wants 3.5, which rounds up to a step of 5.
    expect(resolveYScale(rows(3, 17), series, undefined, 4)).toEqual([0, 20])
    // 1..9 in four divisions is a step of 2: down to 0, up to 10.
    expect(resolveYScale(rows(1, 9), series, undefined, 4)).toEqual([0, 10])
  })

  it("brackets a negative extent on both sides", () => {
    expect(resolveYScale(rows(-7, 3), series, undefined, 4)).toEqual([-10, 5])
  })

  it("takes a coarser step, and so wider bounds, for fewer divisions", () => {
    // 0..70: seven divisions want a step of 10, four want 17.5 (so 20), two want 35 (so 50).
    expect(resolveYScale(rows(0, 70), series, undefined, 7)).toEqual([0, 70])
    expect(resolveYScale(rows(0, 70), series, undefined, 4)).toEqual([0, 80])
    expect(resolveYScale(rows(0, 70), series, undefined, 2)).toEqual([0, 100])
  })

  it("rounds the divisions and keeps at least one", () => {
    expect(resolveYScale(rows(0, 90), series, undefined, 0)).toEqual(resolveYScale(rows(0, 90), series, undefined, 1))
    expect(resolveYScale(rows(0, 90), series, undefined, 2.4)).toEqual(resolveYScale(rows(0, 90), series, undefined, 2))
    expect(resolveYScale(rows(0, 90), series, undefined, -3)).toEqual(resolveYScale(rows(0, 90), series, undefined, 1))
  })

  it("is [0, 1] for no data at all", () => {
    const [lo, hi] = resolveYScale([], series, undefined, 4)
    expect(lo).toBe(0)
    expect(hi).toBe(1)
  })

  it("spans every series, not only the first", () => {
    expect(resolveYScale([{ a: 1, b: 40 }], SERIES, undefined, 4)).toEqual([0, 40])
  })
})

describe("hasRegion", () => {
  const box = (over: Partial<RegionBox>): RegionBox => ({ ...EMPTY_REGION_BOX, left: -5, right: 5, bottom: -5, top: 5, ...over })

  it("is true for a box with width and height", () => {
    expect(hasRegion(box({}))).toBe(true)
  })

  it("is false for the empty box, and for a box missing either extent", () => {
    expect(hasRegion(EMPTY_REGION_BOX)).toBe(false)
    expect(hasRegion(box({ right: -5 }))).toBe(false)
    expect(hasRegion(box({ top: -5 }))).toBe(false)
    expect(hasRegion(box({ left: 6 }))).toBe(false)
  })
})

describe("resolveRegionBox", () => {
  // A 200 x 100 plot centred on the origin, over x in 0..100 and y in 0..10.
  const PLOT = { left: -100, right: 100, bottom: -50, top: 50 }
  const X: [number, number] = [0, 100]
  const Y: [number, number] = [0, 10]

  it("is the empty box for no region", () => {
    expect(resolveRegionBox(undefined, PLOT, X, Y)).toBe(EMPTY_REGION_BOX)
    expect(resolveRegionBox(null, PLOT, X, Y)).toBe(EMPTY_REGION_BOX)
    expect(resolveRegionBox({}, PLOT, X, Y)).toBe(EMPTY_REGION_BOX)
  })

  it("maps an x range to the plot's pixels and spans the full height with no rule", () => {
    const box = resolveRegionBox({ x: [25, 75] }, PLOT, X, Y)
    expect(box).toEqual({ left: -50, right: 50, bottom: -50, top: 50, xBounded: true, yBounded: false })
  })

  it("maps a y range to the plot's pixels and spans the full width with no rule", () => {
    const box = resolveRegionBox({ y: [2, 8] }, PLOT, X, Y)
    expect(box.left).toBe(-100)
    expect(box.right).toBe(100)
    expect(box.bottom).toBeCloseTo(-30)
    expect(box.top).toBeCloseTo(30)
    expect(box).toMatchObject({ xBounded: false, yBounded: true })
  })

  it("maps both ranges to a box", () => {
    const box = resolveRegionBox({ x: [0, 50], y: [5, 10] }, PLOT, X, Y)
    expect(box).toEqual({ left: -100, right: 0, bottom: 0, top: 50, xBounded: true, yBounded: true })
  })

  it("reads a reversed range as the forward one: a region is a span, not a direction", () => {
    expect(resolveRegionBox({ x: [75, 25] }, PLOT, X, Y)).toEqual(resolveRegionBox({ x: [25, 75] }, PLOT, X, Y))
    expect(resolveRegionBox({ y: [8, 2] }, PLOT, X, Y)).toEqual(resolveRegionBox({ y: [2, 8] }, PLOT, X, Y))
  })

  it("clamps a range that runs off the scale to the plot", () => {
    const box = resolveRegionBox({ x: [-50, 400], y: [-3, 99] }, PLOT, X, Y)
    expect(box).toEqual({ left: -100, right: 100, bottom: -50, top: 50, xBounded: true, yBounded: true })
  })

  it("clamps a range wholly off the scale to an edge, leaving an empty span", () => {
    const box = resolveRegionBox({ x: [300, 400] }, PLOT, X, Y)
    expect(box.left).toBe(100)
    expect(box.right).toBe(100)
    expect(hasRegion(box)).toBe(false)
  })

  it("leaves an axis alone whose scale has no width", () => {
    const box = resolveRegionBox({ x: [1, 2] }, PLOT, [5, 5], Y)
    expect(box).toMatchObject({ left: -100, right: 100, xBounded: false })
  })

  it("follows the plot's own position, not the origin", () => {
    const box = resolveRegionBox({ x: [0, 100] }, { left: 20, right: 120, bottom: 0, top: 10 }, X, Y)
    expect([box.left, box.right]).toEqual([20, 120])
  })
})

describe("clipPolylineToBox", () => {
  const BOX: RegionBox = { left: -5, right: 5, bottom: -5, top: 5, xBounded: true, yBounded: true }
  const pt = (x: number, y: number) => ({ x, y })

  it("is nothing without a region, or for fewer than two points", () => {
    expect(clipPolylineToBox([pt(0, 0), pt(1, 1)], EMPTY_REGION_BOX)).toEqual([])
    expect(clipPolylineToBox([pt(0, 0)], BOX)).toEqual([])
    expect(clipPolylineToBox([], BOX)).toEqual([])
  })

  it("keeps a polyline that is wholly inside, point for point", () => {
    expect(clipPolylineToBox([pt(-3, 0), pt(0, 2), pt(3, -1)], BOX)).toEqual([[pt(-3, 0), pt(0, 2), pt(3, -1)]])
  })

  it("cuts a segment that enters mid-way exactly on the boundary", () => {
    expect(clipPolylineToBox([pt(-10, 0), pt(0, 0)], BOX)).toEqual([[pt(-5, 0), pt(0, 0)]])
  })

  it("cuts a segment that crosses the whole box at both edges", () => {
    expect(clipPolylineToBox([pt(-10, 0), pt(10, 0)], BOX)).toEqual([[pt(-5, 0), pt(5, 0)]])
  })

  it("cuts a diagonal on the edge it leaves through", () => {
    const [[start, end]] = clipPolylineToBox([pt(0, 0), pt(20, 20)], BOX)
    expect(start).toEqual(pt(0, 0))
    expect(end.x).toBeCloseTo(5)
    expect(end.y).toBeCloseTo(5)
  })

  it("makes a new run when the line leaves the box and comes back", () => {
    const runs = clipPolylineToBox([pt(-3, 0), pt(10, 0), pt(10, 3), pt(3, 3)], BOX)
    expect(runs).toHaveLength(2)
    expect(runs[0][0]).toEqual(pt(-3, 0))
    expect(runs[0][runs[0].length - 1]).toEqual(pt(5, 0))
    expect(runs[1][0]).toEqual(pt(5, 3))
    expect(runs[1][runs[1].length - 1]).toEqual(pt(3, 3))
  })

  it("joins consecutive segments into one run, without repeating the shared point", () => {
    const [run] = clipPolylineToBox([pt(-10, 1), pt(-2, 1), pt(2, 2), pt(10, 2)], BOX)
    expect(run).toEqual([pt(-5, 1), pt(-2, 1), pt(2, 2), pt(5, 2)])
  })

  it("is nothing for a line wholly outside", () => {
    expect(clipPolylineToBox([pt(-20, 20), pt(20, 20)], BOX)).toEqual([])
    expect(clipPolylineToBox([pt(10, -2), pt(30, 2)], BOX)).toEqual([])
  })

  it("is nothing for a line that runs along an edge outside the box", () => {
    expect(clipPolylineToBox([pt(-3, 9), pt(3, 9)], BOX)).toEqual([])
  })

  it("keeps a line that runs along the boundary itself", () => {
    expect(clipPolylineToBox([pt(-3, 5), pt(3, 5)], BOX)).toEqual([[pt(-3, 5), pt(3, 5)]])
  })

  it("drops a run that is a single point: a corner grazed", () => {
    const runs = clipPolylineToBox([pt(0, 10), pt(10, 0)], BOX)
    for (const run of runs) expect(run.length).toBeGreaterThanOrEqual(2)
  })

  it("clips against a box that is not centred on the origin", () => {
    const off: RegionBox = { left: 10, right: 20, bottom: 0, top: 10, xBounded: true, yBounded: false }
    expect(clipPolylineToBox([pt(0, 5), pt(30, 5)], off)).toEqual([[pt(10, 5), pt(20, 5)]])
  })
})

const pt = (x: number, y: number) => ({ x, y })

describe("stackSeries", () => {
  const DATA = [
    { m: "Jan", a: 1, b: 3 },
    { m: "Feb", a: 2, b: 2 },
  ]
  const SERIES = [{ field: "a", label: "A" }, { field: "b", label: "B" }]
  const x = resolveXScale(DATA, "m")
  const ys = (stack: "none" | "stacked" | "percent", weights?: number[]) =>
    stackSeries(DATA, x, SERIES, stack, weights).map((s) => ({ top: s.points.map(([, y]) => y), base: s.base?.map(([, y]) => y) ?? null }))

  it("leaves every series at its own values apart, with no base", () => {
    expect(ys("none")).toEqual([{ top: [1, 2], base: null }, { top: [3, 2], base: null }])
  })

  it("sits each series on the running sum of those before it", () => {
    expect(ys("stacked")).toEqual([{ top: [1, 2], base: [0, 0] }, { top: [4, 4], base: [1, 2] }])
  })

  it("reads each row as shares of its total in a percent stack", () => {
    expect(ys("percent")).toEqual([{ top: [25, 50], base: [0, 0] }, { top: [100, 100], base: [25, 50] }])
  })

  it("scales a series' contribution by its weight, so one sinking out lowers the ones above it", () => {
    expect(ys("stacked", [0, 1])).toEqual([{ top: [0, 0], base: [0, 0] }, { top: [3, 2], base: [0, 0] }])
  })

  it("orders the points along x, whatever order the rows are in", () => {
    const data = [{ n: 2, a: 5 }, { n: 0, a: 1 }]
    const [series] = stackSeries(data, resolveXScale(data, "n"), [SERIES[0]], "none")
    expect(series.points).toEqual([[0, 1], [2, 5]])
  })

  it("measures the extent across tops and bases alike", () => {
    expect(stackExtent(stackSeries(DATA, x, SERIES, "stacked"))).toEqual([0, 4])
  })
})

describe("curvePoints", () => {
  const P = [pt(0, 0), pt(10, 10), pt(20, 0), pt(30, 0), pt(40, 20)]

  it("is the points themselves for a linear line", () => {
    expect(curvePoints(P, "linear")).toEqual(P)
  })

  it("passes through every point of a smooth line", () => {
    const curve = curvePoints(P, "smooth")
    for (const p of P) expect(curve.some((q) => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9)).toBe(true)
  })

  it("never overshoots the data between two points: each stretch stays within its ends", () => {
    const curve = curvePoints(P, "smooth")
    for (let i = 1; i < P.length; i++) {
      const [a, b] = [P[i - 1], P[i]]
      const stretch = curve.filter((q) => q.x >= a.x && q.x <= b.x)
      for (const q of stretch) {
        expect(q.y).toBeGreaterThanOrEqual(Math.min(a.y, b.y) - 1e-9)
        expect(q.y).toBeLessThanOrEqual(Math.max(a.y, b.y) + 1e-9)
      }
    }
  })

  it("keeps a smooth line flat across a run of equal values", () => {
    const curve = curvePoints(P, "smooth").filter((q) => q.x >= 20 && q.x <= 30)
    for (const q of curve) expect(q.y).toBeCloseTo(0)
  })

  it("steps level between points, changing half way", () => {
    expect(curvePoints([pt(0, 0), pt(10, 5)], "step")).toEqual([pt(0, 0), pt(5, 0), pt(5, 5), pt(10, 5)])
  })

  it("is a straight segment for two points, smooth or not", () => {
    expect(curvePoints([pt(0, 0), pt(10, 5)], "smooth")).toEqual([pt(0, 0), pt(10, 5)])
  })
})

describe("cutAt", () => {
  it("keeps the points left of x and ends on the crossing", () => {
    expect(cutAt([pt(0, 0), pt(10, 10), pt(20, 0)], 15)).toEqual([pt(0, 0), pt(10, 10), pt(15, 5)])
  })

  it("is nothing left of the first point, and everything past the last", () => {
    expect(cutAt([pt(0, 0), pt(10, 10)], -1)).toEqual([])
    expect(cutAt([pt(0, 0), pt(10, 10)], 99)).toEqual([pt(0, 0), pt(10, 10)])
  })
})

describe("clipPolygonToBox", () => {
  const BOX: RegionBox = { left: 0, right: 10, bottom: 0, top: 10, xBounded: true, yBounded: true }

  it("keeps the part of an outline inside the box", () => {
    const clipped = clipPolygonToBox([pt(-5, 5), pt(5, 5), pt(5, -5), pt(-5, -5)], BOX)
    const xs = clipped.map((p) => p.x)
    const ys = clipped.map((p) => p.y)
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 5, 0, 5])
  })

  it("is nothing for an outline wholly outside, or without a region", () => {
    expect(clipPolygonToBox([pt(20, 20), pt(30, 20), pt(30, 30)], BOX)).toEqual([])
    expect(clipPolygonToBox([pt(1, 1), pt(2, 1), pt(2, 2)], EMPTY_REGION_BOX)).toEqual([])
  })
})
