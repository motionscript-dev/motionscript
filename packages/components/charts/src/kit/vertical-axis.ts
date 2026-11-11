import {
  Rect,
  RotatedBox,
  Text,
  Types,
  component2d,
  insetsOps,
  textOps,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"
import { enterBudget } from "@motionscript/sdk/component"

import { asParts, fresh } from "./entries"
import { armed, arrival, arrivalOf, arrivalsEntry, beats, frameEase, type Arrival } from "./motion"
import {
  DEFAULT_Y_AXIS,
  formatMarker,
  type AxisConfig,
  type Range,
} from "./shared"

const SLIDE = 24

/** What a marker's caption reads: the one listed for its value, else its bare reading. */
export function markerCaption(s: { readonly markers: readonly number[]; readonly captions: readonly string[] }, value: number): string {
  const index = s.markers.indexOf(value)
  return (index >= 0 ? s.captions[index] : undefined) ?? formatMarker(value)
}

/**
 * The numeric vertical axis the cartesian charts share: a column of {@link Text}
 * markers, highest at the top, each centred on its value's fraction across
 * `range`. Caption and position are bound, so a rescale tweens live; only the
 * marker count is fixed at construction. The resting state is landed.
 */
export const VerticalAxis = component2d({
  key: "verticalAxis",
  state: {
    range: fresh<Range>(() => [0, 1]),
    /** Tick values in data units, each placed by its fraction across `range`; need not be even or include the ends. */
    markers: fresh<number[]>(() => []),
    /** One caption per marker in its order; a missing one reads as the bare numeric value. */
    captions: fresh<string[]>(() => []),
    axis: Types.custom<AxisConfig>(DEFAULT_Y_AXIS),
    /** Rotated caption in the gutter left of the markers; empty builds no caption node and reserves no gutter. */
    label: "",
    arrivals: arrivalsEntry(),
  },
  // A node made of markers would otherwise hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => {
    const tickPad = insetsOps.resolve(state.axis.tickPadding).right
    const titlePad = insetsOps.resolve(state.axis.titlePadding).right

    const row: Node2D[] = []
    // The row's parent is the axis, whose box the markers are placed in.
    const box = () => (row[0]?.parent as Node2D | null | undefined)?.layoutBounds ?? { width: 0, height: 0 }
    const sorted = () => [...state.markers].sort((a, b) => b - a)
    const fracAt = (value: number | undefined) => {
      if (value === undefined) return 0
      const [min, max] = state.range
      return max <= min ? 0 : (value - min) / (max - min)
    }

    // A slot with no value (the live list is shorter than the column built) renders empty, not its neighbour.
    const markers = state.markers.map((_, i) => {
      const marker: Node2D = new Text({
        ...textOps.styleProps(state.axis.labelStyle),
        text: () => {
          const value = sorted()[i]
          return value === undefined ? "" : markerCaption(state, value)
        },
        y: () => {
          // Node2D space is y-up, so the fraction runs from the bottom.
          const height = box().height
          const centred = (fracAt(sorted()[i]) - 0.5) * height
          // Held inside the top edge for a theme whose markers are taller than the headroom; only the top, since the chart's own axis and legend lie below.
          const limit = height / 2 - marker.layoutBounds.height / 2
          return Math.min(centred, limit)
        },
        opacity: () => arrivalOf(state.arrivals, i).opacity,
        x: () => arrivalOf(state.arrivals, i).shift,
      })
      return marker
    })

    const children: Node2D[] = []
    if (state.label !== "") {
      // Node2D space is y-up and rotation is clockwise, so -90° reads bottom-to-top.
      children.push(
        new RotatedBox({
          angle: -90,
          width: "hug",
          height: "hug",
          children: new Text({
            ...textOps.styleProps(state.axis.titleStyle),
            text: state.label,
            opacity: () => arrivalOf(state.arrivals, "label").opacity,
            x: () => arrivalOf(state.arrivals, "label").shift,
          }),
        })
      )
    }
    children.push(new Rect({ height: "fill", width: "hug", padding: { right: tickPad }, children: markers }))
    row.push(new Rect({ flow: "horizontal", gap: titlePad, children }))
    return asParts(row)
  },
  commands: {
    /**
     * Stagger markers in bottom to top, then the caption. The duration is the
     * whole entrance ({@link enterBudget}). `stagger` is seconds between markers
     * (derived when omitted); `slide` is the starting rightward offset in px.
     */
    enter: {
      args: {
        stagger: Types.custom<number | undefined>(undefined),
        slide: Types.number(SLIDE),
      },
      run: (timeline, state) => {
        const { stagger, slide } = timeline.args
        const count = state.markers.length
        const captioned = state.label !== ""
        const from: Arrival = { opacity: 0, shift: slide }
        const keys = [...state.markers.keys(), ...(captioned ? ["label"] : [])]
        const arm = timeline.animate(() => ({ arrivals: armed(keys, from) }))
        if (count === 0) return arm
        const { step, per, caption } = enterBudget(timeline.duration, count, captioned, stagger)
        const ease = frameEase(timeline)
        // The bottom marker leads, so walk the top-to-bottom column in reverse.
        const markers = state.markers.map((_, i) => ({ at: (count - 1 - i) * step, duration: per, piece: arrival(timeline, i, from, ease) }))
        const label = captioned ? [{ at: (count - 1) * step + per, duration: caption, piece: arrival(timeline, "label", from, ease) }] : []
        return timeline.together([arm, beats(timeline, [...markers, ...label])])
      },
    },
  },
})

export type VerticalAxis = NodeOf<typeof VerticalAxis>
