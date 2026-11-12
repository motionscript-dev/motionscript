import { Types, type TextStyle, type DataRecord, type Size2D, type StrokeResolved, type Stroke as _Stroke, type Vector2 } from "@motionscript/sdk"

import { num, text, type ChartSeries } from "../kit/shared"
import { CHART_MUTED, LEGEND_TEXT } from "../kit/style"

/** The radar chart's text: the category names around the rim, and the legend. */
export const RADAR_TEXT = {
  spokeText: Types.typography({ fontSize: 28, fontWeight: 500, fill: CHART_MUTED }),
  ...LEGEND_TEXT,
}

export type GridShape = "polygon" | "circle"

/** The radar chart's own grid group: the web the polygons are drawn over. */
export const RADAR_GRID = {
  /** Whether the rings are straight-edged (a polygon through the spokes) or round. */
  gridShape: Types.oneOf(["polygon", "circle"] as const),
  /** How many rings, outermost at the scale's maximum. */
  gridLevels: Types.number(4, { min: 1, max: 10, step: 1 }),
  /** The rings; empty draws none. */
  gridStroke: Types.stroke({ weight: 2, fill: "white/15" }),
  /** The line from the centre out to each category; empty draws none. */
  spokeStroke: Types.stroke({ weight: 2, fill: "white/15" }),
  /** Read as the chart is built: whether the category names stand around the rim. */
  spokeLabels: Types.boolean(true, { animatable: false }),
}

export const RADAR_MARKS = {
  /** Outline weight of each series' polygon. */
  strokeWidth: Types.number(4, { min: 0, max: 24, step: 1, unit: "px" }),
  /** How strongly each polygon is filled in its series colour; 0 leaves an outline. */
  areaOpacity: Types.number(0.25, { min: 0, max: 1, step: 0.05 }),
  /** Whether a dot marks each value on its spoke. */
  dots: Types.boolean(true),
  dotSize: Types.number(10, { min: 2, max: 40, step: 1, unit: "px" }),
}

/** The grid and marks fields the parts read, whichever way the chart's style is spelled. */
export interface RadarStyle {
  readonly gridShape: GridShape
  readonly gridLevels: number
  readonly gridStroke: StrokeResolved[]
  readonly spokeStroke: StrokeResolved[]
  readonly spokeLabels: boolean
  readonly strokeWidth: number
  readonly areaOpacity: number
  readonly dots: boolean
  readonly dotSize: number
  readonly spokeText: TextStyle
}

/** Fraction of the label's font size between the rim and the label. */
const LABEL_PAD = 0.55
/** Glyph width as a fraction of the font size, for fitting labels. */
const GLYPH = 0.58
/** Room kept clear around the web when nothing else claims it, in px. */
const MARGIN = 10
/** Below this a spoke counts as vertical, and its label centres over it. */
const SIDE = 0.35

/** Spoke `index` of `count`, as a unit direction: 12 o'clock first, clockwise on screen, y up. */
export function spokeDirection(index: number, count: number): Vector2 {
  const angle = (index / Math.max(1, count)) * Math.PI * 2
  return { x: Math.sin(angle), y: Math.cos(angle) }
}

/** One category per data row. */
export function categoriesOf(data: readonly DataRecord[], field: string): string[] {
  return data.map((row) => text(row, field))
}

/** One list of values per series, a value per row. */
export function valuesOf(data: readonly DataRecord[], series: readonly ChartSeries[]): number[][] {
  return series.map((s) => data.map((row) => num(row, s.field)))
}

const MANTISSAS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/** `value` rounded up to a tidy 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 times a power of ten. */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const mantissa = value / power
  const pick = MANTISSAS.find((m) => m >= mantissa - 1e-9) ?? 10
  return pick * power
}

/**
 * The scale the web is drawn to: `min` (default 0) to `max`, which when unset
 * (or not above `min`) is the largest value rounded up tidily.
 */
export function scaleOf(values: readonly (readonly number[])[], min: number, max: number): { min: number; max: number } {
  if (max > min) return { min, max }
  let top = min
  for (const list of values) for (const v of list) top = Math.max(top, v)
  const span = niceCeil(top - min)
  return { min, max: min + span }
}

/** Where `value` stands between the scale's ends, `0`-`1`. */
export function fractionOf(value: number, scale: { min: number; max: number }): number {
  const span = scale.max - scale.min
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (value - scale.min) / span))
}

export type LabelAnchor = "centerLeft" | "centerRight" | "bottomCenter" | "topCenter"

/** Which corner of a category's label touches the point beside its spoke's end. */
export function labelAnchor(index: number, count: number): LabelAnchor {
  const { x, y } = spokeDirection(index, count)
  if (x > SIDE) return "centerLeft"
  if (x < -SIDE) return "centerRight"
  return y >= 0 ? "bottomCenter" : "topCenter"
}

export function labelPad(fontSize: number): number {
  return fontSize * LABEL_PAD
}

/** Rough size of a label, since the web is fitted before any text is measured. */
export function labelSize(caption: string, fontSize: number): Size2D {
  return { width: caption.length * fontSize * GLYPH, height: fontSize * 1.25 }
}

/**
 * The rim's radius for a box: the largest the web can be with every label
 * (when there are labels) still inside it.
 */
export function fitRadius(box: Size2D, categories: readonly string[], fontSize: number, labelled: boolean): number {
  let radius = Math.min(box.width, box.height) / 2 - MARGIN
  if (!labelled) return Math.max(0, radius)
  const pad = labelPad(fontSize)
  const count = categories.length
  categories.forEach((caption, i) => {
    const { x, y } = spokeDirection(i, count)
    const size = labelSize(caption, fontSize)
    const side = labelAnchor(i, count)
    // How much of the label hangs past its anchor point on each axis.
    const reachX = side === "centerLeft" || side === "centerRight" ? size.width : size.width / 2
    const reachY = side === "bottomCenter" || side === "topCenter" ? size.height : size.height / 2
    if (Math.abs(x) > 1e-6) radius = Math.min(radius, (box.width / 2 - reachX - MARGIN / 2) / Math.abs(x) - pad)
    if (Math.abs(y) > 1e-6) radius = Math.min(radius, (box.height / 2 - reachY - MARGIN / 2) / Math.abs(y) - pad)
  })
  return Math.max(0, radius)
}

/** Where spoke `index`'s label is pinned: just past the rim, centre-relative, y up. */
export function labelPoint(index: number, count: number, radius: number, fontSize: number): Vector2 {
  const { x, y } = spokeDirection(index, count)
  const r = radius + labelPad(fontSize)
  return { x: x * r, y: y * r }
}
