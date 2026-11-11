import {
  clamp,
  lerpNumber,
  shadowOps,
  strokeOps,
  textOps,
  type DataRecord,
  type Fill,
  type Shadow,
  type ShadowResolved,
  type Stroke,
  type StrokeResolved,
  type TextStyle,
  type Vector2,
} from "@motionscript/sdk"

import {
  CHART_PALETTE,
  DEFAULT_LEGEND,
  DEFAULT_SERIES_FILLS,
  lerpLegendConfig,
  lerpSeriesFills,
  num,
  resolveLegendConfig,
  resolveSeriesFills,
  text,
  type LegendConfig,
  type LegendTheme,
} from "../kit/shared"

/** One resolved slice, which the ring and legend consume; the chart resolves it from `data` and two field names. */
export interface PieSlice {
  /** Label and legend caption. */
  category: string
  /** The wedge covers `value / (sum of all values)`. */
  value: number
  /** Wedge and swatch paint. */
  fill: Fill
}

/**
 * One slice per row, painted from `palette` by row order (cycling). Paint comes
 * from the palette, not the rows, because a pie's mark is a row where a line's
 * colour belongs to a column; that lets a pie be fed a CSV of plain numbers.
 */
export function resolvePieSlices(
  data: DataRecord[],
  category: string,
  value: string,
  palette: Fill[]
): PieSlice[] {
  return data.map((row, i) => ({
    category: text(row, category),
    value: num(row, value),
    fill:
      palette.length > 0 ? palette[i % palette.length] : ("white" as Fill),
  }))
}

/** What a {@link PieChart}'s labels say. */
export type PieLabelMode =
  /** Two lines, whose order flips with placement: a leader label reads category over percentage, an inside label reads the percentage big over a small category. */
  | "both"
  | "category"
  | "percent"
  /** No labels and no leader lines. */
  | "none"

/** `"inside"` centres the label in the wedge's band with no leader or gutter, so the ring draws bigger; `"leader"` is what a sliver too narrow for text needs. */
export type PieLabelPlacement = "inside" | "leader" | "none"

export const DEG = Math.PI / 180

/**
 * Opacity of a slice under the selection: 1 while nothing is out (`focus` is the
 * most-grown pop) and for the selected slice itself, falling toward `dimOpacity`
 * for the rest as the selection grows.
 */
export function selectionFade(focus: number, dimOpacity: number, pop: number): number {
  if (focus <= 0) return 1
  return 1 - (1 - clamp(dimOpacity, 0, 1)) * focus * (1 - pop)
}

/** A slice's plotted value: negatives and non-finite values count as 0. */
export function sliceValue(slice: PieSlice): number {
  return slice.value > 0 && Number.isFinite(slice.value) ? slice.value : 0
}

/** Sum of every slice's plotted value, the denominator of every share. */
export function sliceTotal(slices: PieSlice[]): number {
  let sum = 0
  for (const slice of slices) sum += sliceValue(slice)
  return sum
}

/** The point at radius `r`, angle `a` on a ring about the origin in centred y-up space. Angles run clockwise from 12 o'clock. */
export function ringPoint(r: number, a: number): Vector2 {
  return { x: r * Math.sin(a), y: r * Math.cos(a) }
}

/** One slice's resolved angular span on the ring. */
export interface PieArc {
  /** Index of the slice in the source list. */
  index: number
  /** Radians clockwise from 12 o'clock. */
  a0: number
  a1: number
  /** Where the slice's label and pop-out point. */
  mid: number
  /** Share of the total, `[0, 1]`. */
  fraction: number
}

/**
 * One arc per positive slice, walking clockwise from `startDegrees` and abutting.
 * Arcs are the undivided shares: a fixed angular gap would pinch shut at the
 * hole, so the gap is applied when the wedge is drawn, as a constant-width inset
 * off both ends.
 */
export function pieArcs(slices: PieSlice[], startDegrees: number): PieArc[] {
  const total = sliceTotal(slices)
  if (total <= 0) return []

  const arcs: PieArc[] = []
  let cursor = startDegrees * DEG
  slices.forEach((slice, index) => {
    const value = sliceValue(slice)
    if (value <= 0) return
    const fraction = value / total
    const a0 = cursor
    const a1 = a0 + fraction * Math.PI * 2
    cursor = a1
    arcs.push({ index, a0, a1, mid: (a0 + a1) / 2, fraction })
  })
  return arcs
}

interface LabelSlot {
  /** Where the label would sit if nothing else were in the way. */
  ideal: number
  /** Written by {@link relaxLabels}. */
  y: number
}

/**
 * Spread one column of labels so none overlap, each near its `ideal` y and all
 * inside `[bottom, top]`. A top-down pass clears each label from the one above
 * by `minGap`; a reverse pass lifts a tail pushed past `bottom`. When the column
 * cannot hold them all, the reverse pass wins and the crowding is shared evenly.
 * Mutates each `y` and returns `slots` ordered top to bottom.
 */
export function relaxLabels<T extends LabelSlot>(
  slots: T[],
  minGap: number,
  top: number,
  bottom: number
): T[] {
  slots.sort((a, b) => b.ideal - a.ideal)

  let ceiling = top
  for (const slot of slots) {
    slot.y = Math.min(slot.ideal, ceiling)
    ceiling = slot.y - minGap
  }

  let floor = bottom
  for (let i = slots.length - 1; i >= 0; i--) {
    slots[i].y = Math.max(slots[i].y, floor)
    floor = slots[i].y + minGap
  }

  return slots
}

/** The ring's geometry and paint: everything about the wedges but their colour. */
export interface RingConfig {
  /** Channel between adjacent slices in px, constant across the band (an angular gap would splay open toward the rim). */
  gap: number
  /** Below 1 a fraction of the outer radius (`0.6` leaves a band 40% thick); 1 and up a pixel radius; `0` draws solid wedges. */
  holeRadius: number
  /** Degrees clockwise from 12 o'clock where the first slice begins. */
  startAngle: number
  /** How far a selected slice's rim reaches, as a multiple of the outer radius so the emphasis scales with the chart. Clamped to `[1, 1.6]`. */
  selectedGrow: number
  stroke: Stroke
  shadow: Shadow
}

/** How the ring's labels are set, and the leader lines that point at them. */
export interface LabelConfig {
  /** The category caption. */
  textStyle: TextStyle
  /** The percentage. */
  percentStyle: TextStyle
  /** Both lines of a label inside its wedge: it sits on the wedge's paint, so it usually wants the opposite end of the value range from everything else. */
  insideStyle: TextStyle
  /** Runs from a wedge out to its label. */
  leaderStroke: Stroke
}

/** The summary set in the ring's hole. */
export interface CenterConfig {
  labelStyle: TextStyle
  captionStyle: TextStyle
}

/** A {@link PieChart}'s full, resolved visual theme. */
export interface PieChartConfig {
  /** Wedge and swatch paint, cycled by **row** index (`i % length`). */
  sliceFills: Fill[]
  ring: RingConfig
  label: LabelConfig
  center: CenterConfig
  legend: LegendConfig
  /** How far everything outside the selection fades while any slice is selected. */
  spotlight: { dimOpacity: number }
}

/** The author's partial theme, deep-merged onto {@link DEFAULT_PIE_CHART_THEME}. */
export type PieChartTheme = {
  sliceFills?: Fill[]
  ring?: Partial<RingConfig>
  label?: Partial<LabelConfig>
  center?: Partial<CenterConfig>
  legend?: LegendTheme
  spotlight?: Partial<PieChartConfig["spotlight"]>
}

const LABEL_TEXT_STYLE: TextStyle = {
  fontSize: 26,
  fontWeight: 600,
  textAlign: "center",
  fill: CHART_PALETTE.markerColor,
}

/** Fainter than `SPOTLIGHT_DIM`: a ring's slices touch, so at that a selected slice barely separates. */
export const PIE_SPOTLIGHT_DIM = 0.1

export const DEFAULT_PIE_CHART_THEME: PieChartConfig = {
  sliceFills: DEFAULT_SERIES_FILLS,
  ring: {
    gap: 6,
    // A donut by default: the hole is the one place a conclusion can be set.
    holeRadius: 0.6,
    startAngle: 0,
    selectedGrow: 1.08,
    stroke: [],
    shadow: [],
  },
  label: {
    textStyle: LABEL_TEXT_STYLE,
    percentStyle: { ...LABEL_TEXT_STYLE, fontWeight: 700 },
    // On a mid-tone wedge, so the panel colour rather than the axis ink.
    insideStyle: { ...LABEL_TEXT_STYLE, fontWeight: 800, fill: "#15130e" },
    leaderStroke: { weight: 2, fill: CHART_PALETTE.markerColor },
  },
  center: {
    labelStyle: {
      fontSize: 46,
      fontWeight: 800,
      textAlign: "center",
      fill: CHART_PALETTE.markerColor,
    },
    captionStyle: {
      fontSize: 22,
      fontWeight: 500,
      textAlign: "center",
      fill: CHART_PALETTE.markerColor,
    },
  },
  legend: DEFAULT_LEGEND,
  spotlight: { dimOpacity: PIE_SPOTLIGHT_DIM },
}

function resolveRingConfig(
  ring: Partial<RingConfig> | undefined,
  previous: RingConfig
): RingConfig {
  return {
    gap: ring?.gap ?? previous.gap,
    holeRadius: ring?.holeRadius ?? previous.holeRadius,
    startAngle: ring?.startAngle ?? previous.startAngle,
    selectedGrow: ring?.selectedGrow ?? previous.selectedGrow,
    stroke: strokeOps.resolve(ring?.stroke ?? previous.stroke),
    shadow: shadowOps.resolve(ring?.shadow ?? previous.shadow),
  }
}

function lerpRingConfig(
  from: RingConfig,
  to: RingConfig,
  t: number
): RingConfig {
  return {
    gap: lerpNumber(from.gap, to.gap, t),
    holeRadius: lerpNumber(from.holeRadius, to.holeRadius, t),
    startAngle: lerpNumber(from.startAngle, to.startAngle, t),
    selectedGrow: lerpNumber(from.selectedGrow, to.selectedGrow, t),
    stroke: strokeOps.lerp(
      from.stroke as StrokeResolved[],
      to.stroke as StrokeResolved[],
      t
    ),
    shadow: shadowOps.lerp(
      from.shadow as ShadowResolved[],
      to.shadow as ShadowResolved[],
      t
    ),
  }
}

function resolveLabelConfig(
  label: Partial<LabelConfig> | undefined,
  previous: LabelConfig
): LabelConfig {
  return {
    textStyle: textOps.resolveStyle(label?.textStyle, previous.textStyle),
    percentStyle: textOps.resolveStyle(
      label?.percentStyle,
      previous.percentStyle
    ),
    insideStyle: textOps.resolveStyle(label?.insideStyle, previous.insideStyle),
    leaderStroke: strokeOps.resolve(
      label?.leaderStroke ?? previous.leaderStroke
    ),
  }
}

function lerpLabelConfig(
  from: LabelConfig,
  to: LabelConfig,
  t: number
): LabelConfig {
  return {
    textStyle: textOps.lerpStyle(from.textStyle, to.textStyle, t),
    percentStyle: textOps.lerpStyle(from.percentStyle, to.percentStyle, t),
    insideStyle: textOps.lerpStyle(from.insideStyle, to.insideStyle, t),
    leaderStroke: strokeOps.lerp(
      from.leaderStroke as StrokeResolved[],
      to.leaderStroke as StrokeResolved[],
      t
    ),
  }
}

function resolveCenterConfig(
  center: Partial<CenterConfig> | undefined,
  previous: CenterConfig
): CenterConfig {
  return {
    labelStyle: textOps.resolveStyle(center?.labelStyle, previous.labelStyle),
    captionStyle: textOps.resolveStyle(
      center?.captionStyle,
      previous.captionStyle
    ),
  }
}

function lerpCenterConfig(
  from: CenterConfig,
  to: CenterConfig,
  t: number
): CenterConfig {
  return {
    labelStyle: textOps.lerpStyle(from.labelStyle, to.labelStyle, t),
    captionStyle: textOps.lerpStyle(from.captionStyle, to.captionStyle, t),
  }
}

/** The `theme` entry's resolve: merges a partial {@link PieChartTheme} onto `previous` (first resolution: the default). */
export function resolvePieChartTheme(
  theme: PieChartTheme | undefined,
  previous?: PieChartConfig
): PieChartConfig {
  const base = previous ?? DEFAULT_PIE_CHART_THEME
  return {
    sliceFills: resolveSeriesFills(theme?.sliceFills, base.sliceFills),
    ring: resolveRingConfig(theme?.ring, base.ring),
    label: resolveLabelConfig(theme?.label, base.label),
    center: resolveCenterConfig(theme?.center, base.center),
    legend: resolveLegendConfig(theme?.legend, base.legend),
    spotlight: {
      dimOpacity: theme?.spotlight?.dimOpacity ?? base.spotlight.dimOpacity,
    },
  }
}

export function lerpPieChartTheme(
  from: PieChartConfig,
  to: PieChartConfig,
  t: number
): PieChartConfig {
  return {
    sliceFills: lerpSeriesFills(from.sliceFills, to.sliceFills, t),
    ring: lerpRingConfig(from.ring, to.ring, t),
    label: lerpLabelConfig(from.label, to.label, t),
    center: lerpCenterConfig(from.center, to.center, t),
    legend: lerpLegendConfig(from.legend, to.legend, t),
    spotlight: {
      dimOpacity: lerpNumber(
        from.spotlight.dimOpacity,
        to.spotlight.dimOpacity,
        t
      ),
    },
  }
}
