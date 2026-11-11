import {
  Rect,
  Types,
  clamp,
  component2d,
  easeOut,
  type ChildView,
  type DataRecord,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"

import { asParts, fresh } from "../kit/entries"
import { beats, type AnyTimeline, type Beat } from "../kit/motion"
import { PieLegend } from "./pie-legend"
import { PieRing } from "./pie-ring"
import {
  DEFAULT_PIE_CHART_THEME,
  lerpPieChartTheme,
  resolvePieChartTheme,
  resolvePieSlices,
  selectionFade,
  type PieChartConfig,
  type PieChartTheme,
  type PieLabelMode,
  type PieLabelPlacement,
  type PieSlice,
} from "./shared"

export interface PieChartValues {
  readonly data: DataRecord[]
  readonly categoryField: string
  readonly valueField: string
  readonly theme: PieChartConfig
  readonly pops: number[]
}

/** How `enter` divides its duration: wedges sweeping in, then labels and legend together. Sums to 1. */
const SWEEP_SHARE = 0.65
const LABEL_SHARE = 0.35

const SLICE_ARG = Types.number(0, { min: 0, step: 1 })

function slicesOf(s: PieChartValues): PieSlice[] {
  return resolvePieSlices(s.data, s.categoryField, s.valueField, s.theme.sliceFills)
}

function popAt(s: PieChartValues, index: number): number {
  return clamp(s.pops[index] ?? 0, 0, 1)
}

/** Whether slice `index` is past half way out, so a slice mid-swell is not yet counted. */
export function isSliceSelected(s: PieChartValues, index: number): boolean {
  return popAt(s, index) > 0.5
}

/** Per-slice opacity: 1 while nothing is out and for the selected slice, falling toward `dimOpacity` for the rest as the selection grows. */
function sliceDims(s: PieChartValues): number[] {
  let focus = 0
  for (let i = 0; i < s.data.length; i++) focus = Math.max(focus, popAt(s, i))
  const dim = s.theme.spotlight.dimOpacity
  return s.data.map((_, i) => selectionFade(focus, dim, popAt(s, i)))
}

/** Every slice's pop eased to what `pop` asks for. A move that changes nothing still takes its slot. */
function popping(timeline: AnyTimeline, s: PieChartValues, pop: (index: number) => number) {
  const from = s.data.map((_, i) => popAt(s, i))
  const targets = s.data.map((_, i) => clamp(pop(i), 0, 1))
  if (from.every((value, i) => value === targets[i])) return timeline.wait(timeline.duration)
  return timeline.animate((t) => ({ pops: from.map((value, i) => value + (targets[i] - value) * t) }))
}

/** The ring and legend among the children; the last row is the one the chart built. */
function partsOf(children: readonly ChildView[]) {
  for (let i = children.length - 1; i >= 0; i--) {
    const row = children[i]
    const ring = Rect.is(row) ? row.children.find(PieRing.is) : undefined
    if (ring) return { ring, legend: row.children.find(PieLegend.is) ?? null }
  }
  return null
}

/**
 * A pie or donut chart: a {@link PieRing} filling what the hugging {@link PieLegend}
 * leaves. One mark per row, not per column, and nothing to hide, since dropping
 * a slice would re-cut every other wedge; `selectSlice` and its siblings swell
 * a slice and dim the rest instead.
 *
 * Resting state is the finished chart, except the hole's summary, which
 * `showCenter: false` holds back for `revealCenter`.
 */
export const PieChart = component2d({
  key: "pieChart",
  state: {
    data: fresh<DataRecord[]>(() => []),
    /** Slice caption, used on the labels and the legend. */
    categoryField: "",
    /** Slice magnitude: the wedge's share of the ring. */
    valueField: "",
    theme: Types.custom<PieChartTheme, PieChartConfig>(DEFAULT_PIE_CHART_THEME, { resolve: resolvePieChartTheme, lerp: lerpPieChartTheme }),
    /** What the ring's labels say. */
    labelMode: Types.custom<PieLabelMode>("percent"),
    /** Where they sit: inside their wedge, outside on a leader, or nowhere. */
    labelPlacement: Types.custom<PieLabelPlacement>("leader"),
    /** Gap between the ring and the legend, in px. */
    gap: 40,
    /** Text set in the ring's hole. */
    centerLabel: "",
    /** Smaller second line under `centerLabel`. */
    centerCaption: "",
    /** How far each slice is pushed out, `0`-`1` per index. Here, not on the ring, because the wedges and the legend both read it. */
    pops: fresh<number[]>(() => []),
    /** Read as the chart is built: the legend is a part the chart builds or doesn't. */
    showLegend: Types.boolean(true, { animatable: false }),
    /** Read as the chart is built: whether the hole's summary is drawn at rest. A scene that wants it to land later sets `false` and runs `revealCenter`. */
    showCenter: Types.boolean(true, { animatable: false }),
  },
  defaults: {
    // A node made of parts that fill would otherwise hug them.
    width: "fill",
    height: "fill",
    pops: (state) => slicesOf(state).map(() => 0),
  },
  allowedChildren: [],
  // The structure (a label and legend row per row) is read once; slices, paint and selection are bound, so a theme tween re-paints and a `set` of `data` re-cuts.
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
          // Spacing is fixed as built.
          gap: state.theme.legend.itemGap / 3,
          padding: state.theme.legend.padding,
        }) as unknown as Node2D
      )
    }
    const row = new Rect({ flow: "horizontal", width: "fill", height: "fill", gap: state.gap, align: "center", children: parts })
    return asParts([row as unknown as Node2D])
  },
  commands: {
    /** Wedges sweep in clockwise from `startAngle`, then labels fade up and the legend staggers in. `duration` is the whole entrance; the hole's summary keeps its own signal. */
    enter: {
      args: {},
      // Held from arrival, so it never shows finished ahead of its draw.
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
    /** Fade the hole's summary up. Not part of `enter`: it is usually the conclusion, which a scene lands on its own beat. */
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
