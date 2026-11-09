import {
  Rect,
  RotatedBox,
  Text,
  Types,
  component2d,
  insetsOps,
  textOps,
  type NodeOf,
  type Node2D,
  type Node2DProps,
} from "@motionscript/sdk"

import { asParts, fresh } from "./entries"
import { armed, arrival, arrivalOf, arrivalsEntry, beats, frameEase, type Arrival } from "./motion"
import {
  DEFAULT_Y_AXIS,
  enterBudget,
  formatMarker,
  type AxisConfig,
  type Range,
} from "./shared"

export interface VerticalAxisProps extends Node2DProps {
  /** `[min, max]` of the vertical scale the markers are positioned within. */
  range: Range
  /**
   * Tick values (in data units) to draw up the axis, each placed by its fraction
   * across {@link VerticalAxisProps.range}. Need not be evenly spaced or include
   * the ends.
   */
  markers: number[]
  /**
   * How each marker is captioned, one per entry of `markers` and in its order.
   * Empty (the default), or short, captions a marker with its bare numeric
   * reading; a chart with a number format on this axis writes them through it.
   */
  captions: string[]
  /** Marker/caption text style, grid stroke, and gutters — see {@link AxisConfig}. */
  axis: AxisConfig
  /**
   * Rotated caption drawn in the gutter to the left of the marker column. Empty
   * string (the default) hides it — no caption node is built and no label gutter
   * is reserved.
   */
  label: string
}

/** How far a marker starts to the right of its slot when it enters, in px. */
const SLIDE = 24

/** How a tick value is captioned — see {@link VerticalAxisProps.captions}. */
export type MarkerLabel = (value: number) => string

/** What a marker's caption reads: the one listed for its value, else its bare reading. */
export function markerCaption(s: { readonly markers: readonly number[]; readonly captions: readonly string[] }, value: number): string {
  const index = s.markers.indexOf(value)
  return (index >= 0 ? s.captions[index] : undefined) ?? formatMarker(value)
}

/**
 * The numeric vertical axis shared by the cartesian charts: a **column of
 * {@link Text} nodes**, one per marker value, running top-to-bottom (highest
 * value at the top). Pure layout — no `Graphics` — so the markers are real text
 * nodes the scene can measure, restyle, or animate individually.
 *
 * Each marker is positioned so its centre lands exactly on its value's fraction
 * across `range` within the axis's filled height, so unevenly-spaced markers
 * land where their values fall. Both the caption and the position are *bound*,
 * not snapshotted: a chart that rescales its axes (see `LineChart.zoomTo`)
 * tweens `range`/`markers` live. Only the marker **count** is fixed at
 * construction.
 *
 * `enter` staggers them in **bottom-to-top**: each marker starts pushed a
 * little to the right and transparent, then fades and slides left into place.
 * The resting state is the landed one, so a chart that is never told to enter
 * still reads as a finished chart.
 */
export const VerticalAxis = component2d({
  key: "verticalAxis",
  state: {
    range: fresh<Range>(() => [0, 1]),
    markers: fresh<number[]>(() => []),
    captions: fresh<string[]>(() => []),
    axis: Types.custom<AxisConfig>(DEFAULT_Y_AXIS),
    label: "",
    arrivals: arrivalsEntry(),
  },
  // A plain node filled its parent; one made of its markers would hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => {
    // Composed from plain entries (range/markers/label), so it's built once here.
    const tickPad = insetsOps.resolve(state.axis.tickPadding).right
    const titlePad = insetsOps.resolve(state.axis.titlePadding).right

    const row: Node2D[] = []
    // The row's parent is the axis: its box is what the markers are placed in.
    const box = () => (row[0]?.parent as Node2D | null | undefined)?.layoutBounds ?? { width: 0, height: 0 }
    /** The live tick values, top → bottom (highest first) — re-read every frame. */
    const sorted = () => [...state.markers].sort((a, b) => b - a)
    /** Tick `i`'s fraction across the live `range`, 0 at the bottom edge. */
    const fracAt = (value: number | undefined) => {
      if (value === undefined) return 0
      const [min, max] = state.range
      return max <= min ? 0 : (value - min) / (max - min)
    }

    // One text node per marker, ordered top → bottom. A slot with no value (the
    // live list is shorter than the column built for it) renders as empty text
    // rather than repeating its neighbour.
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
          // Held inside the axis's top edge — the backstop for a chart whose
          // headroom is smaller than its marker text is tall, which a theme with
          // much larger markers can arrange. Only the top, because what lies
          // below the axis is the chart's own horizontal axis and legend.
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
     * Stagger the markers in bottom to top, then slide the caption in from the
     * right after them. Its first frame arms them all: shifted right by `slide`
     * and transparent.
     *
     * The timeline's duration is the **whole** entrance, not one marker's slide:
     * the stagger and the caption are carved out of it rather than added on top.
     * See {@link enterBudget} for why that distinction matters here.
     *
     * `stagger` is seconds between successive markers (derived when omitted);
     * `slide` is the starting rightward offset in px.
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
        // Bottom marker leads: the column is top → bottom, so walk it in reverse.
        const markers = state.markers.map((_, i) => ({ at: (count - 1 - i) * step, duration: per, piece: arrival(timeline, i, from, ease) }))
        // Once every marker has landed, the caption slides in from the right.
        const label = captioned ? [{ at: (count - 1) * step + per, duration: caption, piece: arrival(timeline, "label", from, ease) }] : []
        return timeline.together([arm, beats(timeline, [...markers, ...label])])
      },
    },
  },
})

export type VerticalAxis = NodeOf<typeof VerticalAxis>
