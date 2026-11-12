import {
  Rect,
  RotatedBox,
  Text,
  Types,
  component2d,
  insetsOps,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"
import { enterBudget } from "@motionscript/sdk/component"

import { boundText } from "./cartesian"
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

/** The gap between an axis's markers and the plot, and between the markers and the caption, read off its config. */
export function axisPads(axis: AxisConfig, side: "top" | "right"): { tick: number; title: number } {
  return { tick: insetsOps.resolve(axis.tickPadding)[side], title: insetsOps.resolve(axis.titlePadding)[side] }
}

/**
 * A column of right-aligned captions beside the plot: `place(i)` is caption
 * `i`'s centre height in the column (y-up), whose height it is handed. The
 * value axis and a horizontal bar chart's category axis are both this column.
 */
export function captionColumn(spec: {
  readonly count: number
  readonly axis: () => AxisConfig
  readonly text: (i: number) => string
  readonly place: (i: number, height: number) => number
  readonly arrivals: () => Readonly<Record<string, Arrival>>
  readonly opacity?: (i: number) => number
  readonly label: string
}): Node2D {
  const pads = () => axisPads(spec.axis(), "right")
  const markers = Array.from({ length: spec.count }, (_, i) => {
    const column = () => (marker.parent as Node2D | null)?.layoutBounds ?? { width: 0, height: 0 }
    const marker: Node2D = new Text({
      ...boundText(() => spec.axis().labelStyle),
      text: () => spec.text(i),
      // Right-aligned against the tick padding: freeform children sit on the content box's centre.
      x: () => (column().width - pads().tick) / 2 - marker.layoutBounds.width / 2 + arrivalOf(spec.arrivals(), i).shift,
      y: () => spec.place(i, column().height),
      opacity: () => arrivalOf(spec.arrivals(), i).opacity * (spec.opacity?.(i) ?? 1),
    })
    return marker
  })
  const children: Node2D[] = []
  if (spec.label !== "") {
    // Node2D space is y-up and rotation is clockwise, so -90° reads bottom-to-top.
    children.push(
      new RotatedBox({
        angle: -90,
        width: "hug",
        height: "hug",
        children: new Text({
          ...boundText(() => spec.axis().titleStyle),
          text: spec.label,
          opacity: () => arrivalOf(spec.arrivals(), "label").opacity,
          x: () => arrivalOf(spec.arrivals(), "label").shift,
        }),
      }) as unknown as Node2D
    )
  }
  children.push(new Rect({ height: "fill", width: "hug", padding: () => ({ right: pads().tick }), children: markers }) as unknown as Node2D)
  return new Rect({ flow: "horizontal", gap: () => pads().title, height: "fill", children }) as unknown as Node2D
}

/**
 * The numeric vertical axis the cartesian charts share: a column of {@link Text}
 * markers, highest at the top, each centred on its value's fraction across
 * `range` and right-aligned against the plot. Caption and position are bound, so
 * a rescale tweens live; only the marker count is fixed at construction. The
 * resting state is landed.
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
    const sorted = () => [...state.markers].sort((a, b) => b - a)
    const fracAt = (value: number | undefined) => {
      if (value === undefined) return 0
      const [min, max] = state.range
      return max <= min ? 0 : (value - min) / (max - min)
    }
    // A slot with no value (the live list is shorter than the column built) renders empty, not its neighbour.
    return asParts([
      captionColumn({
        count: state.markers.length,
        axis: () => state.axis,
        text: (i) => {
          const value = sorted()[i]
          return value === undefined ? "" : markerCaption(state, value)
        },
        place: (i, height) => (fracAt(sorted()[i]) - 0.5) * height,
        arrivals: () => state.arrivals,
        label: state.label,
      }),
    ])
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
