import {
  Flow,
  Paint,
  Rect,
  Shapes,
  Text,
  Types,
  component2d,
  type Fill,
  type NodeOf,
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

import { boundText } from "./cartesian"
import { fresh } from "./entries"
import { frameEase } from "./motion"
import {
  DEFAULT_LEGEND,
  SPOTLIGHT_DIM,
  type ChartSeries,
  type LegendConfig,
} from "./shared"

const row = { ...Paint.state, ...Flow.state, ...Shapes.corners }

/**
 * One legend entry, hugging its swatch and caption; `shown` scales its length
 * along the legend (`along`) from nothing. The length is measured from the
 * content at any reveal, so a frame never depends on the entry once having been
 * fully shown.
 */
const LegendEntry = component2d({
  key: "legendEntry",
  state: { ...row, shown: Types.number(1), along: Types.oneOf(["horizontal", "vertical"] as const) },
  commands: { ...Paint.commands },
  measure: (measurer, state, children) => {
    const size = Flow.measure(measurer, state, children, Paint.inset(state))
    if (state.shown >= 1) return size
    return state.along === "vertical" ? { ...size, height: state.shown * size.height } : { ...size, width: state.shown * size.width }
  },
  layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
  render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
})

/** Written whole, or one entry at a time as `{ [index]: reveal }`, which leaves the others as the frame left them so two series can move at once. */
function revealOf(value: readonly number[] | Readonly<Record<number, number>>, previous?: number[]): number[] {
  if (Array.isArray(value)) return value as number[]
  const next = [...(previous ?? [])]
  for (const [index, reveal] of Object.entries(value)) next[Number(index)] = reveal
  return next
}

/**
 * A chart's legend: one entry per series, a colour swatch then its caption, in
 * a row (`flow: "horizontal"`) or a column (`"vertical"`, for a legend beside
 * the plot). This node is the row, so the parent places it.
 */
export const ChartLegend = component2d({
  key: "chartLegend",
  state: {
    ...row,
    series: fresh<ChartSeries[]>(() => []),
    /** Swatch colour by series index, resolved by the chart; a missing entry is white. */
    swatches: fresh<Fill[]>(() => []),
    legend: Types.custom<LegendConfig>(DEFAULT_LEGEND),
    /**
     * How far each entry is shown, `0`-`1`, driving its length, opacity and gap
     * together. Entries are never added or removed: "is this node a child" is not
     * a function of time, while collapsed-but-present is.
     */
    reveal: fresh<number[], number[] | Readonly<Record<number, number>>>(() => [], { resolve: revealOf }),
  },
  // The flow must be stated: a `Rect` with none lays children out `freeform`, stacking every entry on one spot.
  defaults: {
    flow: "horizontal",
    width: "hug",
    height: "hug",
    gap: (state) => (state.flow === "vertical" ? Math.round(state.legend.itemGap * 0.4) : state.legend.itemGap),
    padding: (state) => state.legend.padding,
    align: (state) => (state.flow === "vertical" ? "centerLeft" : "center"),
    reveal: (state) => state.series.map((s) => ((s.enabled ?? true) ? 1 : 0)),
  },
  // Every entry stays a child, so one always comes back where it belongs.
  children: (state) => {
    const marker = () => state.legend.markerStyle
    const along = state.flow === "vertical" ? "vertical" : "horizontal"
    return state.series.map((series, index) =>
      LegendEntry({
        flow: "horizontal",
        gap: () => Math.round(((state.legend.textStyle.fontSize as number | undefined) ?? 24) * 0.45),
        align: "center",
        width: "hug",
        height: "hug",
        along,
        // The length follows the reveal in `measure`, and the flanking gap closes with the entry.
        opacity: () => state.reveal[index] ?? 0,
        gapScale: () => state.reveal[index] ?? 0,
        shown: () => state.reveal[index] ?? 0,
        children: [
          Rect({
            width: () => marker().width,
            height: () => marker().height,
            cornerRadius: () => marker().borderRadius,
            fill: () => state.swatches[index] ?? "white",
            stroke: () => marker().stroke,
            shadow: () => marker().shadow,
          }),
          Text({ ...boundText(() => state.legend.textStyle), text: series.label }),
        ],
      })
    )
  },
  commands: {
    ...Paint.commands,
    /** Grow series `index`'s entry back in at its position, the siblings sliding over. */
    showSeries: {
      args: { index: Types.number(0, { min: 0, step: 1 }) },
      // An index that is not a series takes its slot and moves nothing.
      run: (timeline, state) => (timeline.args.index in state.series
        ? timeline.animate(revealFrame(state, timeline.args.index, 1, frameEase(timeline)))
        : timeline.wait(timeline.duration)),
    },
    /** The mirror of `showSeries`. */
    hideSeries: {
      args: { index: Types.number(0, { min: 0, step: 1 }) },
      run: (timeline, state) => (timeline.args.index in state.series
        ? timeline.animate(revealFrame(state, timeline.args.index, 0, frameEase(timeline)))
        : timeline.wait(timeline.duration)),
    },
    /** Dim every entry but `index` to {@link SPOTLIGHT_DIM}, in place. A hidden series' entry is left as `hideSeries` left it. */
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

/** One entry's reveal ramping to `target` from where the command finds it, so a hide after a show starts where the show left it. */
function revealFrame(state: { readonly reveal: readonly number[] }, index: number, target: number, ease: (t: number) => number) {
  const from = state.reveal[index] ?? 0
  return (t: number) => ({ reveal: { [index]: from + (target - from) * ease(t) } })
}

export type ChartLegend = NodeOf<typeof ChartLegend>
