import { describe, expect, it } from "vitest"
import type { Command, Text } from "@motionscript/sdk"

import { Recorder, attachAt, draw, layOut, scrub } from "../tests/harness"
import { partOf, partsOf as partsIn, plotOf } from "../kit/tests/parts"
import { ChartCanvas } from "../kit/chart-canvas"
import { ChartLegend } from "../kit/chart-legend"
import { SPOTLIGHT_DIM } from "../kit/shared"
import { HorizontalAxis } from "../kit/horizontal-axis"
import { VerticalAxis } from "../kit/vertical-axis"
import { BarChart, barChartDomain } from "./bar-chart"
import { CategoryAxis } from "./category-axis"
import { ChartBars } from "./chart-bars"

/**
 * The bar chart's own behaviour: how a series' weight reflows the group, and
 * how a category is spotlit. A column is a function of the chart's weights and
 * its rows, so the geometry is read straight off the parts at a time.
 */

const BOX = { width: 760, height: 460 }
const linear = (t: number) => t
const ROWS = [
  { m: "Jan", a: 10, b: 20 },
  { m: "Feb", a: 30, b: 10 },
  { m: "Mar", a: 20, b: 20 },
]
const SERIES = [
  { field: "a", label: "A" },
  { field: "b", label: "B" },
]

function chart(props: Record<string, unknown> = {}): BarChart {
  const node = attachAt(
    new BarChart({ ...BOX, data: ROWS, categoryField: "m", series: SERIES, ...props } as never)
  )
  layOut(node, BOX)
  return node
}

/** The chart's parts, read off the frame it built. */
function partsOf(node: BarChart) {
  return {
    plot: plotOf(node),
    bars: partsIn(node, ChartBars),
    cAxis: partOf(node, CategoryAxis)!,
    legend: partOf(node, ChartLegend) ?? null,
  }
}

const relay = (node: BarChart) => layOut(node, BOX)
const bars = (node: BarChart, index: number) => partsOf(node).bars[index].bars
const enabled = (node: BarChart) => partsOf(node).bars.map((set) => set.enabled)
const legendReveal = (node: BarChart) => partsOf(node).legend!.reveal
const categoryDims = (node: BarChart) => partsOf(node).cAxis.dims
const panel = (node: BarChart) => partsOf(node).plot.layoutBounds
const slotWidth = (node: BarChart) => panel(node).width / node.data.length
const slotInner = (node: BarChart) => slotWidth(node) * node.style.barWidth
const slotCenter = (node: BarChart, index: number) => -panel(node).width / 2 + slotWidth(node) * (index + 0.5)
const valueToY = (node: BarChart, value: number) => {
  const [min, max] = barChartDomain(node).range
  return ((value - min) / (max - min) - 0.5) * panel(node).height
}
const expectDims = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, i) => expect(actual[i], `dims[${i}]`).toBeCloseTo(value, 10))
}

/** The category spotlight as `command` draws it at `t`. */
function spotlitAt(node: BarChart, command: Command, t: number) {
  command.at(t)
  return { spotlight: node.spotlight, spotlightReveal: node.spotlightReveal }
}

describe("BarChart: weights", () => {
  it("seeds a weight of 1 for each series that shows and 0 for one that says enabled: false", () => {
    expect(chart().weights).toEqual([1, 1])
    expect(chart({ series: [SERIES[0], { ...SERIES[1], enabled: false }] }).weights).toEqual([1, 0])
  })

  it("seeds a series that is hidden with its columns switched off", () => {
    expect(enabled(chart({ series: [SERIES[0], { ...SERIES[1], enabled: false }] }))).toEqual([true, false])
  })

  it("keeps the weights a command writes", () => {
    const node = chart()
    node.set({ weights: [1, 0.5] } as never)
    expect(node.weights).toEqual([1, 0.5])
  })

  it("divides a slot's inner width between the series in proportion to their weights", () => {
    const node = chart()
    const inner = slotInner(node)
    const [a, b] = [bars(node, 0)[0], bars(node, 1)[0]]
    // Two even series share the slot, less the group gap of 6 each.
    expect(a.thickness).toBeCloseTo(inner / 2 - 6)
    expect(b.thickness).toBeCloseTo(inner / 2 - 6)
    node.set({ weights: [1, 3] } as never)
    expect(bars(node, 0)[0].thickness).toBeCloseTo(inner / 4 - 6)
    expect(bars(node, 1)[0].thickness).toBeCloseTo((inner * 3) / 4 - 6)
  })

  it("gives a single series the whole slot, with no gap taken off", () => {
    const node = chart({ series: [SERIES[0]] })
    expect(bars(node, 0)[0].thickness).toBeCloseTo(slotInner(node))
  })

  it("reads a missing or negative weight as the full share or none", () => {
    const node = chart()
    node.set({ weights: [] } as never)
    expect(bars(node, 0)[0].thickness).toBeCloseTo(slotInner(node) / 2 - 6)
    node.set({ weights: [-2, 1] } as never)
    expect(bars(node, 0)[0].thickness).toBe(0)
    // The negative one counts as nothing, so the other has the slot to itself.
    expect(bars(node, 1)[0].thickness).toBeCloseTo(slotInner(node) - 6)
    expect(bars(node, 1)[0].center).toBeCloseTo(slotCenter(node, 0))
  })

  it("shares the slot as if the total were 1 when every weight is 0, rather than dividing by nothing", () => {
    const node = chart()
    node.set({ weights: [0, 0] } as never)
    for (const column of [...bars(node, 0), ...bars(node, 1)]) expect(Number.isFinite(column.thickness) && Number.isFinite(column.center)).toBe(true)
  })
})

describe("BarChart.hideSeries: the group reflows", () => {
  it("narrows the series away while the other widens into the space", () => {
    const node = chart()
    const seek = scrub(node.hideSeries({ data: { seriesIndex: 0 }, duration: 1, easing: linear }))
    const inner = slotInner(node)
    seek(0.5)
    relay(node)
    // Weights [0.5, 1]: a share of the slot is a third for the first, two thirds for the second.
    expect(node.weights).toEqual([0.5, 1])
    expect(bars(node, 0)[0].thickness).toBeCloseTo((inner / 1.5) * 0.5 - 6)
    expect(bars(node, 1)[0].thickness).toBeCloseTo(inner / 1.5 - 6)
    seek(1)
    relay(node)
    expect(bars(node, 0)[0].thickness).toBe(0)
    expect(bars(node, 1)[0].thickness).toBeCloseTo(inner - 6)
  })

  it("slides the remaining column in to the slot's centre, where a lone column sits", () => {
    const node = chart()
    const before = bars(node, 1)[0].center
    const seek = scrub(node.hideSeries({ data: { seriesIndex: 0 }, duration: 1, easing: linear }))
    seek(1)
    expect(bars(node, 1)[0].center).toBeLessThan(before)
    // Alone, it is centred on the slot.
    expect(bars(node, 1)[0].center).toBeCloseTo(slotCenter(node, 0))
  })

  it("holds the columns switched on until the last frame, so they are there to narrow", () => {
    const node = chart()
    const seek = scrub(node.hideSeries({ data: { seriesIndex: 0 }, duration: 1, easing: linear }))
    for (const t of [0, 0.5, 0.99]) {
      seek(t)
      expect(enabled(node)[0], `t = ${t}`).toBe(true)
    }
    seek(1)
    expect(enabled(node)[0]).toBe(false)
  })

  it("brings them back on a seek below the end", () => {
    const node = chart()
    const seek = scrub(node.hideSeries({ data: { seriesIndex: 0 }, duration: 1, easing: linear }))
    seek(1)
    seek(0.5)
    expect(enabled(node)[0]).toBe(true)
    expect(node.weights).toEqual([0.5, 1])
    seek(0)
    expect(node.weights).toEqual([1, 1])
  })

  it("moves the legend entry in lockstep with the columns", () => {
    const node = chart()
    const seek = scrub(node.hideSeries({ data: { seriesIndex: 0 }, duration: 1, easing: linear }))
    seek(0.5)
    expect(legendReveal(node)).toEqual([0.5, 1])
    seek(1)
    expect(legendReveal(node)).toEqual([0, 1])
  })

  it("eases the weight by the command's easing, and by easeOut when it has none", () => {
    const node = chart()
    scrub(node.hideSeries({ data: { seriesIndex: 0 }, duration: 1, easing: (t: number) => t * t }))(0.5)
    expect(node.weights[0]).toBeCloseTo(0.75)

    const other = chart()
    scrub(other.hideSeries({ data: { seriesIndex: 0 }, duration: 1 }))(0.5)
    // easeOut is past the straight line at the middle.
    expect(other.weights[0]).toBeLessThan(0.5)
  })

  it("hides series 0 when no index is given", () => {
    const node = chart()
    scrub(node.hideSeries({ duration: 1, easing: linear }))(1)
    expect(node.weights).toEqual([0, 1])
  })
})

describe("BarChart.showSeries", () => {
  const hidden = () => chart({ series: [SERIES[0], { ...SERIES[1], enabled: false }] })

  it("widens a hidden series' columns from nothing while the other narrows to make room", () => {
    const node = hidden()
    const seek = scrub(node.showSeries({ data: { seriesIndex: 1 }, duration: 1, easing: linear }))
    seek(0.5)
    relay(node)
    expect(node.weights).toEqual([1, 0.5])
    expect(bars(node, 1)[0].thickness).toBeGreaterThan(0)
    seek(1)
    relay(node)
    expect(bars(node, 0)[0].thickness).toBeCloseTo(slotInner(node) / 2 - 6)
    expect(bars(node, 1)[0].thickness).toBeCloseTo(slotInner(node) / 2 - 6)
  })

  it("switches the columns on from the first frame, though they have no width yet", () => {
    const node = hidden()
    const seek = scrub(node.showSeries({ data: { seriesIndex: 1 }, duration: 1, easing: linear }))
    seek(0)
    expect(enabled(node)[1]).toBe(true)
    expect(bars(node, 1)[0].thickness).toBe(0)
  })

  it("keeps showing a series that is already showing", () => {
    const node = chart()
    const seek = scrub(node.showSeries({ data: { seriesIndex: 0 }, duration: 1, easing: linear }))
    seek(0.5)
    expect(node.weights).toEqual([1, 1])
    expect(enabled(node)).toEqual([true, true])
  })
})

describe("BarChart: a series that does not exist", () => {
  it("takes its slot and changes nothing", () => {
    const node = chart()
    const show = node.showSeries({ data: { seriesIndex: 7 }, duration: 2 })
    const hide = node.hideSeries({ data: { seriesIndex: -1 }, duration: 3 })
    expect(show.duration).toBe(2)
    expect(hide.duration).toBe(3)
    scrub(show)(1)
    scrub(hide)(1.5)
    expect(node.weights).toEqual([1, 1])
    expect(enabled(node)).toEqual([true, true])
  })
})

describe("BarChart: a stacked chart", () => {
  const stacked = () => chart({ stack: "stacked" })

  it("measures the stack from the live contributions, so a series fading out lowers the segments above it", () => {
    const node = stacked()
    const full = bars(node, 1)[0].from
    // Series B rides on A's value of 10: its segment starts where A's ends.
    expect(full).toBeCloseTo(valueToY(node, 10))
    const seek = scrub(node.hideSeries({ data: { seriesIndex: 0 }, duration: 1, easing: linear }))
    seek(0.5)
    expect(bars(node, 1)[0].from).toBeCloseTo(valueToY(node, 5))
    seek(1)
    expect(bars(node, 1)[0].from).toBeCloseTo(valueToY(node, 0))
  })

  it("keeps a column the width of the slot whatever the weights say", () => {
    const node = stacked()
    scrub(node.hideSeries({ data: { seriesIndex: 0 }, duration: 1, easing: linear }))(0.5)
    expect(bars(node, 1)[0].thickness).toBeCloseTo(slotInner(node))
  })

  it("prints each segment's own value inside it", () => {
    const node = chart({ stack: "stacked", style: { values: "inside" } })
    expect(bars(node, 0).map((bar) => bar.caption)).toEqual(["10", "30", "20"])
    expect(bars(node, 1).map((bar) => bar.caption)).toEqual(["20", "10", "20"])
  })

  it("prints the stack's total past its end, on the last segment only", () => {
    const node = chart({ stack: "stacked", style: { values: "end" } })
    expect(bars(node, 0).map((bar) => bar.caption)).toEqual(["", "", ""])
    expect(bars(node, 1).map((bar) => bar.caption)).toEqual(["30", "40", "40"])
  })

  it("prints shares in a percent stack, inside, even when asked for the end", () => {
    const node = chart({ stack: "percent", style: { values: "end" } })
    expect(bars(node, 0).map((bar) => bar.caption)).toEqual(["33.3%", "75%", "50%"])
    expect(partsOf(node).bars[0].values).toBe("inside")
  })
})

describe("BarChart: the rounded end of a column", () => {
  /** The corner radii of every column drawn, in draw order. */
  const corners = (node: BarChart) =>
    partsOf(node)
      .bars.flatMap((set) => {
        const ctx = new Recorder()
        ctx.execute(() => set.render(ctx))
        return ctx.ops()
      })
      .flatMap((ops) => ops.flatMap((op) => (op.kind === "rect" ? [(op.state as { cornerRadius?: unknown }).cornerRadius] : [])))
      .filter((radius): radius is Record<string, number> => typeof radius === "object" && radius !== null)

  it("is the top of a column that reaches up", () => {
    const rounded = corners(chart())
    expect(rounded.length).toBeGreaterThan(0)
    for (const radius of rounded) {
      expect(radius.topLeft).toBeGreaterThan(0)
      expect(radius.bottomLeft).toBe(0)
    }
  })

  it("is the bottom of a column that reaches down", () => {
    const rounded = corners(chart({ data: ROWS.map((row) => ({ ...row, a: -row.a, b: -row.b })) }))
    expect(rounded.length).toBeGreaterThan(0)
    for (const radius of rounded) {
      expect(radius.bottomLeft).toBeGreaterThan(0)
      expect(radius.topLeft).toBe(0)
    }
  })
})

describe("BarChart: the figures on the columns", () => {
  it("builds and prints each column's figure, as the value axis writes its ticks", () => {
    const node = chart({ style: { values: "end" }, valueAxis: { format: "$#,##0" } })
    draw(node, BOX)
    expect(bars(node, 0).map((column) => column.caption)).toEqual(["$10", "$30", "$20"])
    const figures = partsOf(node).bars[0].children as Text[]
    expect(figures.map((figure) => figure.text)).toEqual(["$10", "$30", "$20"])
  })

  it("prints none when it is not asked to", () => {
    const node = chart()
    expect(partsOf(node).bars[0].children).toHaveLength(0)
    expect(bars(node, 0)[0].caption).toBe("")
  })
})

describe("BarChart: spotlighting a category", () => {
  it("dims nothing while nothing is spotlit", () => {
    expectDims(categoryDims(chart()), [1, 1, 1])
  })

  it("fades every category but the chosen one toward the theme's dim as the reveal climbs", () => {
    const node = chart()
    node.set({ spotlight: 1, spotlightReveal: 0.5 } as never)
    expectDims(categoryDims(node), [1 - (1 - SPOTLIGHT_DIM) * 0.5, 1, 1 - (1 - SPOTLIGHT_DIM) * 0.5])
    node.set({ spotlightReveal: 1 } as never)
    expectDims(categoryDims(node), [SPOTLIGHT_DIM, 1, SPOTLIGHT_DIM])
  })

  it("dims nothing at a reveal of 0 whatever is chosen, and reads an overshoot as full", () => {
    const node = chart()
    node.set({ spotlight: 1, spotlightReveal: 0 } as never)
    expectDims(categoryDims(node), [1, 1, 1])
    node.set({ spotlightReveal: 7 } as never)
    expectDims(categoryDims(node), [SPOTLIGHT_DIM, 1, SPOTLIGHT_DIM])
  })

  it("dims every category when the one chosen is not there", () => {
    const node = chart()
    node.set({ spotlight: 9, spotlightReveal: 1 } as never)
    expectDims(categoryDims(node), [SPOTLIGHT_DIM, SPOTLIGHT_DIM, SPOTLIGHT_DIM])
  })

  it("reaches the columns and the captions both", () => {
    const node = chart()
    node.set({ spotlight: 2, spotlightReveal: 1 } as never)
    expectDims(partsOf(node).cAxis.dims, [SPOTLIGHT_DIM, SPOTLIGHT_DIM, 1])
    expectDims(partsOf(node).bars[0].dims, [SPOTLIGHT_DIM, SPOTLIGHT_DIM, 1])
  })

  describe("spotlightCategory", () => {
    it("sets the choice from the first frame and brings the reveal up from 0", () => {
      const node = chart()
      const command = node.spotlightCategory({ data: { categoryIndex: 1 }, duration: 1, easing: linear })
      expect(spotlitAt(node, command, 0)).toEqual({ spotlight: 1, spotlightReveal: 0 })
      expect(spotlitAt(node, command, 0.25)).toEqual({ spotlight: 1, spotlightReveal: 0.25 })
      expect(spotlitAt(node, command, 1)).toEqual({ spotlight: 1, spotlightReveal: 1 })
    })

    it("eases out unless told otherwise", () => {
      const node = chart()
      const command = node.spotlightCategory({ data: { categoryIndex: 0 }, duration: 1 })
      expect(spotlitAt(node, command, 0.5).spotlightReveal).toBeGreaterThan(0.5)
    })

    it("lights category 0 when none is named", () => {
      const node = chart()
      expect(spotlitAt(node, node.spotlightCategory({ duration: 1, easing: linear }), 1)).toEqual({ spotlight: 0, spotlightReveal: 1 })
    })

    it("moves the focus directly when another category is already lit, only the dimming changing", () => {
      const node = chart()
      node.set({ spotlight: 0, spotlightReveal: 1 } as never)
      const command = node.spotlightCategory({ data: { categoryIndex: 2 }, duration: 1, easing: linear })
      // Starts from the reveal it finds, so it does not retract first.
      expect(spotlitAt(node, command, 0)).toEqual({ spotlight: 2, spotlightReveal: 1 })
      expect(spotlitAt(node, command, 0.5)).toEqual({ spotlight: 2, spotlightReveal: 1 })
    })

    it("brings a half-lit reveal up from where it is", () => {
      const node = chart()
      node.set({ spotlight: 0, spotlightReveal: 0.5 } as never)
      const command = node.spotlightCategory({ data: { categoryIndex: 0 }, duration: 1, easing: linear })
      expect(spotlitAt(node, command, 0.5)).toEqual({ spotlight: 0, spotlightReveal: 0.75 })
    })

    it("takes its slot for a category that is not there, and changes nothing", () => {
      const node = chart()
      for (const categoryIndex of [-1, 3, 99]) {
        const command = node.spotlightCategory({ data: { categoryIndex }, duration: 2 })
        expect(command.duration).toBe(2)
        expect(spotlitAt(node, command, 0.5)).toEqual({ spotlight: null, spotlightReveal: 0 })
      }
    })

    it("is a frame of its time", () => {
      const node = chart()
      const seek = scrub(node.spotlightCategory({ data: { categoryIndex: 1 }, duration: 1, easing: linear }))
      seek(0.4)
      const forward = categoryDims(node)
      seek(1)
      seek(0)
      seek(0.4)
      expect(categoryDims(node)).toEqual(forward)
    })
  })

  describe("clearCategory", () => {
    const lit = () => {
      const node = chart()
      node.set({ spotlight: 1, spotlightReveal: 1 } as never)
      return node
    }

    it("fades the reveal to 0, holding the lit category until the fade lands", () => {
      const node = lit()
      const command = node.clearCategory({ duration: 1, easing: linear })
      expect(spotlitAt(node, command, 0)).toEqual({ spotlight: 1, spotlightReveal: 1 })
      expect(spotlitAt(node, command, 0.25)).toEqual({ spotlight: 1, spotlightReveal: 0.75 })
      expect(spotlitAt(node, command, 0.99)).toMatchObject({ spotlight: 1, spotlightReveal: expect.closeTo(0.01) })
    })

    it("lets go of the category at the end", () => {
      const node = lit()
      const command = node.clearCategory({ duration: 1, easing: linear })
      expect(spotlitAt(node, command, 1)).toEqual({ spotlight: null, spotlightReveal: 0 })
      expectDims(categoryDims(node), [1, 1, 1])
    })

    it("fades from the reveal it finds", () => {
      const node = chart()
      node.set({ spotlight: 1, spotlightReveal: 0.5 } as never)
      expect(spotlitAt(node, node.clearCategory({ duration: 1, easing: linear }), 0.5)).toEqual({ spotlight: 1, spotlightReveal: 0.25 })
    })

    it("is a no-op that still takes its slot when nothing is lit", () => {
      const node = chart()
      const command = node.clearCategory({ duration: 2 })
      expect(command.duration).toBe(2)
      expect(spotlitAt(node, command, 1)).toEqual({ spotlight: null, spotlightReveal: 0 })
    })

    it("restores the spotlight on a seek back below the end", () => {
      const node = lit()
      const seek = scrub(node.clearCategory({ duration: 1, easing: linear }))
      seek(1)
      seek(0.5)
      expect(node.spotlightReveal).toBeCloseTo(0.5)
      expect(node.spotlight).toBe(1)
    })
  })
})

describe("BarChart: orientation", () => {
  const sideways = (props: Record<string, unknown> = {}) => chart({ orientation: "horizontal", ...props })

  it("puts the categories in a column beside the plot and the values under it", () => {
    const node = sideways()
    expect(partOf(node, CategoryAxis)!.orientation).toBe("vertical")
    expect(partOf(node, HorizontalAxis)).toBeDefined()
    expect(partOf(node, VerticalAxis)).toBeUndefined()
    const upright = chart()
    expect(partOf(upright, CategoryAxis)!.orientation).toBe("horizontal")
    expect(partOf(upright, VerticalAxis)).toBeDefined()
  })

  it("grows the bars right from the zero line, first category at the top", () => {
    const node = sideways()
    const { bars: sets } = partsOf(node)
    expect(sets[0].horizontal).toBe(true)
    const plot = panel(node)
    const [lo, hi] = barChartDomain(node).range
    const zero = ((0 - lo) / (hi - lo) - 0.5) * plot.width
    const first = bars(node, 0)[0]
    expect(first.from).toBeCloseTo(zero)
    expect(first.to).toBeGreaterThan(first.from)
    // Slots run down the plot's height, the first above the last.
    expect(bars(node, 0)[0].center).toBeGreaterThan(bars(node, 0)[2].center)
    expect(Math.abs(bars(node, 0)[0].center - bars(node, 0)[2].center)).toBeCloseTo((plot.height / 3) * 2)
  })

  it("rounds the right end of a bar that grows right, and the left of one that grows left", () => {
    const radii = (node: BarChart) =>
      partsOf(node).bars.flatMap((set) => {
        const ctx = new Recorder()
        ctx.execute(() => set.render(ctx))
        return ctx.ops().flatMap((ops) => ops.flatMap((op) => (op.kind === "rect" ? [(op.state as { cornerRadius?: Record<string, number> }).cornerRadius] : [])))
      })
    for (const radius of radii(sideways())) {
      expect(radius!.topRight).toBeGreaterThan(0)
      expect(radius!.topLeft).toBe(0)
    }
    for (const radius of radii(sideways({ data: ROWS.map((row) => ({ ...row, a: -row.a, b: -row.b })) }))) {
      expect(radius!.topLeft).toBeGreaterThan(0)
      expect(radius!.topRight).toBe(0)
    }
  })
})

describe("BarChart: stack modes", () => {
  it("scales the value axis to the tallest bar apart, the tallest stack stacked, and 100 as shares", () => {
    expect(barChartDomain(chart()).range).toEqual([0, 30])
    expect(barChartDomain(chart({ stack: "stacked" })).range).toEqual([0, 40])
    expect(barChartDomain(chart({ stack: "percent" })).range).toEqual([0, 100])
  })

  it("writes a percent stack's ticks as shares", () => {
    const node = chart({ stack: "percent" })
    draw(node, BOX)
    const axis = partOf(node, VerticalAxis)!
    expect(axis.captions).toEqual(["0%", "25%", "50%", "75%", "100%"])
  })

  it("rounds only the last segment of a stack", () => {
    const node = chart({ stack: "stacked" })
    expect(bars(node, 0).map((bar) => bar.round)).toEqual([false, false, false])
    expect(bars(node, 1).map((bar) => bar.round)).toEqual([true, true, true])
  })

  it("ticks every multiple of the step, so zero is a tick when the bars run both ways", () => {
    const node = chart({ data: [{ m: "a", a: -73, b: 10 }, { m: "b", a: 305, b: 20 }] })
    expect(barChartDomain(node).ticks).toContain(0)
    expect(barChartDomain(node).ticks).toEqual([-100, 0, 100, 200, 300, 400])
  })
})

describe("BarChart: style", () => {
  it("declares one style entry in the chart family, with the bar marks and labels", () => {
    const style = new BarChart({}).style
    expect(style).toMatchObject({
      barCornerRadius: { topLeft: 10, topRight: 10, bottomRight: 0, bottomLeft: 0 },
      barCornerStyle: { topLeft: "rounded" },
      barWidth: 0.7,
      barGap: 6,
      values: "none",
      legend: "bottom",
    })
  })

  it("rules the value ticks by default, as strokes: horizontal on, vertical and axis off", () => {
    const style = new BarChart({}).style
    expect(style.horizontalGrid).toMatchObject([{ weight: 2 }])
    expect(style.verticalGrid).toEqual([])
    expect(style.axisStroke).toEqual([])
    expect(style).not.toHaveProperty("gridColor")
  })

  it("draws the canvas's grid from the strokes as given, dash included", () => {
    const node = chart({ style: { horizontalGrid: { weight: 3, fill: "#ff0000", dash: [6, 4] }, verticalGrid: { weight: 1, fill: "#00ff00" }, axisStroke: { weight: 5, fill: "#0000ff" } } })
    const canvas = partOf(node, ChartCanvas)!
    expect(canvas.yGridStroke[0]).toMatchObject({ weight: 3, dash: [6, 4] })
    expect(canvas.xGridStroke[0]).toMatchObject({ weight: 1 })
    expect(canvas.axisStroke[0]).toMatchObject({ weight: 5 })
  })

  it("rules a horizontal chart literally: vertical rules follow the value ticks", () => {
    const node = chart({ orientation: "horizontal", style: { horizontalGrid: [], verticalGrid: { weight: 2, fill: "#ffffff" } } })
    const canvas = partOf(node, ChartCanvas)!
    expect(canvas.yGridStroke).toEqual([])
    expect(canvas.xGridStroke).toHaveLength(1)
  })

  it("tweens the bars' rounding and width with to({ style })", () => {
    const node = chart()
    const seek = scrub(node.to({ data: { style: { barCornerRadius: { topLeft: 20, topRight: 20 }, barWidth: 0.5 } }, duration: 1, easing: linear }))
    seek(0.5)
    relay(node)
    expect(node.style.barCornerRadius.topLeft).toBeCloseTo(15)
    expect(node.style.barCornerRadius.bottomLeft).toBe(0)
    expect(partsOf(node).bars[0].cornerRadius.topRight).toBeCloseTo(15)
    expect(slotInner(node)).toBeCloseTo(slotWidth(node) * 0.6)
  })

  it("leaves out a value or category axis the style turns off, the plot taking its room", () => {
    const full = plotOf(chart()).layoutBounds
    const bare = chart({ style: { showXAxis: false, showYAxis: false } })
    expect(partOf(bare, VerticalAxis)).toBeUndefined()
    expect(partOf(bare, CategoryAxis)).toBeUndefined()
    expect(plotOf(bare).layoutBounds.width).toBeGreaterThan(full.width)
    expect(plotOf(bare).layoutBounds.height).toBeGreaterThan(full.height)
  })

  it("builds no legend for legend: none, and a column for one on the right", () => {
    expect(partOf(chart({ style: { legend: "none" } }), ChartLegend)).toBeUndefined()
    const right = partOf(chart({ style: { legend: "right" } }), ChartLegend)!
    expect(right.flow).toBe("vertical")
    expect(partOf(chart({ style: { legend: "top" } }), ChartLegend)!.flow).toBe("horizontal")
  })

  it("puts a top legend above the plot and a bottom one below it", () => {
    const y = (legend: string) => {
      const node = chart({ style: { legend } })
      const entry = partOf(node, ChartLegend)!
      return entry.parent!.layoutBounds.y
    }
    expect(y("top")).toBeLessThan(y("bottom"))
  })
})
