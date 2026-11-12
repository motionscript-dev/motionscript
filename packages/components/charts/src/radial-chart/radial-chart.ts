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
  type Fill as _Fill,
  type FillResolved as _FillResolved,
} from "@motionscript/sdk"

import { SERIES_ARG, asParts, fresh } from "../kit/entries"
import { beats, type AnyTimeline, type Beat } from "../kit/motion"
import { CHART_STYLE_FAMILY, CHART_STYLE_PRESETS } from "../kit/style"
import { PieLegend } from "../kit/pie-legend"
import { PIE_SPOTLIGHT_DIM, selectionFade } from "../kit/polar"
import { RadialRings } from "./radial-rings"
import {
  RADIAL_STYLE_GROUPS,
  centerOf,
  legendOf,
  marksOf,
  resolveRadialRows,
  ringLabelOf,
  type RadialRow,
  type RadialStyle,
} from "./shared"

export interface RadialChartValues {
  readonly data: DataRecord[]
  readonly categoryField: string
  readonly valueField: string
  readonly max: number
  readonly style: RadialStyle
  readonly pops: number[]
}

/** How `enter` divides its duration: rings sweeping in, then captions and legend together. Sums to 1. */
const SWEEP_SHARE = 0.7
const LABEL_SHARE = 0.3

function rowsOf(s: RadialChartValues): RadialRow[] {
  return resolveRadialRows(s.data, s.categoryField, s.valueField, s.style)
}

function popAt(s: RadialChartValues, index: number): number {
  return clamp(s.pops[index] ?? 0, 0, 1)
}

/** Per-row opacity for the legend: 1 while nothing is selected and for the selected ring, falling toward the dim for the rest. */
function ringDims(s: RadialChartValues): number[] {
  let focus = 0
  for (let i = 0; i < s.data.length; i++) focus = Math.max(focus, popAt(s, i))
  return s.data.map((_, i) => selectionFade(focus, RING_DIM, popAt(s, i)))
}

const RING_DIM = Math.max(PIE_SPOTLIGHT_DIM, 0.25)

function popping(timeline: AnyTimeline, s: RadialChartValues, pop: (index: number) => number) {
  const from = s.data.map((_, i) => popAt(s, i))
  const targets = s.data.map((_, i) => clamp(pop(i), 0, 1))
  if (from.every((value, i) => value === targets[i])) return timeline.wait(timeline.duration)
  return timeline.animate((t) => ({ pops: from.map((value, i) => value + (targets[i] - value) * t) }))
}

/** The rings and legend among the children; the last row is the one the chart built. */
function partsOf(children: readonly ChildView[]) {
  for (let i = children.length - 1; i >= 0; i--) {
    const row = children[i]
    const rings = Rect.is(row) ? row.children.find(RadialRings.is) : undefined
    if (rings) return { rings, legend: row.children.find(PieLegend.is) ?? null }
  }
  return null
}

/**
 * A radial bar chart: one concentric ring per row, the first row outermost,
 * each an arc from `startAngle` sweeping `value / max` of `sweep` degrees.
 * Rows are the marks and none can be hidden; `selectRing` thickens a ring and
 * dims the rest.
 */
export const RadialChart = component2d({
  key: "radialChart",
  state: {
    data: fresh<DataRecord[]>(() => [], { kind: "dataset" }),
    /** Ring caption, used on the ring labels and the legend. */
    categoryField: "",
    /** Ring magnitude: the arc's share of the full sweep. */
    valueField: "",
    /** The value a full sweep stands for. 0 lets the largest value fill its ring. */
    max: Types.number(0, { min: 0, step: 1 }),
    style: Types.style(CHART_STYLE_FAMILY, RADIAL_STYLE_GROUPS, { presets: CHART_STYLE_PRESETS }),
    /** Gap between the rings and the legend, in px. */
    gap: 40,
    /** Text set in the centre hole. */
    centerLabel: "",
    /** Smaller second line under `centerLabel`. */
    centerCaption: "",
    /** How far each ring is emphasised, `0`-`1` per index. Here because the rings and the legend both read it. */
    pops: fresh<number[]>(() => []),
    /** Read as the chart is built: whether the centre summary is drawn at rest. A scene that wants it to land later sets `false` and runs `revealCenter`. */
    showCenter: Types.boolean(true, { animatable: false }),
  },
  defaults: {
    width: "fill",
    height: "fill",
    pops: (state) => state.data.map(() => 0),
  },
  allowedChildren: [],
  children: (state) => {
    const style = () => state.style
    const rows = () => rowsOf(state)
    const parts: Node2D[] = [
      new RadialRings({
        width: "fill",
        height: "fill",
        rows,
        max: () => state.max,
        marks: () => marksOf(style()),
        label: () => ringLabelOf(style()),
        centerStyle: () => centerOf(style()),
        trackFill: () => style().gridColor,
        ringLabels: () => style().ringLabels,
        pops: () => state.pops,
        dimOpacity: RING_DIM,
        centerLabel: state.centerLabel,
        centerCaption: state.centerCaption,
        centerReveal: state.showCenter === false ? 0 : 1,
      }) as unknown as Node2D,
    ]
    const position = state.style.legend
    if (position !== "none") {
      const side = position === "right"
      const config = legendOf(state.style)
      const legend = new PieLegend({
        slices: rows,
        legend: () => legendOf(style()),
        dims: () => ringDims(state),
        flow: side ? "vertical" : "horizontal",
        align: "center",
        gap: side ? config.itemGap / 3 : config.itemGap,
        padding: 0,
      }) as unknown as Node2D
      if (position === "top") parts.unshift(legend)
      else parts.push(legend)
    }
    const row = new Rect({
      flow: position === "right" || position === "none" ? "horizontal" : "vertical",
      width: "fill",
      height: "fill",
      gap: state.gap,
      padding: 24,
      align: "center",
      fill: () => state.style.background,
      children: parts,
    })
    return asParts([row as unknown as Node2D])
  },
  commands: {
    /** Rings sweep in from `startAngle`, outer ring first, then captions fade up and the legend staggers in. `duration` is the whole entrance; the centre summary keeps its own signal. */
    enter: {
      args: {},
      entrance: true,
      easing: easeOut(),
      run: (timeline, _state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const { rings, legend } = parts
        const sweep = timeline.duration * SWEEP_SHARE
        const labels = timeline.duration * LABEL_SHARE
        const at0 = (piece: Beat["piece"]): Beat => ({ at: 0, duration: 0, piece })
        return beats(timeline, [
          at0(rings.to({ growth: 0, labelReveal: 0 })),
          ...(legend ? [at0(legend.run("arm"))] : []),
          { at: 0, duration: sweep, piece: rings.run("sweep") },
          { at: sweep, duration: labels, piece: rings.run("revealLabels") },
          ...(legend ? [{ at: sweep, duration: labels, piece: legend.run("enter") }] : []),
        ])
      },
    },
    /** Fade the centre summary up. Not part of `enter`: it is usually the conclusion, which a scene lands on its own beat. */
    revealCenter: {
      args: {},
      easing: easeOut(),
      run: (timeline, _state, children) => partsOf(children)?.rings.run("revealCenter") ?? timeline.wait(timeline.duration),
    },
    /** Thicken ring `ringIndex` and dim the rest, leaving any other selected ring where it is. */
    selectRing: {
      args: { ringIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state) => {
        const index = timeline.args.ringIndex
        return popping(timeline, state, (i) => (i === index ? 1 : popAt(state, i)))
      },
    },
    /** Settle every ring and bring the whole chart back to full. */
    clearSelection: {
      args: {},
      easing: easeOut(),
      run: (timeline, state) => popping(timeline, state, () => 0),
    },
  },
})

export type RadialChart = NodeOf<typeof RadialChart>
