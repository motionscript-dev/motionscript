import {
  Flow,
  Paint,
  Rect,
  Shapes,
  Text,
  Types,
  clamp,
  component2d,
  textOps,
  type NodeOf,
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
import { DEFAULT_LEGEND, type LegendConfig } from "../kit/shared"
import type { PieSlice } from "./shared"

const SLIDE = 16

/**
 * The legend of a {@link PieChart}: a column (it sits beside the ring, in the
 * vertical strip it leaves) of caption-and-swatch entries, one per slice. No
 * show/hide: removing a row would re-cut every other wedge's share. Selection
 * arrives through `dims`.
 */
export const PieLegend = component2d({
  key: "pieLegend",
  state: {
    ...Paint.state,
    ...Flow.state,
    ...Shapes.corners,
    /** One entry per slice, in ring order. */
    slices: fresh<PieSlice[]>(() => []),
    legend: Types.custom<LegendConfig>(DEFAULT_LEGEND),
    /** Per-slice opacity multiplier, the signal that dims the ring, so an entry fades in step with its wedge. Missing reads as 1. */
    dims: fresh<number[]>(() => []),
    arrivals: arrivalsEntry(),
  },
  // The flow must be stated: a `Rect` with none lays children out `freeform`, every caption on top of the last.
  defaults: {
    flow: "vertical",
    align: "centerLeft",
    width: "hug",
    height: "hug",
    gap: (state) => state.legend.itemGap / 3,
    padding: (state) => state.legend.padding,
  },
  // The selection dim rides a wrapper, so the entrance animates the entry's own opacity without the two fighting over one value.
  children: (state) => {
    const marker = state.legend.markerStyle
    return state.slices.map((_, index) =>
      Rect({
        width: "hug",
        height: "hug",
        flow: "freeform",
        opacity: () => clamp(state.dims[index] ?? 1, 0, 1),
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
    /** Every entry shifted right and transparent: what a chart shows ahead of this legend's beat, since `enter` arms only on its first frame. */
    arm: (timeline, state) =>
      timeline.animate(() => ({ arrivals: armed([...state.slices.keys()], { opacity: 0, shift: SLIDE }) })),
    /** Slide and fade entries in from the right, top to bottom. The duration is the whole entrance, the stagger carved out of it. */
    enter: (timeline, state) => {
      const count = state.slices.length
      if (count === 0) return timeline.wait(timeline.duration)
      const from: Arrival = { opacity: 0, shift: SLIDE }
      const arm = timeline.animate(() => ({ arrivals: armed([...state.slices.keys()], from) }))
      // Each gap is a fifth of an entry's move, the axes' rhythm, solved from the budget.
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
