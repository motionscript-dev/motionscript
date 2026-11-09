import { describe, expect, it } from "vitest"
import type { Node2D } from "@motionscript/sdk"

import { attachAt, draw, layOut } from "../tests/harness"
import { PieRing, RingGeometry } from "./pie-ring"
import { PIE_SPOTLIGHT_DIM, resolvePieChartTheme, type PieSlice } from "./shared"

/**
 * The ring's geometry, with no renderer: the radius it fits to the box and the
 * labels' gutters, the hole, how far a selected slice reaches, and where a
 * leader label and its leader line go. Reads the derived numbers the node draws
 * from — all are functions of the box, the slices and the theme.
 */

const THEME = resolvePieChartTheme(undefined)
const SLICES: PieSlice[] = [
  { category: "A", value: 50, fill: "#ff0000" },
  { category: "B", value: 30, fill: "#00ff00" },
  { category: "C", value: 20, fill: "#0000ff" },
]
const BOX = { width: 600, height: 400 }

/** A ring with its derived geometry readable, as the drawing and the labels read it for the box the ring was laid out at. */
type Ring = Omit<PieRing, keyof Geometry> & Geometry & Node2D

interface Geometry {
  outerRadius: number
  holeRadius: number
  growFactor: number
  maxPop: number
  elbowRadius: number
  centerX: number
  labelGutters: { left: number; right: number }
  labelRowHeight: number
  placements(): { index: number; side: 1 | -1; leader: { x: number; y: number }[]; text: { x: number; y: number } }[]
  anchorRadius(index: number): number
  sliceOpacity(index: number): number
  centerFont: number
  insideFont: number
}

function ring(props: Record<string, unknown> = {}, box = BOX, mounted = true): Ring {
  const node = new PieRing({
    ...box,
    slices: SLICES,
    ring: THEME.ring,
    label: THEME.label,
    centerStyle: THEME.center,
    labelPlacement: "none",
    ...props,
  } as never)
  if (mounted) layOut(node, box)
  return withGeometry(node)
}

const GEOMETRY = new Set(Object.getOwnPropertyNames(RingGeometry.prototype).filter((key) => key !== "constructor"))

/** The node, with each geometry member answered afresh for its current entries and box. */
function withGeometry(node: PieRing): Ring {
  return new Proxy(node, {
    get(target, key) {
      const from = typeof key === "string" && GEOMETRY.has(key) ? new RingGeometry(target, target.layoutBounds) : target
      const value = Reflect.get(from, key, from)
      return typeof value === "function" ? value.bind(from) : value
    },
  }) as unknown as Ring
}

const withRing = (patch: Record<string, unknown>) => ({ ring: { ...THEME.ring, ...patch } })
const GLYPH = 26 * 0.62

describe("PieRing: the outer radius", () => {
  it("fits the box's smaller half, less the gutters and room for a selected slice to grow", () => {
    // 600 x 400, no leaders, a gutter of 2 a side: min(298, 196) divided by the default growth of 1.08.
    expect(ring().outerRadius).toBeCloseTo(196 / 1.08)
  })

  it("follows the box: a narrower one is bound by its width instead", () => {
    const narrow = ring({}, { width: 300, height: 400 })
    expect(narrow.outerRadius).toBeCloseTo(148 / 1.08)
  })

  it("is 0 for a box with no room", () => {
    expect(ring({}, { width: 4, height: 400 }).outerRadius).toBe(0)
    expect(ring({}, { width: 600, height: 4 }).outerRadius).toBe(0)
  })

  it("is the whole fitted radius when a selected slice does not grow", () => {
    expect(ring(withRing({ selectedGrow: 1 })).outerRadius).toBeCloseTo(196)
  })

  it("stays the same size whether or not anything is selected", () => {
    const node = ring()
    const before = node.outerRadius
    node.set({ pops: [1, 0, 0] } as never)
    expect(node.outerRadius).toBe(before)
  })
})

describe("PieRing: how far a selected slice reaches", () => {
  it("clamps selectedGrow into 1..1.6", () => {
    expect(ring(withRing({ selectedGrow: 0.5 })).growFactor).toBe(1)
    expect(ring(withRing({ selectedGrow: 1 })).growFactor).toBe(1)
    expect(ring(withRing({ selectedGrow: 1.25 })).growFactor).toBe(1.25)
    expect(ring(withRing({ selectedGrow: 1.6 })).growFactor).toBe(1.6)
    expect(ring(withRing({ selectedGrow: 3 })).growFactor).toBe(1.6)
    expect(ring(withRing({ selectedGrow: -2 })).growFactor).toBe(1)
  })

  it("reaches a share of the ring's own radius beyond its rim, so the emphasis scales with the chart", () => {
    const node = ring(withRing({ selectedGrow: 1.25 }))
    expect(node.maxPop).toBeCloseTo(node.outerRadius * 0.25)
    const big = ring(withRing({ selectedGrow: 1.25 }), { width: 1200, height: 800 })
    expect(big.maxPop / big.outerRadius).toBeCloseTo(node.maxPop / node.outerRadius)
  })

  it("does not reach at all when the growth is 1", () => {
    expect(ring(withRing({ selectedGrow: 1 })).maxPop).toBe(0)
  })

  it("moves a slice's rim out by its pop, and leaves a slice that is not popped at the ring", () => {
    const node = ring(withRing({ selectedGrow: 1.25 }))
    node.set({ pops: [1, 0.5, 0] } as never)
    expect(node.anchorRadius(0)).toBeCloseTo(node.outerRadius * 1.25)
    expect(node.anchorRadius(1)).toBeCloseTo(node.outerRadius * 1.125)
    expect(node.anchorRadius(2)).toBeCloseTo(node.outerRadius)
  })

  it("reads a pop outside 0..1 as the nearest end, and a missing one as 0", () => {
    const node = ring(withRing({ selectedGrow: 1.25 }))
    node.set({ pops: [5, -3] } as never)
    expect(node.anchorRadius(0)).toBeCloseTo(node.outerRadius * 1.25)
    expect(node.anchorRadius(1)).toBeCloseTo(node.outerRadius)
    expect(node.anchorRadius(2)).toBeCloseTo(node.outerRadius)
  })
})

describe("PieRing: the hole", () => {
  it("is a fraction of the outer radius below 1", () => {
    const node = ring()
    expect(node.holeRadius).toBeCloseTo(0.6 * node.outerRadius)
    expect(ring(withRing({ holeRadius: 0.3 })).holeRadius).toBeCloseTo(0.3 * ring().outerRadius)
  })

  it("is a radius in pixels from 1 up", () => {
    expect(ring(withRing({ holeRadius: 50 })).holeRadius).toBe(50)
    expect(ring(withRing({ holeRadius: 1 })).holeRadius).toBe(1)
  })

  it("never reaches the rim: at most 95% of the outer radius", () => {
    const node = ring(withRing({ holeRadius: 5000 }))
    expect(node.holeRadius).toBeCloseTo(0.95 * node.outerRadius)
  })

  it("is 0 for a solid pie, and for a negative radius", () => {
    expect(ring(withRing({ holeRadius: 0 })).holeRadius).toBe(0)
    expect(ring(withRing({ holeRadius: -4 })).holeRadius).toBe(0)
  })
})

describe("PieRing: the label gutters", () => {
  it("reserve a couple of pixels a side when nothing is on a leader", () => {
    expect(ring().labelGutters).toEqual({ left: 2, right: 2 })
    expect(ring({ labelPlacement: "inside", labelMode: "both" }).labelGutters).toEqual({ left: 2, right: 2 })
    expect(ring({ labelPlacement: "leader", labelMode: "none" }).labelGutters).toEqual({ left: 2, right: 2 })
  })

  it("reserve room for the leader, the stub, the inset, the widest label and the padding, on the sides that have a leader", () => {
    // Percentages are at most four glyphs ("100%"): 34 + 26 + 8 + 4 glyphs + 14.
    const { left, right } = ring({ labelPlacement: "leader", labelMode: "percent" }).labelGutters
    expect(left).toBeCloseTo(82 + 4 * GLYPH)
    expect(right).toBeCloseTo(82 + 4 * GLYPH)
  })

  it("widen with a long category name", () => {
    const named = ring({ labelPlacement: "leader", labelMode: "category", slices: [{ category: "A fairly long name", value: 1, fill: "red" }, { category: "B", value: 1, fill: "blue" }] })
    expect(named.labelGutters.right).toBeCloseTo(82 + "A fairly long name".length * GLYPH)
  })

  it("reserve a side only for slices that leader that way", () => {
    const one = ring({ labelPlacement: "leader", labelMode: "percent", slices: [{ category: "A", value: 1, fill: "red" }] })
    // A whole circle's bisector is 180 degrees: it leaders to the right.
    expect(one.labelGutters.left).toBe(2)
    expect(one.labelGutters.right).toBeCloseTo(82 + 4 * GLYPH)
  })

  it("slide the ring into the half the labels left over, so the group stays centred", () => {
    const balanced = ring({ labelPlacement: "leader", labelMode: "percent" })
    expect(balanced.centerX).toBeCloseTo(0)
    const lopsided = ring({ labelPlacement: "leader", labelMode: "percent", slices: [{ category: "A", value: 1, fill: "red" }] })
    expect(lopsided.centerX).toBeCloseTo((2 - (82 + 4 * GLYPH)) / 2)
    expect(lopsided.centerX).toBeLessThan(0)
  })

  it("shrink the ring: the same box draws a smaller ring with leaders than with labels inside", () => {
    const leaders = ring({ labelPlacement: "leader", labelMode: "percent" }).outerRadius
    const inside = ring({ labelPlacement: "inside", labelMode: "percent" }).outerRadius
    expect(leaders).toBeLessThan(inside)
  })

  it("make the label rows cost height too: a leader row is a line of the percent style", () => {
    expect(ring({ labelPlacement: "leader", labelMode: "percent" }).labelRowHeight).toBeCloseTo(26 * 1.25)
    expect(ring({ labelPlacement: "leader", labelMode: "category" }).labelRowHeight).toBeCloseTo(26 * 1.25)
    expect(ring({ labelPlacement: "leader", labelMode: "both" }).labelRowHeight).toBeCloseTo(26 * 1.25 * 2 + 2)
    expect(ring({ labelPlacement: "inside", labelMode: "both" }).labelRowHeight).toBe(0)
  })
})

describe("PieRing: where a leader label goes", () => {
  const leadered = () => ring({ labelPlacement: "leader", labelMode: "percent" })

  it("has a placement for each drawn slice and none when nothing is leadered", () => {
    expect(leadered().placements().map((p) => p.index).sort()).toEqual([0, 1, 2])
    expect(ring().placements()).toEqual([])
    expect(ring({ labelPlacement: "inside", labelMode: "percent" }).placements()).toEqual([])
    expect(ring({ labelPlacement: "leader", labelMode: "none" }).placements()).toEqual([])
  })

  it("has none for no slices, or a ring with no radius", () => {
    expect(ring({ labelPlacement: "leader", labelMode: "percent", slices: [] }).placements()).toEqual([])
    expect(ring({ labelPlacement: "leader", labelMode: "percent" }, { width: 4, height: 4 }).placements()).toEqual([])
  })

  it("skips a slice with nothing to draw", () => {
    const node = ring({ labelPlacement: "leader", labelMode: "percent", slices: [SLICES[0], { category: "Z", value: 0, fill: "red" }, SLICES[1]] })
    expect(node.placements().map((p) => p.index).sort()).toEqual([0, 2])
  })

  it("puts a slice on the side its bisector points to: clockwise from 12, the first half right", () => {
    const sides = Object.fromEntries(leadered().placements().map((p) => [p.index, p.side]))
    // A is 0 to 180 degrees (right); B and C are 180 to 360 (left).
    expect(sides).toEqual({ 0: 1, 1: -1, 2: -1 })
  })

  it("runs a leader from the wedge, lifted off its rim, through an elbow to a horizontal run into the label", () => {
    const node = leadered()
    for (const placement of node.placements()) {
      const [start, elbow, end] = placement.leader
      expect(Math.hypot(start.x - node.centerX, start.y)).toBeCloseTo(node.outerRadius + 6)
      expect(end.y).toBeCloseTo(elbow.y)
      expect(placement.text.y).toBeCloseTo(end.y)
      // The run is outward: the label is further out than the elbow, on the placement's side.
      expect(Math.sign(end.x - elbow.x)).toBe(placement.side)
    }
  })

  it("pins the label's inner edge a few pixels past the end of its leader", () => {
    const node = leadered()
    for (const placement of node.placements()) {
      const end = placement.leader[2]
      expect(placement.text.x - end.x).toBeCloseTo(placement.side * 8)
      expect(Math.abs(end.x - node.centerX)).toBeCloseTo(node.elbowRadius + 26)
    }
  })

  it("keeps the elbow on the circle outside the ring, however the label was nudged", () => {
    const node = leadered()
    const radius = node.elbowRadius
    for (const placement of node.placements()) {
      const elbow = placement.leader[1]
      expect(Math.hypot(elbow.x - node.centerX, elbow.y)).toBeGreaterThanOrEqual(radius * 0.18)
      expect(Math.hypot(elbow.x - node.centerX, elbow.y)).toBeCloseTo(radius, 5)
    }
  })

  it("starts a leader further out for a slice that is popped", () => {
    const node = leadered()
    const before = node.placements().find((p) => p.index === 0)!.leader[0]
    node.set({ pops: [1, 0, 0] } as never)
    const after = node.placements().find((p) => p.index === 0)!.leader[0]
    expect(Math.hypot(after.x - node.centerX, after.y)).toBeGreaterThan(Math.hypot(before.x - node.centerX, before.y))
  })

  it("spreads labels that would crowd, so no two in a column are closer than a row", () => {
    const crowded: PieSlice[] = [
      { category: "Big", value: 80, fill: "red" },
      { category: "a", value: 5, fill: "green" },
      { category: "b", value: 5, fill: "blue" },
      { category: "c", value: 5, fill: "orange" },
      { category: "d", value: 5, fill: "purple" },
    ]
    const node = ring({ labelPlacement: "leader", labelMode: "percent", slices: crowded })
    const left = node.placements().filter((p) => p.side === -1).map((p) => p.text.y).sort((a, b) => b - a)
    expect(left.length).toBeGreaterThan(1)
    const row = node.labelRowHeight + 12
    for (let i = 1; i < left.length; i++) expect(left[i - 1] - left[i]).toBeGreaterThanOrEqual(row - 1e-6)
  })

  it("keeps every label inside the box's height", () => {
    const many: PieSlice[] = Array.from({ length: 12 }, (_, i) => ({ category: `s${i}`, value: 1, fill: "red" }))
    const node = ring({ labelPlacement: "leader", labelMode: "percent", slices: many })
    for (const placement of node.placements()) expect(Math.abs(placement.text.y)).toBeLessThanOrEqual(200)
  })
})

describe("PieRing: drawing", () => {
  const wedges = (ctx: ReturnType<typeof draw>) => ctx.ops().filter((ops) => ops[0].kind === "path")

  it("draws a wedge for each slice, and nothing for a zero-valued one", () => {
    expect(wedges(draw(ring(), BOX))).toHaveLength(3)
    const zero = ring({ slices: [SLICES[0], { category: "Z", value: 0, fill: "red" }, SLICES[1]] })
    expect(wedges(draw(zero, BOX))).toHaveLength(2)
  })

  it("sweeps the wedges in clockwise as the growth rises, clipping the one it is part way through", () => {
    // 50%, 30%, 20%: growth 0.4 ends inside the first, 0.6 inside the second, 0.9 inside the third.
    const count = (growth: number) => wedges(draw(ring({ growth }), BOX)).length
    expect([count(0), count(0.4), count(0.6), count(0.9), count(1)]).toEqual([0, 1, 2, 3, 3])
  })

  it("clamps the growth into 0..1", () => {
    expect(wedges(draw(ring({ growth: -1 }), BOX))).toHaveLength(0)
    expect(wedges(draw(ring({ growth: 4 }), BOX))).toHaveLength(3)
  })

  it("draws nothing for a ring with no radius, and nothing for no slices", () => {
    expect(draw(ring(), { width: 4, height: 4 }).drawn).toEqual([])
    expect(draw(ring({ slices: [] }), BOX).drawn).toEqual([])
  })

  it("draws a leader line for each leadered slice once the labels are revealed", () => {
    const leaders = (labelReveal: number) =>
      draw(ring({ labelPlacement: "leader", labelMode: "percent", labelReveal }), BOX)
        .ops()
        .filter((ops) => ops[0].kind === "line")
    expect(leaders(1)).toHaveLength(3)
    expect(leaders(0)).toHaveLength(0)
    expect(leaders(0.001)).toHaveLength(0)
    expect(leaders(0.5)).toHaveLength(3)
  })

  it("dims every slice but a selected one, in proportion to the selection", () => {
    const node = ring({ pops: [1, 0, 0] })
    expect(node.sliceOpacity(0)).toBe(1)
    expect(node.sliceOpacity(1)).toBeCloseTo(PIE_SPOTLIGHT_DIM)
    node.set({ pops: [0.5, 0, 0] } as never)
    // The rest fade half way; the selected slice, half out, is a quarter short of full.
    expect(node.sliceOpacity(1)).toBeCloseTo(1 - (1 - PIE_SPOTLIGHT_DIM) * 0.5)
    expect(node.sliceOpacity(0)).toBeCloseTo(1 - (1 - PIE_SPOTLIGHT_DIM) * 0.5 * 0.5)
  })

  it("dims nothing while nothing is selected", () => {
    const node = ring()
    expect([node.sliceOpacity(0), node.sliceOpacity(1), node.sliceOpacity(2)]).toEqual([1, 1, 1])
  })

  it("dims to the opacity the theme says", () => {
    const node = ring({ pops: [1, 0, 0], dimOpacity: 0.6 })
    expect(node.sliceOpacity(2)).toBeCloseTo(0.6)
  })
})

describe("PieRing: the hole's summary", () => {
  it("builds its text only when there is a label or a caption", () => {
    expect(ring().children).toHaveLength(0)
    expect(ring({ centerLabel: "Total" }).children).toHaveLength(1)
    expect(ring({ centerCaption: "this year" }).children).toHaveLength(1)
  })

  it("holds a label and a caption as two lines of one block", () => {
    const node = ring({ centerLabel: "42", centerCaption: "units" })
    expect(node.children).toHaveLength(1)
    expect(node.children[0].children).toHaveLength(2)
  })

  it("sets the label at the theme's size when it fits the hole", () => {
    expect(ring({ centerLabel: "42" }).centerFont).toBe(46)
  })

  it("shrinks the summary to fit across the hole", () => {
    const node = ring({ centerLabel: "A very long conclusion indeed", centerCaption: "and a longer caption than that one" })
    expect(node.centerFont).toBeLessThan(46)
    // Fits: the widest line is no wider than 78% of the hole's diameter.
    const glyphs = Math.max("A very long conclusion indeed".length, "and a longer caption than that one".length * (22 / 46))
    expect(node.centerFont * glyphs * 0.62).toBeLessThanOrEqual(node.holeRadius * 2 * 0.78 + 1e-6)
  })

  it("keeps the wanted size when there is no hole to fit in", () => {
    expect(ring({ centerLabel: "A very long conclusion indeed", ...withRing({ holeRadius: 0 }) }).centerFont).toBe(46)
  })

  it("fades with centerReveal, and starts shown", () => {
    const node = ring({ centerLabel: "42" })
    expect(node.centerReveal).toBe(1)
    expect(node.children[0].opacity).toBe(1)
    node.set({ centerReveal: 0.25 } as never)
    expect(node.children[0].opacity).toBe(0.25)
    node.set({ centerReveal: 3 } as never)
    expect(node.children[0].opacity).toBe(1)
  })

  it("slides with the ring when a one-sided label column moves it", () => {
    const node = ring({
      centerLabel: "42",
      labelPlacement: "leader",
      labelMode: "percent",
      slices: [{ category: "A", value: 1, fill: "red" }],
    })
    layOut(node, BOX)
    expect(node.centerX).toBeLessThan(0)
  })
})

describe("PieRing: the commands", () => {
  const mounted = () => attachAt(ring({}, BOX, false) as never) as unknown as PieRing
  const linear = (t: number) => t

  it("sweeps the growth up from nothing", () => {
    const node = mounted()
    const sweep = node.sweep({ duration: 1, easing: linear })
    for (const t of [0, 0.5, 1]) {
      sweep.at(t)
      expect(node.growth).toBe(t)
    }
    expect(sweep.duration).toBe(1)
  })

  it("fades the labels up from nothing", () => {
    const node = mounted()
    const labels = node.revealLabels({ duration: 2, easing: linear })
    labels.at(0.25)
    expect(node.labelReveal).toBe(0.25)
    expect(labels.duration).toBe(2)
  })

  // A component command has no duration of its own: the class's 0.6 s default is
  // the chart's to pass now, and `PieChart.revealCenter` does.
  it("reveals the hole's summary from where it is", () => {
    const node = mounted()
    node.set({ centerReveal: 0.5 } as never)
    const reveal = node.revealCenter({ duration: 0.6, easing: linear })
    expect(reveal.duration).toBe(0.6)
    reveal.at(0)
    expect(node.centerReveal).toBe(0.5)
    reveal.at(0.5)
    expect(node.centerReveal).toBe(0.75)
    reveal.at(1)
    expect(node.centerReveal).toBe(1)
  })

  it("reveals from nothing for a summary held back", () => {
    const node = mounted()
    node.set({ centerReveal: 0 } as never)
    node.revealCenter({ duration: 1, easing: linear }).at(0.5)
    expect(node.centerReveal).toBe(0.5)
  })
})
