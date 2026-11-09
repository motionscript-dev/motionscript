import {
  Flow,
  Paint,
  Rect,
  Shapes,
  Text,
  Types,
  component2d,
  textOps,
  type Fill,
  type NodeOf,
  type RectProps,
  // Named so the row's emitted type reaches the Rect surface it spreads through the sdk, not core.
  type Alignment as _Alignment,
  type CornerRadiusResolved as _CornerRadiusResolved,
  type CornerStyleResolved as _CornerStyleResolved,
  type FillResolved as _FillResolved,
  type FlowMode as _FlowMode,
  type FlowResolved as _FlowResolved,
  type GapSize as _GapSize,
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
  type RectCornerRadius as _RectCornerRadius,
  type RectCornerStyle as _RectCornerStyle,
  type Shadow as _Shadow,
  type ShadowResolved as _ShadowResolved,
  type Stroke as _Stroke,
  type StrokeResolved as _StrokeResolved,
  type Vector2 as _Vector2,
} from "@motionscript/sdk"

import { fresh } from "./entries"
import { frameEase } from "./motion"
import {
  DEFAULT_LEGEND,
  SPOTLIGHT_DIM,
  type ChartSeries,
  type LegendConfig,
} from "./shared"

export interface ChartLegendProps extends RectProps {
  /**
   * One entry per series: legend `label`, its `enabled` default, and — through
   * {@link ChartLegendProps.swatches} — the colour its chip is painted. A series
   * that starts enabled (the default) is added to the row up front; one that
   * starts `false` is hidden until a later `showSeries`.
   */
  series: ChartSeries[]
  /**
   * The swatch colour for each series, by index — resolved by the chart, whose
   * business it is whether a series' colour comes out of a stroke palette (a
   * line) or a fill palette (a bar). Shorter than the series list means the
   * missing entries fall back to white.
   */
  swatches: Fill[]
  /** Padding, caption style, gaps, and swatch geometry — see {@link LegendConfig}. */
  legend: LegendConfig
}

/** A row's entries are a `Rect`'s: paint, the flow of its children, its corners. */
const row = { ...Paint.state, ...Flow.state, ...Shapes.corners }

/**
 * One legend entry. It hugs its caption and swatch; `shown` scales that width
 * from nothing to the whole of it.
 *
 * The width is taken from the content on every measure, at any reveal, so a frame
 * never depends on whether the entry was once seen fully shown. A collapse needs a
 * number to scale, and `"hug"` is not one until something measures it — this is
 * the something.
 */
const LegendEntry = component2d({
  key: "legendEntry",
  state: { ...row, shown: Types.number(1) },
  commands: { ...Paint.commands },
  measure: (measurer, state, children) => {
    const size = Flow.measure(measurer, state, children, Paint.inset(state))
    return state.shown >= 1 ? size : { ...size, width: state.shown * size.width }
  },
  layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
  render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
})

/**
 * How far each entry is shown, written whole (a document, a `set`) or one
 * entry at a time (a command, as `{ [index]: reveal }`), which leaves the others
 * as the frame left them — so two series moving at once each move their own.
 */
function revealOf(value: readonly number[] | Readonly<Record<number, number>>, previous?: number[]): number[] {
  if (Array.isArray(value)) return value as number[]
  const next = [...(previous ?? [])]
  for (const [index, reveal] of Object.entries(value)) next[Number(index)] = reveal
  return next
}

/**
 * The legend of a chart: a **horizontal-flow row of entries**, one per series, laid out
 * left-to-right with the theme's `itemGap`. Each entry pairs the series label
 * with a rounded colour swatch; only the swatch carries the series colour, the
 * caption reads in the legend's neutral ink.
 *
 * `showSeries`/`hideSeries` flip a series on or off — showing one grows its
 * entry back in at its stable series position, hiding one shrinks it away. So
 * the row only ever shows the currently-enabled series, in series order, and
 * closes the gap when one leaves.
 *
 * This node *is* the row, so the parent places it (centred below the chart) and
 * it hugs its entries.
 */
export const ChartLegend = component2d({
  key: "chartLegend",
  state: {
    ...row,
    series: fresh<ChartSeries[]>(() => []),
    swatches: fresh<Fill[]>(() => []),
    legend: Types.custom<LegendConfig>(DEFAULT_LEGEND),
    /**
     * How far each entry is shown, `0`–`1`. Drives its width, opacity and gap
     * together, so `0` is an entry that takes no room and `1` is one at its
     * natural size.
     *
     * This replaces adding and removing the entry from the row: a command is
     * asked what it looks like at a time, and "is this node a child" is not a
     * value a time can produce. Collapsed-but-present is the same picture reached
     * by a route that *is* a function of `t`.
     */
    reveal: fresh<number[], number[] | Readonly<Record<number, number>>>(() => [], { resolve: revealOf }),
  },
  // This node *is* the row, so the direction is its own answer. It has to be
  // stated — a `Rect` given no flow lays its children out `freeform`, which
  // stacks every entry on the same spot. The gap and padding are the theme's.
  defaults: {
    flow: "horizontal",
    width: "hug",
    height: "hug",
    gap: (state) => state.legend.itemGap,
    padding: (state) => state.legend.padding,
    reveal: (state) => state.series.map((s) => ((s.enabled ?? true) ? 1 : 0)),
  },
  // One entry per series, in series order, every one a child for good: order is
  // fixed rather than depending on which siblings happen to be shown, so an entry
  // always comes back where it belongs.
  children: (state) => {
    const marker = state.legend.markerStyle
    return state.series.map((series, index) =>
      LegendEntry({
        flow: "horizontal",
        gap: 12,
        align: "center",
        width: "hug",
        height: "hug",
        // Bound to the reveal, so showing and hiding is a number moving rather
        // than a child arriving and leaving. The width follows it in `measure`,
        // and the flanking gap closes with the entry rather than snapping.
        opacity: () => state.reveal[index] ?? 0,
        gapScale: () => state.reveal[index] ?? 0,
        shown: () => state.reveal[index] ?? 0,
        children: [
          Text({ ...textOps.styleProps(state.legend.textStyle), text: series.label }),
          Rect({
            width: marker.width,
            height: marker.height,
            cornerRadius: marker.borderRadius,
            fill: state.swatches[index] ?? "white",
            stroke: marker.stroke,
            shadow: marker.shadow,
          }),
        ],
      })
    )
  },
  commands: {
    ...Paint.commands,
    /**
     * Grow series `index`'s entry back in at its series-order position, the
     * siblings sliding over to make room. A reveal tween rather than an animated
     * `addChildAt`: the entry never left, so the whole thing is a function of `t`.
     */
    showSeries: {
      args: { index: Types.number(0, { min: 0, step: 1 }) },
      // An index that is not a series takes its slot and moves nothing.
      run: (timeline, state) => (timeline.args.index in state.series
        ? timeline.animate(revealFrame(state, timeline.args.index, 1, frameEase(timeline)))
        : timeline.wait(timeline.duration)),
    },
    /** Shrink series `index`'s entry away, the gap closing behind it — the mirror of `showSeries`. */
    hideSeries: {
      args: { index: Types.number(0, { min: 0, step: 1 }) },
      run: (timeline, state) => (timeline.args.index in state.series
        ? timeline.animate(revealFrame(state, timeline.args.index, 0, frameEase(timeline)))
        : timeline.wait(timeline.duration)),
    },
    /**
     * Dim every entry but series `index` to {@link SPOTLIGHT_DIM} and bring that
     * one back to full — the legend half of a chart's `spotlightSeries`. Entries
     * stay in place; only their opacity moves, so the row doesn't reflow. Only
     * the entries shown when it is built are touched: a hidden series' entry is
     * left as `hideSeries` left it.
     */
    spotlightSeries: {
      args: { index: Types.number(0, { min: 0, step: 1 }) },
      run: (timeline, state, children) =>
        timeline.together(
          children.flatMap((entry, i) =>
            (state.reveal[i] ?? 0) > 0 ? [entry.to({ opacity: i === timeline.args.index ? 1 : SPOTLIGHT_DIM })] : []
          )
        ),
    },
  },
  measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
  layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
  render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
})

/**
 * One entry's reveal ramping to `target` from where the command finds it — so a
 * hide that follows a show starts where the show left it.
 */
function revealFrame(state: { readonly reveal: readonly number[] }, index: number, target: number, ease: (t: number) => number) {
  const from = state.reveal[index] ?? 0
  return (t: number) => ({ reveal: { [index]: from + (target - from) * ease(t) } })
}

/** Whether series `index` is showing at all on `legend`. */
export function legendShows(legend: { readonly reveal: readonly number[] }, index: number): boolean {
  return (legend.reveal[index] ?? 0) > 0
}

export type ChartLegend = NodeOf<typeof ChartLegend>
