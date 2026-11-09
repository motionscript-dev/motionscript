import {
  Rect,
  Text,
  Types,
  component2d,
  insetsOps,
  textOps,
  type NodeOf,
  type Node2D,
  type Node2DProps,
} from "@motionscript/sdk"

import { asParts, fresh } from "../kit/entries"
import { armed, arrival, arrivalOf, arrivalsEntry, beats, frameEase, type Arrival } from "../kit/motion"
import {
  DEFAULT_X_AXIS,
  clampUnit,
  enterBudget,
  type AxisConfig,
} from "../kit/shared"

export interface CategoryAxisProps extends Node2DProps {
  /** One caption per category slot, left to right — the chart's rows, in order. */
  categories: string[]
  /** Caption/title text style and gutters — see {@link AxisConfig}. */
  axis: AxisConfig
  /**
   * Caption drawn centred in the gutter beneath the category row. Empty string
   * (the default) hides it.
   */
  label: string
  /**
   * Per-category opacity multiplier — how the chart's category spotlight reaches
   * the captions, so the name under a dimmed column dims with it. Missing
   * entries read as 1.
   */
  dims: number[]
}

/** How far a caption starts above its slot when it enters, in px. */
const SLIDE = 24

/**
 * The **categorical** horizontal axis of a {@link BarChart}: a row of
 * {@link Text} captions, one per row of the data, each centred on its slot
 * beneath the baseline.
 *
 * Not a variant of the line chart's `HorizontalAxis` and deliberately not
 * folded into it: that axis places markers by *value* across a numeric range,
 * this one divides its width into equal slots and centres a name in each. The
 * two look alike on screen and share nothing underneath — one reads a scale,
 * the other counts rows.
 *
 * The slot arithmetic is the same as the plot's, because this node is laid out
 * to exactly the plot's width (the chart reserves the axis gutter with an
 * invisible twin of the value axis, as the line chart does), so a caption lands
 * under the columns it names without either side being told about the other.
 *
 * `enter` staggers the captions in left-to-right, each lifted a little above
 * its slot and transparent; the resting state is the landed one, so a chart
 * that is never told to enter still reads as finished.
 */
export const CategoryAxis = component2d({
  key: "categoryAxis",
  state: {
    categories: fresh<string[]>(() => []),
    axis: Types.custom<AxisConfig>(DEFAULT_X_AXIS),
    label: "",
    dims: fresh<number[]>(() => []),
    arrivals: arrivalsEntry(),
  },
  // A plain node filled its parent; one made of its captions would hug them.
  defaults: { width: "fill", height: "fill" },
  children: (state) => {
    const tickPad = insetsOps.resolve(state.axis.tickPadding).top
    const titlePad = insetsOps.resolve(state.axis.titlePadding).top

    const column: Node2D[] = []
    // The column's parent is the axis: its box is what the slots divide.
    const width = () => (column[0]?.parent as Node2D | null | undefined)?.layoutBounds.width ?? 0
    /** Centre x of slot `i`, in the node's centred space. */
    const slotCenter = (index: number) => {
      const n = state.categories.length
      if (n <= 0) return 0
      return -width() / 2 + (width() / n) * (index + 0.5)
    }

    // Each caption sits in a hug box carrying the spotlight dim, so the
    // entrance can animate the text's own opacity without the two fighting over
    // one value — opacity multiplies down the tree, which is exactly the
    // composition wanted here.
    const slots = state.categories.map((caption, i) =>
      new Rect({
        width: "hug",
        height: "hug",
        flow: "freeform",
        opacity: () => clampUnit(state.dims[i] ?? 1),
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
     * Slide + fade every caption in from above, staggered left-to-right, then
     * bring the title down behind them. Its first frame arms them all: lifted
     * by `slide` and transparent.
     *
     * The timeline's duration is the **whole** entrance — the stagger and the
     * title are carved out of it rather than added on top. See {@link enterBudget}.
     *
     * `stagger` is seconds between successive captions (derived when omitted);
     * `slide` is the starting upward offset in px (node space is y-up, so a
     * positive start slides *down* into place).
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
