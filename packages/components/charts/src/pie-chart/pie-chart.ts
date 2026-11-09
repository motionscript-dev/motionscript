import {
  Rect,
  Types,
  component2d,
  easeOut,
  type ChildView,
  type DataRecord,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` through the sdk, not core.
  type Node2D,
  type Node2DProps,
  type Timeline,
} from "@motionscript/sdk"

import { asParts, fresh } from "../kit/entries"
import { beats, type Beat } from "../kit/motion"
import { clampUnit } from "../kit/shared"
import { PieLegend } from "./pie-legend"
import { PieRing } from "./pie-ring"
import {
  DEFAULT_PIE_CHART_THEME,
  lerpPieChartTheme,
  resolvePieChartTheme,
  resolvePieSlices,
  type PieChartConfig,
  type PieChartTheme,
  type PieLabelMode,
  type PieLabelPlacement,
  type PieSlice,
} from "./shared"

export interface PieChartProps extends Node2DProps {
  /** One row per slice — a plain record of field name to value. */
  data: DataRecord[]
  /** Key into each row for its slice caption, used on the labels and the legend. */
  categoryField: string
  /** Key into each row for its slice magnitude — the wedge's share of the ring. */
  valueField: string
  /**
   * The chart's visual theme — slice palette, ring geometry, label and centre
   * type, legend. Every branch is optional and deep-merged onto
   * {@link DEFAULT_PIE_CHART_THEME}.
   */
  theme?: PieChartTheme
  /** What the ring's labels say. */
  labelMode?: PieLabelMode
  /** Where they sit: inside their wedge, outside on a leader, or nowhere. */
  labelPlacement?: PieLabelPlacement
  /** Whether the legend column beside the ring is drawn at all. */
  showLegend?: boolean
  /** Gap between the ring and the legend, in px. */
  gap?: number
  /** Text set in the ring's hole — see `revealCenter`. */
  centerLabel?: string
  /** Smaller second line under {@link centerLabel}. */
  centerCaption?: string
  /**
   * Whether the hole's summary is drawn at rest. `true` (the default) is the
   * plain answer; a scene that wants the conclusion to land on a later beat sets
   * this `false` and runs `revealCenter` when it gets there.
   */
  showCenter?: boolean
}

/** What the selection reads: the rows, how they are cut, and the pops the commands move. */
export interface PieChartValues {
  readonly data: DataRecord[]
  readonly categoryField: string
  readonly valueField: string
  readonly theme: PieChartConfig
  readonly pops: number[]
}

/**
 * How `enter` divides its duration: the wedges sweeping in, then the labels and
 * the legend arriving together. Shares of the whole, so they sum to 1.
 */
const SWEEP_SHARE = 0.65
const LABEL_SHARE = 0.35

const SLICE_ARG = Types.number(0, { min: 0, step: 1 })

/** The slices the ring and the legend draw, resolved from the rows and the palette. */
function slicesOf(s: PieChartValues): PieSlice[] {
  return resolvePieSlices(s.data, s.categoryField, s.valueField, s.theme.sliceFills)
}

/** How far slice `index` is pushed out, in `[0, 1]`. */
function popAt(s: PieChartValues, index: number): number {
  return clampUnit(s.pops[index] ?? 0)
}

/** Whether slice `index` is grown out past the ring's rim: past half way, so a slice mid-swell is not yet counted. */
export function isSliceSelected(s: PieChartValues, index: number): boolean {
  return popAt(s, index) > 0.5
}

/**
 * How far each slice is dimmed by the selection, one entry per slice: 1 while
 * nothing is out, and for the selected slice itself; falling toward the theme's
 * `dimOpacity` for the rest in proportion to how far the selection has grown.
 */
function sliceDims(s: PieChartValues): number[] {
  let focus = 0
  for (let i = 0; i < s.data.length; i++) focus = Math.max(focus, popAt(s, i))
  const dim = s.theme.spotlight.dimOpacity
  if (focus <= 0) return s.data.map(() => 1)
  return s.data.map((_, i) => 1 - (1 - clampUnit(dim)) * focus * (1 - popAt(s, i)))
}

type AnyTimeline = Timeline<any, any>

/**
 * Every slice's pop eased from where it is to what `pop` asks for. A move that
 * changes nothing still takes its slot, writing nothing.
 */
function popping(timeline: AnyTimeline, s: PieChartValues, pop: (index: number) => number) {
  const from = s.data.map((_, i) => popAt(s, i))
  const targets = s.data.map((_, i) => clampUnit(pop(i)))
  if (from.every((value, i) => value === targets[i])) return timeline.wait(timeline.duration)
  return timeline.animate((t) => ({ pops: from.map((value, i) => value + (targets[i] - value) * t) }))
}

/** The ring and the legend, found through the chart's children: the last row of them is the one it built. */
function partsOf(children: readonly ChildView[]) {
  for (let i = children.length - 1; i >= 0; i--) {
    const row = children[i]
    const ring = Rect.is(row) ? row.children.find(PieRing.is) : undefined
    if (ring) return { ring, legend: row.children.find(PieLegend.is) ?? null }
  }
  return null
}

/**
 * A pie or donut chart, composed from two parts laid out by a horizontal-flow
 * {@link Rect} — the ring filling whatever the hugging legend leaves, both
 * centred:
 *
 * - {@link PieRing} — the wedges, each sized by its share of the total, with its
 *   label inside its own band or pinned outside on a leader line, and the
 *   summary in the hole.
 * - {@link PieLegend} — a column of swatch-and-caption rows naming each slice.
 *
 * **One mark per row, not per column**: a pie's palette is indexed by row and
 * there is nothing to hide, since dropping a slice would re-cut every other
 * wedge. `selectSlice` and its siblings are what a pie has instead — a slice
 * swells out of the ring and everything else dims behind it.
 *
 * **Resting state is the finished chart**; `enter` arms every part on its first
 * frame. The one exception is the hole's summary, which a scene can hold back
 * with `showCenter: false`, because it is usually the chart's *conclusion*.
 */
export const PieChart = component2d({
  key: "pieChart",
  state: {
    data: fresh<DataRecord[]>(() => []),
    categoryField: "",
    valueField: "",
    theme: Types.custom<PieChartTheme, PieChartConfig>(DEFAULT_PIE_CHART_THEME, { resolve: resolvePieChartTheme, lerp: lerpPieChartTheme }),
    labelMode: Types.custom<PieLabelMode>("percent"),
    labelPlacement: Types.custom<PieLabelPlacement>("leader"),
    gap: 40,
    centerLabel: "",
    centerCaption: "",
    /**
     * How far each slice is pushed out of the ring, `0`–`1` per index. Held here
     * rather than on the ring because two parts read it: the wedges grow out by
     * it, and the legend entries dim by it. Seeded flush, one to a row.
     */
    pops: fresh<number[]>(() => []),
    /** Read as the chart is built: the legend is a part the chart builds or doesn't. */
    showLegend: Types.boolean(true, { animatable: false }),
    /** Read as the chart is built: whether the hole's summary is drawn at rest. */
    showCenter: Types.boolean(true, { animatable: false }),
  },
  defaults: {
    // Its parts fill it; a node made of them would hug them.
    width: "fill",
    height: "fill",
    pops: (state) => slicesOf(state).map(() => 0),
  },
  allowedChildren: [],
  // The slice *structure* (one label and one legend row per row) is read once;
  // the slices themselves, their paint and the selection are bound, so a theme
  // tween re-paints and a `set` of `data` re-cuts the wedges.
  children: (state) => {
    const theme = () => state.theme
    const slices = () => slicesOf(state)
    const parts: Node2D[] = [
      new PieRing({
        width: "fill",
        height: "fill",
        slices,
        ring: () => theme().ring,
        label: () => theme().label,
        centerStyle: () => theme().center,
        labelMode: state.labelMode,
        labelPlacement: state.labelPlacement,
        pops: () => state.pops,
        dimOpacity: () => theme().spotlight.dimOpacity,
        centerLabel: state.centerLabel,
        centerCaption: state.centerCaption,
        centerReveal: state.showCenter === false ? 0 : 1,
      }) as unknown as Node2D,
    ]
    if (state.showLegend !== false) {
      parts.push(
        new PieLegend({
          slices,
          legend: () => theme().legend,
          dims: () => sliceDims(state),
          // The column's spacing is the theme's as the chart was built, like the
          // entries' type and chips.
          gap: state.theme.legend.itemGap / 3,
          padding: state.theme.legend.padding,
        }) as unknown as Node2D
      )
    }
    const row = new Rect({ flow: "horizontal", width: "fill", height: "fill", gap: state.gap, align: "center", children: parts })
    return asParts([row as unknown as Node2D])
  },
  commands: {
    /**
     * Animate the whole chart in: the wedges sweep in clockwise from the theme's
     * `startAngle`, then the labels fade up and the legend staggers in together.
     * Its first frame arms the wedges, the labels and the legend; the hole's
     * summary keeps its own signal. `duration` is the **whole** entrance.
     */
    enter: {
      args: {},
      // Held from the chart's arrival, so it never shows finished ahead of its draw.
      entrance: true,
      easing: easeOut(),
      run: (timeline, _state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const { ring, legend } = parts
        const sweep = timeline.duration * SWEEP_SHARE
        const labels = timeline.duration * LABEL_SHARE
        const at0 = (piece: Beat["piece"]): Beat => ({ at: 0, duration: 0, piece })
        return beats(timeline, [
          at0(ring.to({ growth: 0, labelReveal: 0 })),
          ...(legend ? [at0(legend.run("arm"))] : []),
          { at: 0, duration: sweep, piece: ring.run("sweep") },
          { at: sweep, duration: labels, piece: ring.run("revealLabels") },
          ...(legend ? [{ at: sweep, duration: labels, piece: legend.run("enter") }] : []),
        ])
      },
    },
    /**
     * Fade the hole's summary up. Held out of `enter` on purpose: what sits in a
     * donut's hole is usually the chart's conclusion, so the scene lands it on
     * its own beat. Pair it with `showCenter: false`.
     */
    revealCenter: {
      args: {},
      easing: easeOut(),
      run: (timeline, _state, children) => partsOf(children)?.ring.run("revealCenter") ?? timeline.wait(timeline.duration),
    },
    /** Grow slice `index` out past the ring's rim and dim the rest, leaving any other selected slice where it is. */
    selectSlice: {
      args: { sliceIndex: SLICE_ARG },
      easing: easeOut(),
      run: (timeline, state) => {
        const index = timeline.args.sliceIndex
        return popping(timeline, state, (i) => (i === index ? 1 : popAt(state, i)))
      },
    },
    /** Settle slice `index` back flush with the ring. */
    deselectSlice: {
      args: { sliceIndex: SLICE_ARG },
      easing: easeOut(),
      run: (timeline, state) => {
        const index = timeline.args.sliceIndex
        return popping(timeline, state, (i) => (i === index ? 0 : popAt(state, i)))
      },
    },
    /** Move the focus to slice `index` alone, settling whatever else was out. */
    selectOnlySlice: {
      args: { sliceIndex: SLICE_ARG },
      easing: easeOut(),
      run: (timeline, state) => {
        const index = timeline.args.sliceIndex
        return popping(timeline, state, (i) => (i === index ? 1 : 0))
      },
    },
    /** Settle every slice flush and bring the whole chart back to full. */
    clearSelection: {
      args: {},
      easing: easeOut(),
      run: (timeline, state) => popping(timeline, state, () => 0),
    },
  },
})

export type PieChart = NodeOf<typeof PieChart>
