import {
  Rect,
  Text,
  Types,
  component2d,
  easeOut,
  type ChildView,
  type DataRecord,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
  type TextStyle as _TextStyle,
  type Fill as _Fill,
  type FillResolved as _FillResolved,
  type Stroke as _Stroke,
  type StrokeResolved as _StrokeResolved,
  type Size2D,
  type Vector2,
} from "@motionscript/sdk"

import { boundText, laidOutSize } from "../kit/cartesian"
import { ChartLegend } from "../kit/chart-legend"
import { SERIES_ARG, asParts, fresh } from "../kit/entries"
import { ENTER_SHARE, LEGEND_SLIDE, beats, type AnyTimeline, type Beat } from "../kit/motion"
import { SPOTLIGHT_DIM, type ChartSeries } from "../kit/shared"
import {
  CHART_LEGEND,
  CHART_SERIES,
  CHART_STYLE_FAMILY,
  CHART_STYLE_PRESETS,
  GRID_BACKGROUND,
  legendConfigOf,
  migrateChartStyle,
  placedText,
  seriesFill,
  sizeOf,
} from "../kit/style"
import { RadarGrid } from "./radar-grid"
import { RadarSeries } from "./radar-series"
import {
  RADAR_GRID,
  RADAR_MARKS,
  categoriesOf,
  fitRadius,
  fractionOf,
  labelAnchor,
  labelPoint,
  scaleOf,
  valuesOf,
} from "./shared"

/** What a radar chart plots, as its entries hold it. */
export interface RadarValues {
  readonly data: DataRecord[]
  readonly categoryField: string
  readonly series: ChartSeries[]
  readonly min: number
  readonly max: number
}

/** The scale the web is drawn to, whether `max` was given or left to the data. */
export function radarScale(state: RadarValues): { min: number; max: number } {
  return scaleOf(valuesOf(state.data, state.series), state.min, state.max)
}

/** Series `index`'s values as fractions of the rim, in spoke order. */
export function radarFractions(state: RadarValues, index: number): number[] {
  const series = state.series[index]
  if (!series) return []
  const scale = radarScale(state)
  return state.data.map((row) => {
    const v = row[series.field]
    return fractionOf(typeof v === "number" && Number.isFinite(v) ? v : 0, scale)
  })
}

/** The grid, series, label layer and legend among the children; the last row holding a grid is the one the chart built. */
function partsOf(children: readonly ChildView[]) {
  for (let i = children.length - 1; i >= 0; i--) {
    const row = children[i]
    if (!Rect.is(row)) continue
    const plot = row.children.find((part) => Rect.is(part) && part.children.some(RadarGrid.is))
    if (!plot) continue
    return {
      grid: plot.children.find(RadarGrid.is)!,
      series: plot.children.filter(RadarSeries.is),
      labels: plot.children.find(Rect.is) ?? null,
      legend: row.children.find(ChartLegend.is) ?? null,
    }
  }
  return null
}

function toggling(timeline: AnyTimeline, children: readonly ChildView[], index: number, show: boolean) {
  const parts = partsOf(children)
  const series = parts?.series[index]
  if (!parts || !series) return timeline.wait(timeline.duration)
  return timeline.together([
    series.run("enter", show ? { from: 0, to: 1 } : { from: 1, to: 0 }),
    ...(parts.legend ? [parts.legend.run(show ? "showSeries" : "hideSeries", { index })] : []),
  ])
}

/** The share of one series' growth that passes before the next starts. */
const STAGGER = 0.3

/**
 * A radar (spider) chart: one spoke per data row, one closed polygon per
 * series, over a web of rings. Composed of a {@link RadarGrid}, a
 * {@link RadarSeries} per series, the category labels and a {@link ChartLegend}.
 *
 * Resting state is the finished chart; `enter` arms every part on its first
 * frame. `max` of 0 (or one not above `min`) is the largest value rounded up.
 */
export const RadarChart = component2d({
  key: "radarChart",
  state: {
    data: fresh<DataRecord[]>(() => [], { kind: "dataset" }),
    /** The column that names each spoke. */
    categoryField: "",
    series: fresh<ChartSeries[]>(() => [], { kind: "series" }),
    /** The value at the centre of the web. */
    min: 0,
    /** The value at the rim; 0 rounds the largest value up. */
    max: 0,
    style: Types.style(
      CHART_STYLE_FAMILY,
      {
        series: CHART_SERIES,
        background: GRID_BACKGROUND,
        grid: RADAR_GRID,
        marks: RADAR_MARKS,
        legend: CHART_LEGEND,
      },
      { presets: CHART_STYLE_PRESETS }
    ),
  },
  // A node made of parts that fill would otherwise hug them.
  defaults: { width: "fill", height: "fill" },
  migrate: { style: migrateChartStyle("radar") },
  allowedChildren: [],
  children: (state) => {
    const style = () => state.style
    let plot: Node2D | undefined
    const plotSize = (): Size2D => laidOutSize(plot)
    const radius = () => fitRadius(plotSize(), categoriesOf(state.data, state.categoryField), sizeOf(style().spokeText), style().spokeLabels)
    const count = state.data.length
    const enabled = state.series.map((s) => s.enabled ?? true)

    const grid = new RadarGrid({
      count: () => state.data.length,
      radius,
      levels: () => style().gridLevels,
      fill: () => style().gridBackground,
      shape: () => style().gridShape,
      stroke: () => style().gridStroke,
      spokeStroke: () => style().spokeStroke,
    }) as unknown as Node2D

    const series = state.series.map(
      (s, i) =>
        new RadarSeries({
          fractions: () => radarFractions(state, i),
          radius,
          fill: () => seriesFill(style(), s, i),
          stroke: () => {
            const weight = style().strokeWidth
            return weight > 0 ? { weight, fill: seriesFill(style(), s, i), align: "center", join: "round" } : []
          },
          areaOpacity: () => style().areaOpacity,
          dots: () => style().dots,
          dotSize: () => style().dotSize,
          enabled: enabled[i],
        }) as unknown as Node2D
    )

    const parts: Node2D[] = [grid, ...series]

    if (state.style.spokeLabels) {
      const labels: Node2D[] = []
      for (let i = 0; i < count; i++) {
        const anchor = labelAnchor(i, count)
        const align = anchor === "centerLeft" ? "left" : anchor === "centerRight" ? "right" : "center"
        const at = (): Vector2 => labelPoint(i, count, radius(), sizeOf(style().spokeText))
        labels.push(
          new Text({
            ...boundText(() => placedText(style().spokeText, align)),
            text: () => categoriesOf(state.data, state.categoryField)[i] ?? "",
            [anchor]: at,
          }) as unknown as Node2D
        )
      }
      parts.push(new Rect({ width: "fill", height: "fill", children: labels }) as unknown as Node2D)
    }

    plot = new Rect({ width: "fill", height: "fill", children: parts }) as unknown as Node2D

    const row: Node2D[] = [plot]
    const position = state.style.legend
    if (position !== "none") {
      const side = position === "right"
      const config = legendConfigOf(state.style)
      const legend = new ChartLegend({
        series: state.series,
        swatches: () => state.series.map((s, i) => seriesFill(style(), s, i)),
        legend: () => legendConfigOf(style()),
        flow: side ? "vertical" : "horizontal",
        // Spacing is fixed as built; a style tween re-paints the swatches and captions only.
        gap: side ? Math.round(config.itemGap / 2) : config.itemGap,
        padding: config.padding,
      }) as unknown as Node2D
      if (position === "top") row.unshift(legend)
      else row.push(legend)
    }

    const frame = new Rect({
      flow: position === "right" ? "horizontal" : "vertical",
      width: "fill",
      height: "fill",
      gap: 24,
      align: "center",
      fill: () => style().background,
      children: row,
    })
    return asParts([frame as unknown as Node2D])
  },
  commands: {
    /** The web grows out, the polygons grow from the centre one series after another, then the labels and legend come up. */
    enter: {
      args: {},
      // Held from arrival, so it never shows finished ahead of its draw.
      entrance: true,
      easing: easeOut(),
      run: (timeline, _state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const duration = timeline.duration
        const web = duration * ENTER_SHARE.axes
        const marks = duration * ENTER_SHARE.marks
        const last = duration * ENTER_SHARE.legend
        const n = Math.max(1, parts.series.length)
        const each = marks / (1 + STAGGER * (n - 1))
        const { legend, labels } = parts
        const at0 = (piece: Beat["piece"]): Beat => ({ at: 0, duration: 0, piece })
        // The first frame arms what every later beat moves: a beat ahead of the playhead writes nothing.
        return beats(timeline, [
          at0(parts.grid.to({ reveal: 0 })),
          ...parts.series.map((s) => at0(s.to({ progress: 0 }))),
          ...(labels ? [at0(labels.to({ opacity: 0 }))] : []),
          ...(legend ? [at0(legend.to({ opacity: 0, y: -LEGEND_SLIDE }))] : []),
          { at: 0, duration: web, piece: parts.grid.to({ reveal: 1 }) },
          ...parts.series.map((s, i) => ({ at: web + i * each * STAGGER, duration: each, piece: s.to({ progress: 1 }) })),
          ...(labels ? [{ at: web + marks * 0.6, duration: last + marks * 0.4, piece: labels.to({ opacity: 1 }) }] : []),
          ...(legend ? [{ at: web + marks, duration: last, piece: legend.to({ opacity: 1, y: 0 }) }] : []),
        ])
      },
    },
    /** Grow series `index`'s polygon back out of the centre, with its legend entry growing in. */
    showSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => toggling(timeline, children, timeline.args.seriesIndex, true),
    },
    /** Shrink series `index`'s polygon into the centre as its legend entry shrinks away. */
    hideSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => toggling(timeline, children, timeline.args.seriesIndex, false),
    },
    /** Fade every other series, polygon and legend entry, to focus on `index`. The legend dims in place, so the row does not reflow. */
    spotlightSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const index = timeline.args.seriesIndex
        return timeline.together([
          ...parts.series.map((s, i) => s.to({ opacity: i === index ? 1 : SPOTLIGHT_DIM })),
          ...(parts.legend ? [parts.legend.run("spotlightSeries", { index })] : []),
        ])
      },
    },
  },
})

export type RadarChart = NodeOf<typeof RadarChart>
