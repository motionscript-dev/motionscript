import {
  Flow,
  Paint,
  Rect,
  Shapes,
  Text,
  Types,
  component2d,
  textOps,
  type NodeOf,
  type RectProps,
  // Named so the column's emitted type reaches the Rect surface it spreads through the sdk, not core.
  type Alignment as _Alignment,
  type CornerRadiusResolved as _CornerRadiusResolved,
  type CornerStyleResolved as _CornerStyleResolved,
  type Fill as _Fill,
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

import { fresh } from "../kit/entries"
import { armed, arrival, arrivalOf, arrivalsEntry, beats, frameEase, type Arrival } from "../kit/motion"
import {
  DEFAULT_LEGEND,
  clampUnit,
  type LegendConfig,
} from "../kit/shared"
import type { PieSlice } from "./shared"

export interface PieLegendProps extends RectProps {
  /** One entry per slice, in ring order. */
  slices: PieSlice[]
  /** Padding, caption style, gaps, and swatch geometry — see {@link LegendConfig}. */
  legend: LegendConfig
  /**
   * Per-slice opacity multiplier, by index — the same signal that dims the ring,
   * so an entry fades in step with the wedge it names. Missing entries read as 1.
   */
  dims: number[]
}

/** How far an entry starts to the right of its slot when it enters, in px. */
const SLIDE = 16

/**
 * The legend of a {@link PieChart}: a **vertical-flow column** of entries, one per
 * slice, each pairing the slice's caption with its colour swatch.
 *
 * A column rather than the cartesian charts' row, because it sits *beside* the
 * ring rather than beneath the plot — a pie is as tall as it is wide, so the
 * space it leaves over is a vertical strip. It is otherwise the same entry: the
 * swatch carries the colour, the caption reads in the legend's neutral ink, and
 * both take the shared {@link LegendConfig}.
 *
 * There is no show/hide here. A pie's marks are its *rows*, and a row that
 * shouldn't be in the chart shouldn't be in the table — removing one would
 * silently re-cut every other wedge's share, which is a different chart rather
 * than the same chart with something hidden. Selection is what a pie has
 * instead, and it arrives through {@link PieLegendProps.dims}.
 */
export const PieLegend = component2d({
  key: "pieLegend",
  state: {
    ...Paint.state,
    ...Flow.state,
    ...Shapes.corners,
    slices: fresh<PieSlice[]>(() => []),
    legend: Types.custom<LegendConfig>(DEFAULT_LEGEND),
    dims: fresh<number[]>(() => []),
    arrivals: arrivalsEntry(),
  },
  // A column, for the reason `ChartLegend` gives for its row: a `Rect` given no
  // flow lays its children out `freeform`, every caption on top of the last.
  defaults: {
    flow: "vertical",
    align: "centerLeft",
    width: "hug",
    height: "hug",
    gap: (state) => state.legend.itemGap / 3,
    padding: (state) => state.legend.padding,
  },
  // One entry per slice, ordered top → bottom. The selection dim rides a wrapper
  // rather than the entry itself, so the entrance can animate the entry's own
  // opacity without the two fighting over one value — opacity multiplies down
  // the tree, which is exactly the composition wanted here.
  children: (state) => {
    const marker = state.legend.markerStyle
    return state.slices.map((_, index) =>
      Rect({
        width: "hug",
        height: "hug",
        flow: "freeform",
        opacity: () => clampUnit(state.dims[index] ?? 1),
        children: [
          Rect({
            flow: "horizontal",
            gap: 12,
            align: "center",
            width: "hug",
            height: "hug",
            opacity: () => arrivalOf(state.arrivals, index).opacity,
            x: () => arrivalOf(state.arrivals, index).shift,
            children: [
              Rect({
                width: marker.height,
                height: marker.height,
                cornerRadius: marker.borderRadius,
                fill: () => state.slices[index]?.fill ?? "white",
                stroke: marker.stroke,
                shadow: marker.shadow,
              }),
              Text({
                ...textOps.styleProps(state.legend.textStyle),
                text: () => state.slices[index]?.category ?? "",
              }),
            ],
          }),
        ],
      })
    )
  },
  commands: {
    ...Paint.commands,
    /**
     * Every entry at its pre-entrance state, shifted right and transparent: what
     * a chart shows ahead of this legend's own beat in its entrance, since
     * `enter` arms the entries only on its first frame.
     */
    arm: (timeline, state) =>
      timeline.animate(() => ({ arrivals: armed([...state.slices.keys()], { opacity: 0, shift: SLIDE }) })),
    /**
     * Slide + fade every entry in from the right, staggered top-to-bottom. Its
     * first frame arms them all: shifted right and transparent.
     *
     * The timeline's duration is the **whole** entrance: the stagger is carved
     * out of it rather than added on top, so the command takes exactly the time
     * the timeline laid out for it.
     */
    enter: (timeline, state) => {
      const count = state.slices.length
      if (count === 0) return timeline.wait(timeline.duration)
      const from: Arrival = { opacity: 0, shift: SLIDE }
      const arm = timeline.animate(() => ({ arrivals: armed([...state.slices.keys()], from) }))
      // Each gap is a fifth of an entry's own move, the rhythm the axes use;
      // solved for from the budget rather than added to it.
      const per = timeline.duration / (1 + Math.max(0, count - 1) / 5)
      const step = per / 5
      const ease = frameEase(timeline)
      const entries = state.slices.map((_, i) => ({ at: i * step, duration: per, piece: arrival(timeline, i, from, ease) }))
      return timeline.together([arm, beats(timeline, entries)])
    },
  },
  measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
  layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
  render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
})

export type PieLegend = NodeOf<typeof PieLegend>
