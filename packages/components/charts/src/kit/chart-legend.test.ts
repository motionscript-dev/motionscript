import { describe, expect, it } from "vitest"

import { Rect } from "@motionscript/sdk"

import { at, layOut, scrub } from "../tests/harness"
import { ChartLegend, legendShows } from "./chart-legend"
import { DEFAULT_LEGEND, SPOTLIGHT_DIM, resolveLegendConfig, type ChartSeries } from "./shared"

/**
 * The legend: a row of entries, one per series, whose reveal drives the width,
 * the opacity and the flanking gap together. Every entry is a child for good —
 * showing and hiding a series moves a number, so a frame is a function of time.
 */

const LEGEND = resolveLegendConfig(undefined, DEFAULT_LEGEND)
const SERIES: ChartSeries[] = [
  { field: "a", label: "Alpha" },
  { field: "b", label: "Beta", enabled: false },
  { field: "c", label: "Gamma" },
]
const linear = (t: number) => t

function legend(series: ChartSeries[] = SERIES, props: Record<string, unknown> = {}) {
  const node = new ChartLegend({
    series,
    swatches: ["#ff0000", "#00ff00", "#0000ff"],
    legend: LEGEND,
    ...props,
  } as never)
  layOut(node, { width: 1000, height: 100 })
  return node
}

/** Each entry's opacity, its gap scale and its laid-out width. */
const state = (node: ChartLegend) =>
  node.children.map((entry) => {
    const item = entry as Rect
    return { opacity: item.opacity, gapScale: item.gapScale, width: item.layoutBounds.width }
  })

const reveal = (node: ChartLegend) => (node as unknown as { reveal: number[] }).reveal
const entry = (node: ChartLegend, index: number) => node.children[index] as Rect

/** The first entry's two parts: the caption, then the chip. */
const parts = (node: ChartLegend, index: number) => entry(node, index).children

describe("ChartLegend: the entries", () => {
  it("holds one entry per series, every one a child, in series order", () => {
    const node = legend()
    expect(node.children).toHaveLength(3)
    const captions = node.children.map((child) => (child.children[0] as unknown as { text: string }).text)
    expect(captions).toEqual(["Alpha", "Beta", "Gamma"])
  })

  it("holds no entry for a chart with no series", () => {
    expect(legend([]).children).toHaveLength(0)
  })

  it("pairs each caption with a rounded chip in the series' swatch", () => {
    const node = legend()
    const chips = node.children.map((child) => child.children[1] as unknown as { fill: unknown; width: number; height: number; cornerRadius: number })
    expect(chips).toHaveLength(3)
    for (const chip of chips) {
      expect(chip.width).toBe(LEGEND.markerStyle.width)
      expect(chip.height).toBe(LEGEND.markerStyle.height)
      expect(chip.cornerRadius).toEqual({ topLeft: 6, topRight: 6, bottomRight: 6, bottomLeft: 6 })
    }
    expect(JSON.stringify(chips[0].fill)).toContain("1,0,0,1")
    expect(JSON.stringify(chips[2].fill)).toContain("0,0,1,1")
  })

  it("paints a chip white when there is no swatch for its series", () => {
    const node = legend(SERIES, { swatches: ["#ff0000"] })
    const chip = node.children[2].children[1] as unknown as { fill: unknown }
    expect(JSON.stringify(chip.fill)).toContain("1,1,1,1")
  })

  it("lays the entries out in a row, left to right, the theme's gap apart", () => {
    const node = legend([{ field: "a", label: "A" }, { field: "b", label: "B" }])
    expect(node.gap).toBe(LEGEND.itemGap)
    const [first, second] = node.children.map((child) => child.layoutBounds)
    expect(second.x).toBeGreaterThan(first.x)
  })

  it("hugs its entries", () => {
    const node = legend()
    expect(node.width).toBe("hug")
    expect(node.height).toBe("hug")
  })
})

describe("ChartLegend: which series show", () => {
  it("starts every series revealed except one that says enabled: false", () => {
    expect(reveal(legend())).toEqual([1, 0, 1])
  })

  it("shows a series from the reveal: any reveal above 0 is showing", () => {
    const node = legend()
    expect([legendShows(node, 0), legendShows(node, 1), legendShows(node, 2)]).toEqual([true, false, true])
    expect(legendShows(node, 9)).toBe(false)
    expect(legendShows(node, -1)).toBe(false)
  })

  it("starts a hidden series collapsed: transparent, with no gap and no room", () => {
    const [shown, hidden] = state(legend())
    expect(shown).toMatchObject({ opacity: 1, gapScale: 1 })
    expect(shown.width).toBeGreaterThan(0)
    expect(hidden).toEqual({ opacity: 0, gapScale: 0, width: 0 })
  })

  it("lays the shown entries out as if the hidden one were not there", () => {
    const node = legend()
    const [first, , third] = node.children.map((child) => child.layoutBounds)
    const closed = legend([SERIES[0], SERIES[2]])
    const [a, b] = closed.children.map((child) => child.layoutBounds)
    expect(third.x - first.x).toBeCloseTo(b.x - a.x)
  })
})

describe("ChartLegend.showSeries and hideSeries", () => {
  it("fades a hidden entry in and opens the gap beside it as the reveal climbs", () => {
    const node = legend()
    const show = node.showSeries({ data: { index: 1 }, duration: 1, easing: linear } as never)
    for (const t of [0, 0.25, 0.5, 1]) {
      at(show, t)
      layOut(node, { width: 1000, height: 100 })
      const [, middle] = state(node)
      expect(middle.opacity, `t = ${t}`).toBeCloseTo(t)
      expect(middle.gapScale, `t = ${t}`).toBeCloseTo(t)
    }
    expect(legendShows(node, 1)).toBe(true)
  })

  it("lands a shown entry at its natural width", () => {
    const node = legend()
    at(node.showSeries({ data: { index: 1 }, duration: 1, easing: linear } as never), 1)
    layOut(node, { width: 1000, height: 100 })
    expect(state(node)[1].width).toBeGreaterThan(0)
  })

  // An entry that started hidden once had no natural width to grow to, so it held width 0 all the way and snapped open at the end.
  it("grows a series that started hidden in width as it shows", () => {
    const node = legend()
    const show = node.showSeries({ data: { index: 1 }, duration: 1, easing: linear } as never)
    at(show, 0.5)
    layOut(node, { width: 1000, height: 100 })
    expect(state(node)[1].width).toBeGreaterThan(0)
  })

  it("collapses a shown entry: its width falls with the reveal, from the width its content measures", () => {
    const node = legend()
    const full = state(node)[0].width
    const hide = node.hideSeries({ data: { index: 0 }, duration: 1, easing: linear } as never)
    at(hide, 0.5)
    layOut(node, { width: 1000, height: 100 })
    const [half] = state(node)
    expect(half.opacity).toBeCloseTo(0.5)
    expect(half.gapScale).toBeCloseTo(0.5)
    expect(half.width).toBeCloseTo(full / 2)
    at(hide, 1)
    layOut(node, { width: 1000, height: 100 })
    expect(state(node)[0]).toEqual({ opacity: 0, gapScale: 0, width: 0 })
    expect(legendShows(node, 0)).toBe(false)
  })

  // The natural width was learnt from earlier frames, so a seek straight into a hide gave another picture.
  it("shrinks an entry in width when a hide is seeked to cold, as it does when it is played to", () => {
    const full = state(legend())[0].width
    const node = legend()
    at(node.hideSeries({ data: { index: 0 }, duration: 1, easing: linear } as never), 0.5)
    layOut(node, { width: 1000, height: 100 })
    expect(state(node)[0].width).toBeCloseTo(full / 2)
  })

  // A frame is a function of its time, so the width at a time cannot depend on the frames before it.
  describe("is the same width at the same time, played to or seeked to cold", () => {
    const TIMES = [0, 0.25, 0.5, 0.75, 1]
    const widthsAt = (node: ChartLegend) => {
      layOut(node, { width: 1000, height: 100 })
      return state(node).map((s) => s.width)
    }

    for (const [name, index, command] of [["a show", 1, "showSeries"], ["a hide", 0, "hideSeries"]] as const) {
      it(`for ${name}`, () => {
        const build = (node: ChartLegend) => node[command]({ data: { index }, duration: 1, easing: linear } as never)

        const played = legend()
        const seek = scrub(build(played))
        const playedWidths = TIMES.map((t) => { seek(t); return widthsAt(played) })

        const cold = TIMES.map((t) => {
          const node = legend()
          at(build(node), t)
          return widthsAt(node)
        })

        expect(cold).toEqual(playedWidths)
      })
    }
  })

  it("grows a hidden entry to the width the same series has when it starts shown", () => {
    const natural = state(legend([{ field: "b", label: "Beta" }]))[0].width
    const node = legend()
    const show = node.showSeries({ data: { index: 1 }, duration: 1, easing: linear } as never)

    for (const t of [0.25, 0.5, 1]) {
      at(show, t)
      layOut(node, { width: 1000, height: 100 })
      expect(state(node)[1].width, `t = ${t}`).toBeCloseTo(t * natural)
    }
  })

  it("measures the width from what the entry holds now, so a relabelled series collapses from its new width", () => {
    const node = legend()
    const caption = parts(node, 0)[0] as unknown as { text: string }
    caption.text = "A much longer caption"
    const full = state(node)[0].width
    layOut(node, { width: 1000, height: 100 })
    const grown = state(node)[0].width
    expect(grown).toBeGreaterThan(full)

    at(node.hideSeries({ data: { index: 0 }, duration: 1, easing: linear } as never), 0.5)
    layOut(node, { width: 1000, height: 100 })
    expect(state(node)[0].width).toBeCloseTo(grown / 2)
  })

  it("leaves an entry that is fully shown at the width its caption and chip come to", () => {
    const node = legend()
    const [first, , third] = state(node)
    const natural = (label: string) => label.length * (LEGEND.textStyle.fontSize as number) * 0.5 + 12 + LEGEND.markerStyle.width

    expect(first.width).toBeCloseTo(natural("Alpha"))
    expect(third.width).toBeCloseTo(natural("Gamma"))
  })

  it("closes the gap behind a hidden entry: the entries after it slide over", () => {
    const node = legend([{ field: "a", label: "A" }, { field: "b", label: "B" }, { field: "c", label: "C" }])
    const before = node.children[2].layoutBounds.x
    at(node.hideSeries({ data: { index: 1 }, duration: 1, easing: linear } as never), 1)
    layOut(node, { width: 1000, height: 100 })
    expect(node.children[2].layoutBounds.x).toBeLessThan(before)
  })

  it("moves one entry only, leaving the others as they were", () => {
    const node = legend()
    at(node.hideSeries({ data: { index: 0 }, duration: 1, easing: linear } as never), 0.5)
    layOut(node, { width: 1000, height: 100 })
    const [, hidden, third] = state(node)
    expect(hidden).toMatchObject({ opacity: 0, gapScale: 0 })
    expect(third).toMatchObject({ opacity: 1, gapScale: 1 })
  })

  it("takes its slot for an index that is not a series, and changes nothing", () => {
    const node = legend()
    const show = node.showSeries({ data: { index: 9 }, duration: 2 } as never)
    const hide = node.hideSeries({ data: { index: -1 }, duration: 3 } as never)
    expect((show as unknown as { duration: number }).duration).toBe(2)
    expect((hide as unknown as { duration: number }).duration).toBe(3)
    at(show, 1)
    at(hide, 1.5)
    expect(reveal(node)).toEqual([1, 0, 1])
  })

  // A component command has no duration of its own: the class's 0.35 s default is
  // the chart's to pass, and its per-series commands do.
  it("takes the duration it is given", () => {
    const node = legend()
    expect(node.showSeries({ data: { index: 1 }, duration: 0.35 }).duration).toBeCloseTo(0.35)
    expect(node.hideSeries({ data: { index: 0 }, duration: 0.35 }).duration).toBeCloseTo(0.35)
  })

  it("is a frame of its time: the same reveal whichever way the playhead came", () => {
    const node = legend()
    const hide = node.hideSeries({ data: { index: 0 }, duration: 1, easing: linear } as never)
    at(hide, 0.7)
    const forward = [...reveal(node)]
    at(hide, 1)
    at(hide, 0.2)
    at(hide, 0.7)
    expect(reveal(node)).toEqual(forward)
  })

  it("starts a hide from where the show before it left the entry", () => {
    const node = legend()
    at(node.showSeries({ data: { index: 1 }, duration: 1, easing: linear } as never), 1)
    const hide = node.hideSeries({ data: { index: 1 }, duration: 1, easing: linear } as never)
    at(hide, 0.5)
    expect(reveal(node)[1]).toBeCloseTo(0.5)
  })
})

describe("ChartLegend.spotlightSeries", () => {
  it("dims every shown entry but the one named, and leaves the row where it is", () => {
    const node = legend()
    const spot = node.spotlightSeries({ data: { index: 2 }, duration: 1, easing: linear } as never)
    const widths = state(node).map((s) => s.width)
    at(spot, 0.5)
    layOut(node, { width: 1000, height: 100 })
    const mid = state(node)
    expect(mid[0].opacity).toBeCloseTo((1 + SPOTLIGHT_DIM) / 2)
    expect(mid[2].opacity).toBe(1)
    expect(mid.map((s) => s.width)).toEqual(widths)
    at(spot, 1)
    expect(state(node)[0].opacity).toBeCloseTo(SPOTLIGHT_DIM)
  })

  it("leaves an entry that was hidden when the command was built as it was", () => {
    const node = legend()
    at(node.spotlightSeries({ data: { index: 0 }, duration: 1, easing: linear } as never), 1)
    expect(entry(node, 1).opacity).toBe(0)
  })

  it("brings the named entry to full from wherever it was", () => {
    const node = legend()
    at(node.spotlightSeries({ data: { index: 2 }, duration: 1, easing: linear } as never), 1)
    const back = node.spotlightSeries({ data: { index: 0 }, duration: 1, easing: linear } as never)
    at(back, 1)
    expect(entry(node, 0).opacity).toBe(1)
    expect(entry(node, 2).opacity).toBeCloseTo(SPOTLIGHT_DIM)
  })

  it("spotlights the first series when no index is given", () => {
    const node = legend()
    at(node.spotlightSeries({ duration: 1, easing: linear } as never), 1)
    expect(entry(node, 0).opacity).toBe(1)
    expect(entry(node, 2).opacity).toBeCloseTo(SPOTLIGHT_DIM)
  })
})

describe("ChartLegend: a restyled row", () => {
  it("takes the theme's gap and padding", () => {
    const node = legend(SERIES, { legend: resolveLegendConfig({ itemGap: 10, padding: 6 }, DEFAULT_LEGEND) })
    expect(node.gap).toBe(10)
    expect(node.padding).toEqual({ top: 6, right: 6, bottom: 6, left: 6 })
  })

  it("sets the caption in the theme's text style", () => {
    const node = legend(SERIES, { legend: resolveLegendConfig({ textStyle: { fontSize: 41 } }, DEFAULT_LEGEND) })
    expect((parts(node, 0)[0] as unknown as { fontSize: number }).fontSize).toBe(41)
  })
})
