import {
  Rect,
  Text,
  Types,
  clamp,
  component2d,
  insetsOps,
  textOps,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"
import { enterBudget } from "@motionscript/sdk/component"

import { asParts, fresh } from "../kit/entries"
import { armed, arrival, arrivalOf, arrivalsEntry, beats, frameEase, type Arrival } from "../kit/motion"
import {
  DEFAULT_X_AXIS,
  type AxisConfig,
} from "../kit/shared"

const SLIDE = 24

/**
 * The categorical axis of a {@link BarChart}: one {@link Text} caption per row,
 * centred on its slot. Not folded into `HorizontalAxis`, which places markers by
 * value on a scale; this divides its width into equal slots. It is laid out to
 * exactly the plot's width, so each caption lands under its columns with neither
 * side told about the other. The resting state is landed.
 */
export const CategoryAxis = component2d({
  key: "categoryAxis",
  state: {
    categories: fresh<string[]>(() => []),
    axis: Types.custom<AxisConfig>(DEFAULT_X_AXIS),
    label: "",
    /** Per-category opacity multiplier, so the caption under a dimmed column dims with it. Missing reads as 1. */
    dims: fresh<number[]>(() => []),
    arrivals: arrivalsEntry(),
  },
  // A node made of captions would otherwise hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => {
    const tickPad = insetsOps.resolve(state.axis.tickPadding).top
    const titlePad = insetsOps.resolve(state.axis.titlePadding).top

    const column: Node2D[] = []
    // The column's parent is the axis: its box is what the slots divide.
    const width = () => (column[0]?.parent as Node2D | null | undefined)?.layoutBounds.width ?? 0
    const slotCenter = (index: number) => {
      const n = state.categories.length
      if (n <= 0) return 0
      return -width() / 2 + (width() / n) * (index + 0.5)
    }

    // The spotlight dim sits on a hug box around each caption, so the entrance animates the text's own opacity without the two fighting over one value.
    const slots = state.categories.map((caption, i) =>
      new Rect({
        width: "hug",
        height: "hug",
        flow: "freeform",
        opacity: () => clamp(state.dims[i] ?? 1, 0, 1),
        x: () => slotCenter(i),
        children: [
          new Text({
            ...textOps.styleProps(state.axis.labelStyle),
            text: caption,
            opacity: () => arrivalOf(state.arrivals, i).opacity,
            y: () => arrivalOf(state.arrivals, i).shift,
          }),
        ],
      })
    )

    const children: Node2D[] = [new Rect({ width: "fill", height: "hug", padding: { top: tickPad }, children: slots })]
    if (state.label !== "") {
      children.push(
        new Text({
          ...textOps.styleProps(state.axis.titleStyle),
          text: state.label,
          opacity: () => arrivalOf(state.arrivals, "label").opacity,
          y: () => arrivalOf(state.arrivals, "label").shift,
        })
      )
    }

    column.push(new Rect({ flow: "vertical", gap: titlePad, height: "hug", width: "fill", children }))
    return asParts(column)
  },
  commands: {
    /**
     * Slide and fade captions in left to right, then the title. The duration is
     * the whole entrance ({@link enterBudget}). `stagger` is seconds between
     * captions (derived when omitted); `slide` is the starting offset in px.
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
        const lastCaptionEnds = (count - 1) * step + per
        const captions = state.categories.map((_, i) => ({ at: i * step, duration: per, piece: arrival(timeline, i, from, ease) }))
        const label = captioned ? [{ at: lastCaptionEnds, duration: caption, piece: arrival(timeline, "label", from, ease) }] : []
        return timeline.together([arm, beats(timeline, [...captions, ...label])])
      },
    },
  },
})

export type CategoryAxis = NodeOf<typeof CategoryAxis>
