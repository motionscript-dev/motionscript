/**
 * The chart family's style: one `style` entry per chart, built from the groups
 * below, so a look saved off one chart lays onto any other (a field the other
 * chart does not draw is dropped). A chart spreads the shared groups and adds a
 * `marks` group of its own.
 */

import {
  Types,
  type Fill,
  type Stroke,
  type StyleInput,
  type TextStyle,
  // Named so the emitted style types reach these through the sdk, not core.
  type FillResolved as _FillResolved,
  type Type as _Type,
} from "@motionscript/sdk"

import type { AxisConfig, ChartSeries, LegendConfig } from "./shared"

/** The style family every chart shares; a host keys saved styles by it. */
export const CHART_STYLE_FAMILY = "chart"

/** The out-of-the-box series colours, cycled by series (or row) index. */
export const CHART_PALETTE_DEFAULT = ["#4f8cff", "#2fbf8f", "#f5a524", "#e5547a", "#9b6cf0"] as const

export const CHART_COLORS = {
  /** A colour per series (a pie's or radial's per row), cycled. */
  palette: Types.palette(CHART_PALETTE_DEFAULT),
  /** Values, legend captions, centre text. */
  foreground: Types.fill("#f4f4f5"),
  /** Axis markers and captions, spoke labels. */
  muted: Types.fill("#a1a1aa"),
  /** Grid lines, axis lines, a radial's empty track. */
  gridColor: Types.fill("white/15"),
  /** Behind the plot; none by default, so the chart reads against the stage. */
  background: Types.fill([]),
}

export const CHART_TEXT = {
  /** Empty: the scene's default face. */
  fontFamily: Types.font(""),
  /** Marker and legend size at 1080p; titles and values scale from it. */
  fontSize: Types.number(28, { min: 8, max: 160, step: 1, unit: "px" }),
  fontWeight: Types.number(500, { min: 100, max: 900, step: 100 }),
}

/** Which grid lines a cartesian chart rules: `horizontal` follows the value ticks of a column chart. */
export type GridLines = "horizontal" | "vertical" | "both" | "none"

export const CARTESIAN_GRID = {
  grid: Types.oneOf(["horizontal", "vertical", "both", "none"] as const),
  gridWidth: Types.number(2, { min: 0, max: 16, step: 1, unit: "px" }),
  gridDashed: Types.boolean(false),
  /** The baseline and value-axis rule, in `gridColor`. */
  axisLine: Types.boolean(false),
  /** Read as the chart is built: whether the category (x) axis row is drawn. */
  showXAxis: Types.boolean(true, { animatable: false }),
  /** Read as the chart is built: whether the value (y) axis column is drawn. */
  showYAxis: Types.boolean(true, { animatable: false }),
}

export type LegendPosition = "bottom" | "top" | "right" | "none"
export type LegendSwatch = "square" | "circle" | "line"

export const CHART_LEGEND = {
  /** Read as the chart is built: where the legend sits, or `none`. */
  legend: Types.oneOf(["bottom", "top", "right", "none"] as const, { animatable: false }),
  swatch: Types.oneOf(["square", "circle", "line"] as const),
}

/** The type fields, and the two text colours: what every text helper reads. */
export interface ChartTextStyle {
  readonly foreground: Fill
  readonly muted: Fill
  readonly fontFamily: string
  readonly fontSize: number
  readonly fontWeight: number
}

/** The fields every chart's style resolves, whichever groups it spreads. A chart without a grid leaves out `gridColor`. */
export interface ChartStyleBase extends ChartTextStyle {
  readonly palette: readonly Fill[]
  readonly background: Fill
  readonly legend: LegendPosition
  readonly swatch: LegendSwatch
}

/** The cartesian grid fields, for the line and bar charts. */
export interface CartesianStyle extends ChartStyleBase {
  readonly gridColor: Fill
  readonly grid: GridLines
  readonly gridWidth: number
  readonly gridDashed: boolean
  readonly axisLine: boolean
  readonly showXAxis: boolean
  readonly showYAxis: boolean
}

/** A preset's fields: any chart's, so one preset dresses every chart. */
export type ChartStylePreset = StyleInput<typeof CHART_COLORS & typeof CHART_TEXT>

/** Ready-made looks, each stating every colour so applying one replaces the last. */
export const CHART_STYLE_PRESETS = {
  midnight: {
    palette: [...CHART_PALETTE_DEFAULT],
    foreground: "#f4f4f5",
    muted: "#a1a1aa",
    gridColor: "white/15",
    background: [],
  },
  paper: {
    palette: ["#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed"],
    foreground: "#1c1917",
    muted: "#57534e",
    gridColor: "#1c1917/12",
    background: "#fafaf9",
  },
  ember: {
    palette: ["#d9603b", "#8194ad", "#e0a93b", "#5e9d6b", "#9ec85a"],
    foreground: "#e9e1d4",
    muted: "#8a7f70",
    gridColor: "#2c2820",
    background: "#15130e",
  },
  neon: {
    palette: ["#22d3ee", "#a3e635", "#f472b6", "#facc15", "#818cf8"],
    foreground: "#ffffff",
    muted: "#94a3b8",
    gridColor: "white/10",
    background: [],
  },
  ocean: {
    palette: ["#0ea5e9", "#14b8a6", "#6366f1", "#38bdf8", "#2dd4bf"],
    foreground: "#e0f2fe",
    muted: "#7dd3fc",
    gridColor: "#7dd3fc/20",
    background: "#082f49",
  },
  sunset: {
    palette: ["#f97316", "#ef4444", "#ec4899", "#f59e0b", "#a855f7"],
    foreground: "#fff7ed",
    muted: "#fdba74",
    gridColor: "#fdba74/20",
    background: [],
  },
  pastel: {
    palette: ["#a5b4fc", "#f9a8d4", "#86efac", "#fde68a", "#7dd3fc"],
    foreground: "#f8fafc",
    muted: "#cbd5e1",
    gridColor: "white/12",
    background: [],
  },
  mono: {
    palette: ["#fafafa", "#a3a3a3", "#737373", "#d4d4d4", "#525252"],
    foreground: "#fafafa",
    muted: "#a3a3a3",
    gridColor: "white/12",
    background: [],
  },
} satisfies Record<string, ChartStylePreset>

/** Series `index`'s colour: its own `fill`, else the palette's, cycled. */
export function paletteFill(style: Pick<ChartStyleBase, "palette">, index: number, own?: Fill): Fill {
  if (own != null) return own
  const palette = style.palette
  return palette.length > 0 ? palette[index % palette.length] : "white"
}

/** {@link paletteFill} for a series. */
export function seriesFill(style: Pick<ChartStyleBase, "palette">, series: ChartSeries, index: number): Fill {
  return paletteFill(style, index, series.fill)
}

function face(style: Pick<ChartTextStyle, "fontFamily">): Pick<TextStyle, "fontFamily"> {
  return style.fontFamily ? { fontFamily: style.fontFamily } : {}
}

/** Axis markers, spoke labels: muted, at the base size. */
export function markerText(style: ChartTextStyle, textAlign: TextStyle["textAlign"] = "center"): TextStyle {
  return { ...face(style), fontSize: style.fontSize, fontWeight: style.fontWeight, textAlign, fill: style.muted }
}

/** Axis captions: muted, a step larger and heavier than the markers. */
export function titleText(style: ChartTextStyle): TextStyle {
  return {
    ...face(style),
    fontSize: Math.round(style.fontSize * 1.1),
    fontWeight: Math.min(900, style.fontWeight + 100),
    textAlign: "center",
    fill: style.muted,
  }
}

/** Values on marks and legend captions: the foreground, at the base size. */
export function valueText(style: ChartTextStyle, textAlign: TextStyle["textAlign"] = "center"): TextStyle {
  return { ...face(style), fontSize: style.fontSize, fontWeight: Math.min(900, style.fontWeight + 100), textAlign, fill: style.foreground }
}

/** A grid or axis rule, or none at width 0. */
export function gridStroke(style: Pick<CartesianStyle, "gridWidth" | "gridColor">): Stroke {
  return style.gridWidth > 0 ? { weight: style.gridWidth, fill: style.gridColor } : []
}

/** Whether `grid` rules the lines that run along `direction`. */
export function rules(grid: GridLines, direction: "horizontal" | "vertical"): boolean {
  return grid === "both" || grid === direction
}

/**
 * The kit axis parts' config from a style. `x` is the axis under the plot;
 * its grid lines are vertical (one per x marker), the `y` axis's horizontal.
 */
export function axisConfigOf(style: CartesianStyle, axis: "x" | "y"): AxisConfig {
  const lines = rules(style.grid, axis === "x" ? "vertical" : "horizontal")
  const gap = Math.round(style.fontSize * 0.6)
  return {
    labelStyle: markerText(style, axis === "x" ? "center" : "right"),
    titleStyle: titleText(style),
    lineStyle: lines ? gridStroke(style) : [],
    tickPadding: axis === "x" ? { top: gap } : { right: gap },
    titlePadding: axis === "x" ? { top: Math.round(gap / 2) } : { right: gap },
  }
}

/** The kit legend's config: captions in the foreground, the swatch shaped by `swatch`. */
export function legendConfigOf(style: ChartTextStyle & Pick<ChartStyleBase, "swatch">): LegendConfig {
  const size = Math.max(8, Math.round(style.fontSize * 0.6))
  const marker =
    style.swatch === "line"
      ? { width: Math.round(size * 2), height: Math.max(3, Math.round(size / 4)), borderRadius: size }
      : style.swatch === "circle"
        ? { width: size, height: size, borderRadius: size / 2 }
        : { width: size, height: size, borderRadius: Math.round(size / 4) }
  return {
    padding: 0,
    textStyle: { ...face(style), fontSize: style.fontSize, fontWeight: style.fontWeight, textAlign: "left", fill: style.foreground },
    itemGap: Math.round(style.fontSize * 1.4),
    markerStyle: { ...marker, stroke: [], shadow: [] },
  }
}
