import {
  Rect,
  Text,
  Types,
  component2d,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"
import { enterBudget } from "@motionscript/sdk/component"

import { boundText } from "./cartesian"
import { asParts, fresh } from "./entries"
import { armed, arrival, arrivalOf, arrivalsEntry, beats, frameEase, type Arrival } from "./motion"
import { DEFAULT_X_AXIS, type AxisConfig, type Range } from "./shared"
import { axisPads, markerCaption } from "./vertical-axis"

const SLIDE = 24

/**
 * A row of {@link Text} markers under the plot, the mirror of `VerticalAxis`
 * (bound text and positions, landed resting state). Markers are placed by value
 * across the range, whatever they say: `2026-03` sits three months along, not
 * three slots along, unlike a bar chart's category axis. An end marker may hang
 * past the row by `overhang` px on either side, then is held inside it.
 */
export const HorizontalAxis = component2d({
  key: "horizontalAxis",
  state: {
    range: fresh<Range>(() => [0, 1]),
    /** Tick values in data units. */
    markers: fresh<number[]>(() => []),
    /** One caption per marker in its order; a missing one reads as the bare numeric value. */
    captions: fresh<string[]>(() => []),
    axis: Types.custom<AxisConfig>(DEFAULT_X_AXIS),
    /** Caption centred beneath the markers; empty hides it. */
    label: "",
    /** How far past the row's left and right ends a marker may reach, in px. */
    overhang: Types.custom<{ left: number; right: number }>({ left: 0, right: 0 }),
    arrivals: arrivalsEntry(),
  },
  // A node made of markers would otherwise hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => {
    const pads = () => axisPads(state.axis, "top")
    const sorted = () => [...state.markers].sort((a, b) => a - b)
    const fracAt = (value: number | undefined) => {
      if (value === undefined) return 0
      const [min, max] = state.range
      return max <= min ? 0 : (value - min) / (max - min)
    }

    const markers = state.markers.map((_, i) => {
      const width = () => (marker.parent as Node2D | null)?.layoutBounds.width ?? 0
      const marker: Node2D = new Text({
        ...boundText(() => state.axis.labelStyle),
        text: () => {
          const value = sorted()[i]
          return value === undefined ? "" : markerCaption(state, value)
        },
        x: () => {
          const w = width()
          const half = marker.layoutBounds.width / 2
          const centred = (fracAt(sorted()[i]) - 0.5) * w
          return Math.max(-w / 2 - state.overhang.left + half, Math.min(w / 2 + state.overhang.right - half, centred))
        },
        opacity: () => arrivalOf(state.arrivals, i).opacity,
        y: () => arrivalOf(state.arrivals, i).shift,
      })
      return marker
    })

    const children: Node2D[] = [
      new Rect({ width: "fill", height: "hug", padding: () => ({ top: pads().tick }), children: markers }) as unknown as Node2D,
    ]
    if (state.label !== "") {
      children.push(
        new Text({
          ...boundText(() => state.axis.titleStyle),
          text: state.label,
          opacity: () => arrivalOf(state.arrivals, "label").opacity,
          y: () => arrivalOf(state.arrivals, "label").shift,
        }) as unknown as Node2D
      )
    }
    return asParts([new Rect({ flow: "vertical", gap: () => pads().title, height: "hug", width: "fill", children }) as unknown as Node2D])
  },
  commands: {
    /** Stagger markers in left to right, then the caption. The duration is the whole entrance ({@link enterBudget}). */
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
        const markers = state.markers.map((_, i) => ({ at: i * step, duration: per, piece: arrival(timeline, i, from, ease) }))
        const label = captioned ? [{ at: (count - 1) * step + per, duration: caption, piece: arrival(timeline, "label", from, ease) }] : []
        return timeline.together([arm, beats(timeline, [...markers, ...label])])
      },
    },
  },
})

export type HorizontalAxis = NodeOf<typeof HorizontalAxis>
