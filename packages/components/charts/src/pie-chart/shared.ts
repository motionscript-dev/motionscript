/**
 * Types and pure helpers specific to the {@link PieChart} family: how rows
 * become slices, how slices become arcs on a ring, where the labels around it
 * end up, and the theme all of that is drawn from.
 *
 * The one chart in the family that draws **one mark per row** rather than one
 * per column, which is why almost nothing about its geometry is shared: there is
 * no scale, no axis and no baseline, only a circle divided by share. What it
 * *does* share — the legend, the theme leaf resolvers, the palette, the
 * percentage format — comes from `../kit/shared.ts`.
 *
 * Kept renderer-agnostic (no `Node` imports) so a host's inspector mapping
 * can build a partial {@link PieChartTheme} without
 * pulling the node classes in.
 */

import {
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

/**
 * One **resolved** slice of a {@link PieChart}: its caption, its magnitude, and
 * the paint its wedge and legend swatch take.
 *
 * This is what the ring and the legend consume, not what a scene authors: the
 * chart takes tabular `data` plus two field names and resolves it into these, so
 * the parts stay unaware of where a slice's caption, magnitude and paint came
 * from.
 */
export interface PieSlice {
  /** Legend caption and label text for this slice. */
  category: string
  /** This slice's magnitude. Its wedge covers `value / (sum of all values)`. */
  value: number
  /** Wedge and swatch paint. */
  fill: Fill
}

/**
 * Resolve tabular rows into slices: one per row, captioned by the `category`
 * column, sized by the `value` column, painted from `palette` by row order
 * (cycling when the palette is shorter than the data).
 *
 * Paint comes from the palette rather than from the rows because a pie draws one
 * mark per *row* — unlike the line and bar charts, where a colour belongs to a
 * series (a whole column) and rides on the series entry instead. Keeping it out
 * of the rows is what lets a pie be fed straight from a CSV of plain numbers.
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
  /**
   * The category and its percentage, two lines. Their order flips with the
   * placement: a **leader** label reads category over percentage, an **inside**
   * label reads the percentage big over a small category caption — inside a
   * wedge the reader already knows which slice they're on, so the magnitude is
   * the thing being read.
   */
  | "both"
  /** The category only. */
  | "category"
  /** The percentage only — the pick when a legend already names the categories. */
  | "percent"
  /** No labels and no leader lines at all. */
  | "none"

/**
 * Where a slice's label sits.
 *
 * `"inside"` drops the leader line entirely and centres the label in the wedge's
 * own band, which costs no gutter — so the ring draws bigger — and costs the eye
 * no round trip. `"leader"` is the classic treatment, and what a sliver too
 * narrow to hold text needs.
 */
export type PieLabelPlacement = "inside" | "leader" | "none"

/** Degrees → radians. */
export const DEG = Math.PI / 180

/** A slice's plotted value: negatives and non-finite values count as 0. */
export function sliceValue(slice: PieSlice): number {
  return slice.value > 0 && Number.isFinite(slice.value) ? slice.value : 0
}

/** Sum of every slice's plotted value — the denominator every share is taken against. */
export function sliceTotal(slices: PieSlice[]): number {
  let sum = 0
  for (const slice of slices) sum += sliceValue(slice)
  return sum
}

/**
 * The point at radius `r` and angle `a` on a ring centred on the origin, in the
 * node's centred, **y-up** space. Angles run **clockwise from 12 o'clock**:
 * `a = 0` points straight up (+y), and increasing `a` sweeps toward +x then −y.
 */
export function ringPoint(r: number, a: number): Vector2 {
  return { x: r * Math.sin(a), y: r * Math.cos(a) }
}

/** One slice's resolved angular span on the ring. */
export interface PieArc {
  /** Index of the slice in the source list. */
  index: number
  /** Start angle, radians clockwise from 12 o'clock. */
  a0: number
  /** End angle, radians clockwise from 12 o'clock. */
  a1: number
  /** Bisector angle — where this slice's label and pop-out point. */
  mid: number
  /** This slice's share of the total, in `[0, 1]`. */
  fraction: number
}

/**
 * Resolve slices into per-slice arcs: each covers exactly its share of the
 * circle, walking clockwise from `startDegrees` (0 = 12 o'clock), with the arcs
 * abutting. Zero/negative slices are skipped entirely; an all-zero list yields
 * no arcs.
 *
 * Arcs are the *undivided* shares — the gap between neighbours is not carved out
 * here, because a fixed angular gap reads as a wedge: wide at the rim, pinched
 * shut at the hole. It's applied when the wedge is drawn instead, as a
 * constant-width inset off both ends of every arc, so a slice still covers its
 * true percentage of the circle.
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

/** A label competing for vertical space in one of the two label columns. */
export interface LabelSlot {
  /** Where the label would sit if nothing else were in the way. */
  ideal: number
  /** Where it ends up once the column has been de-conflicted. Written by {@link relaxLabels}. */
  y: number
}

/**
 * Spread one column of labels so no two overlap, keeping each as close to its
 * `ideal` y as possible and the whole column inside `[bottom, top]`.
 *
 * Two passes, the standard treatment. Walking top-to-bottom, each label takes
 * the highest slot at or below its ideal that still clears the label above it by
 * `minGap`; if that pushes the tail past `bottom`, a reverse pass lifts it back
 * up. When there are more labels than the column can hold, the reverse pass wins
 * and the crowding is shared evenly rather than dumped off the bottom edge.
 *
 * Mutates each slot's `y` and returns `slots` re-ordered top-to-bottom.
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

// ---- Theme ---------------------------------------------------------------

/** The ring's geometry and paint — everything about the wedges but their colour. */
export interface RingConfig {
  /**
   * Width of the channel between adjacent slices, in px, held constant all the
   * way across the band — the same clearance at the hole as at the rim. (An
   * angular gap would splay open toward the rim instead.)
   */
  gap: number
  /**
   * Radius of the hole punched through the middle. Below 1 it reads as a
   * fraction of the ring's outer radius (`0.6` leaves a band 40% of the radius
   * thick); 1 and up as an explicit pixel radius; `0` fills the middle in,
   * drawing solid pie wedges.
   */
  holeRadius: number
  /** Angle in degrees where the first slice begins, clockwise from 12 o'clock. */
  startAngle: number
  /**
   * How far out a selected slice's rim reaches, as a **multiple of the ring's
   * outer radius**. Being relative, the emphasis scales with the chart instead
   * of shrinking on a big one and swamping a small one. Clamped to `[1, 1.6]`.
   */
  selectedGrow: number
  /** Optional outline on every wedge. */
  stroke: Stroke
  /** Optional drop shadow on every wedge. */
  shadow: Shadow
}

/** How the ring's labels are set, and the leader lines that point at them. */
export interface LabelConfig {
  /** The category caption on a label. */
  textStyle: TextStyle
  /** The percentage on a label. */
  percentStyle: TextStyle
  /**
   * Ink for a label set **inside** its wedge, both lines. Separate because an
   * inside label sits on the wedge's own paint rather than on the background, so
   * it usually wants the opposite end of the value range from everything else.
   */
  insideStyle: TextStyle
  /** The leader line running from a wedge out to its label. */
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

/** Author-facing partial theme — every branch optional and deep-merged. */
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

/**
 * Opacity the other slices fade to under a selection. Fainter than the line and
 * bar charts' `SPOTLIGHT_DIM`: a ring's slices touch, so at that a selected
 * slice barely separates from its neighbours.
 */
export const PIE_SPOTLIGHT_DIM = 0.1

/** The pie chart's out-of-the-box look. */
export const DEFAULT_PIE_CHART_THEME: PieChartConfig = {
  sliceFills: DEFAULT_SERIES_FILLS,
  ring: {
    gap: 6,
    // A donut rather than a solid pie by default: the hole is the largest
    // uninterrupted area the chart owns and the one place a conclusion can be
    // set. `0` here would give that away before anyone had asked for it.
    holeRadius: 0.6,
    startAngle: 0,
    selectedGrow: 1.08,
    stroke: [],
    shadow: [],
  },
  label: {
    textStyle: LABEL_TEXT_STYLE,
    percentStyle: { ...LABEL_TEXT_STYLE, fontWeight: 700 },
    // Inside labels sit on the wedge's paint, which is a mid-tone from the
    // palette — so they lead with the panel colour rather than the axis ink.
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

/**
 * {@link PieChart}'s `theme` property mapper: merges the author's partial
 * {@link PieChartTheme} onto `previous` (falling back to
 * {@link DEFAULT_PIE_CHART_THEME} on first resolution), fully resolving every
 * leaf so the tween below always has resolved data to interpolate.
 */
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

/** {@link PieChart}'s `theme` property tween — leaf by leaf. */
export function lerpPieChartTheme(
  from: PieChartConfig,
  to: PieChartConfig,
  t: number
): PieChartConfig {
  return {
    // A palette is a list of independent paints rather than one value, so it
    // interpolates pairwise by index; one that grows or shrinks holds the longer
    // side's tail, exactly as the cartesian charts' palettes do.
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
