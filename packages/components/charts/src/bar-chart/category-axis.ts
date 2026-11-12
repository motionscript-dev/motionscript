import {
  Rect,
  Text,
  Types,
  clamp,
  component2d,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"
import { enterBudget } from "@motionscript/sdk/component"

import { boundText } from "../kit/cartesian"
import { asParts, fresh } from "../kit/entries"
import { armed, arrival, arrivalOf, arrivalsEntry, beats, frameEase, type Arrival } from "../kit/motion"
import { DEFAULT_X_AXIS, type AxisConfig } from "../kit/shared"
import { axisPads, captionColumn } from "../kit/vertical-axis"

const SLIDE = 24

/** Slot `index`'s centre along a run of `length` px divided into `count` equal slots, first slot at `-length / 2`. */
export function slotCentre(index: number, count: number, length: number): number {
  return count <= 0 ? 0 : -length / 2 + (length / count) * (index + 0.5)
}

/**
 * The categorical axis of a {@link BarChart}: one {@link Text} caption per row,
 * centred on its slot. `horizontal` is a row under the plot, first category on
 * the left; `vertical` a right-aligned column beside it, first category at the
 * top. It is laid out to exactly the plot's length, so each caption lands by its
 * bars with neither side told about the other. The resting state is landed.
 */
export const CategoryAxis = component2d({
  key: "categoryAxis",
  state: {
    categories: fresh<string[]>(() => []),
    axis: Types.custom<AxisConfig>(DEFAULT_X_AXIS),
    label: "",
    orientation: Types.oneOf(["horizontal", "vertical"] as const),
    /** Per-category opacity multiplier, so the caption by a dimmed bar dims with it. Missing reads as 1. */
    dims: fresh<number[]>(() => []),
    arrivals: arrivalsEntry(),
  },
  // A node made of captions would otherwise hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => {
    const n = state.categories.length
    const dim = (i: number) => clamp(state.dims[i] ?? 1, 0, 1)
    if (state.orientation === "vertical") {
      return asParts([
        captionColumn({
          count: n,
          axis: () => state.axis,
          text: (i) => state.categories[i] ?? "",
          // y-up: the first category takes the top slot.
          place: (i, height) => -slotCentre(i, state.categories.length, height),
          arrivals: () => state.arrivals,
          opacity: dim,
          label: state.label,
        }),
      ])
    }

    const pads = () => axisPads(state.axis, "top")
    // The spotlight dim sits on a hug box around each caption, so the entrance animates the text's own opacity without the two fighting over one value.
    const captions = state.categories.map((caption, i) => {
      const slot: Node2D = new Rect({
        width: "hug",
        height: "hug",
        flow: "freeform",
        opacity: () => dim(i),
        x: () => slotCentre(i, state.categories.length, (slot.parent as Node2D | null)?.layoutBounds.width ?? 0),
        children: [
          new Text({
            ...boundText(() => state.axis.labelStyle),
            text: caption,
            opacity: () => arrivalOf(state.arrivals, i).opacity,
            y: () => arrivalOf(state.arrivals, i).shift,
          }),
        ],
      }) as unknown as Node2D
      return slot
    })
    const children: Node2D[] = [new Rect({ width: "fill", height: "hug", padding: () => ({ top: pads().tick }), children: captions }) as unknown as Node2D]
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
    /**
     * Slide and fade captions in, first category first, then the title. The
     * duration is the whole entrance ({@link enterBudget}). `stagger` is seconds
     * between captions (derived when omitted); `slide` is the starting offset in px.
     */
    enter: {
      args: {
        stagger: Types.custom<number | undefined>(undefined),
        slide: Types.number(SLIDE),
      },
      run: (timeline, state) => {
        const { stagger, slide } = timeline.args
        const count = state.categories.length
        const captioned = state.label !== ""
        const from: Arrival = { opacity: 0, shift: slide }
        const keys = [...state.categories.keys(), ...(captioned ? ["label"] : [])]
        const arm = timeline.animate(() => ({ arrivals: armed(keys, from) }))
        if (count === 0) return arm
        const { step, per, caption } = enterBudget(timeline.duration, count, captioned, stagger)
        const ease = frameEase(timeline)
        const captions = state.categories.map((_, i) => ({ at: i * step, duration: per, piece: arrival(timeline, i, from, ease) }))
        const label = captioned ? [{ at: (count - 1) * step + per, duration: caption, piece: arrival(timeline, "label", from, ease) }] : []
        return timeline.together([arm, beats(timeline, [...captions, ...label])])
      },
    },
  },
})

export type CategoryAxis = NodeOf<typeof CategoryAxis>
