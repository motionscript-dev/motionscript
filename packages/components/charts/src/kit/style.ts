/**
 * The chart family's style: one `style` entry per chart, built from the groups
 * below, so a look saved off one chart lays onto any other (a field the other
 * chart does not draw is dropped). A chart spreads the shared groups and adds a
 * `marks` group of its own. Every run of text a chart draws is its own
 * `Types.typography` field, set the way a text node is, in the group of the
 * part it labels: axis text with its axis, values with the labels, the
 * legend's captions with the legend.
 */

import {
  Types,
  textOps,
  type Fill,
  type StrokeResolved,
  type Stroke as _Stroke,
  type StyleInput,
  type TextStyle,
  // Named so the emitted style types reach these through the sdk, not core.
  type FillResolved as _FillResolved,
  type Type as _Type,
} from "@motionscript/sdk"

import type { AxisConfig, ChartSeries, LegendConfig } from "./shared"

/** The style family every chart shares; the built-in presets are written for it. */
export const CHART_STYLE_FAMILY = "chart"

/** The out-of-the-box series fills, cycled by series (or row) index. */
export const CHART_PALETTE_DEFAULT = ["#4f8cff", "#2fbf8f", "#f5a524", "#e5547a", "#9b6cf0"] as const

/** The default ink of values, legend captions and centre text, on the dark stage. */
export const CHART_FOREGROUND = "#f4f4f5"
/** The default ink of axis markers, axis captions and spoke labels. */
export const CHART_MUTED = "#a1a1aa"

export const CHART_SERIES = {
  /** A fill per series (a pie's or radial's per row), cycled; each may stack several paints. */
  seriesFills: Types.palette(CHART_PALETTE_DEFAULT),
}

export const CHART_BACKGROUND = {
  /** Behind the whole chart, legend and axes included; none by default, so the chart reads against the stage. */
  background: Types.fill([]),
}

export const GRID_BACKGROUND = {
  ...CHART_BACKGROUND,
  /** Behind the plot only, under the grid lines; none by default. */
  gridBackground: Types.fill([]),
}

/** The figures printed by the marks, for a chart's `labels` group. */
export const VALUE_TEXT = {
  valueText: Types.typography({ fontSize: 24, fontWeight: 600, fill: CHART_FOREGROUND }),
}

export const CARTESIAN_GRID = {
  /** The lines along the value ticks of a column chart (one per tick); empty draws none. */
  horizontalGrid: Types.stroke({ weight: 2, fill: "white/15" }),
  /** The lines under the category markers; empty draws none. */
  verticalGrid: Types.stroke([]),
}

export const CARTESIAN_AXES = {
  /** The baseline and the value-axis rule; empty draws none. */
  axisStroke: Types.stroke([]),
  /** Read as the chart is built: whether the category (x) axis row is drawn. */
  showXAxis: Types.boolean(true, { animatable: false }),
  /** The markers under the plot: categories on a column chart, values on a horizontal bar chart. */
  xLabelText: Types.typography({ fontSize: 28, fontWeight: 500, fill: CHART_MUTED }),
  /** The caption under the plot. */
  xTitleText: Types.typography({ fontSize: 31, fontWeight: 600, fill: CHART_MUTED }),
  /** Read as the chart is built: whether the value (y) axis column is drawn. */
  showYAxis: Types.boolean(true, { animatable: false }),
  /** The markers beside the plot. */
  yLabelText: Types.typography({ fontSize: 28, fontWeight: 500, fill: CHART_MUTED }),
  /** The caption beside the plot, turned on its side. */
  yTitleText: Types.typography({ fontSize: 31, fontWeight: 600, fill: CHART_MUTED }),
}

export type LegendPosition = "bottom" | "top" | "right" | "none"
export type LegendSwatch = "square" | "circle" | "line"

export const CHART_LEGEND = {
  /** Read as the chart is built: where the legend sits, or `none`. */
  legend: Types.oneOf(["bottom", "top", "right", "none"] as const, { animatable: false }),
  swatch: Types.oneOf(["square", "circle", "line"] as const),
  /** The legend's captions. */
  legendText: Types.typography({ fontSize: 28, fontWeight: 500, fill: CHART_FOREGROUND }),
}

/** The fields every chart's style resolves, whichever groups it spreads. */
export interface ChartStyleBase {
  readonly seriesFills: readonly Fill[]
  readonly background: Fill
  readonly legendText: TextStyle
  readonly legend: LegendPosition
  readonly swatch: LegendSwatch
}

/** The cartesian fields, for the line and bar charts. */
export interface CartesianStyle extends ChartStyleBase {
  readonly gridBackground: Fill
  readonly xLabelText: TextStyle
  readonly xTitleText: TextStyle
  readonly yLabelText: TextStyle
  readonly yTitleText: TextStyle
  readonly valueText: TextStyle
  readonly horizontalGrid: StrokeResolved[]
  readonly verticalGrid: StrokeResolved[]
  readonly axisStroke: StrokeResolved[]
  readonly showXAxis: boolean
  readonly showYAxis: boolean
}

/** The fields a preset restates so its rules and text read on its background (a chart keeps those it draws). */
const _PRESET_FIELDS = {
  ...CHART_SERIES,
  ...GRID_BACKGROUND,
  ...CARTESIAN_AXES,
  ...VALUE_TEXT,
  legendText: CHART_LEGEND.legendText,
  labelText: Types.typography(),
  centerText: Types.typography(),
  spokeText: Types.typography(),
  horizontalGrid: CARTESIAN_GRID.horizontalGrid,
  gridStroke: Types.stroke([]),
  spokeStroke: Types.stroke([]),
  track: Types.fill([]),
}

/** A preset's fields: any chart's, so one preset dresses every chart. */
export type ChartStylePreset = StyleInput<typeof _PRESET_FIELDS>

/** Every text field's ink: `foreground` for values, the legend and centre text, `muted` for markers and captions. */
function inks(foreground: string, muted: string) {
  const on = (fill: string) => ({ fill })
  return {
    xLabelText: on(muted),
    xTitleText: on(muted),
    yLabelText: on(muted),
    yTitleText: on(muted),
    valueText: on(foreground),
    legendText: on(foreground),
    labelText: on(muted),
    centerText: on(foreground),
    spokeText: on(muted),
  } satisfies ChartStylePreset
}

/** Every rule a chart draws, and a radial's track, in one paint. */
function rules(fill: string) {
  return {
    horizontalGrid: { weight: 2, fill },
    gridStroke: { weight: 2, fill },
    spokeStroke: { weight: 2, fill },
    track: fill,
  } satisfies ChartStylePreset
}

/** Ready-made looks, each stating every colour so applying one replaces the last. */
export const CHART_STYLE_PRESETS = {
  midnight: {
    seriesFills: [...CHART_PALETTE_DEFAULT],
    ...inks(CHART_FOREGROUND, CHART_MUTED),
    ...rules("white/15"),
    track: "white/10",
    background: [],
    gridBackground: [],
  },
  paper: {
    seriesFills: ["#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed"],
    ...inks("#1c1917", "#57534e"),
    ...rules("#1c1917/12"),
    background: "#fafaf9",
    gridBackground: [],
  },
  ember: {
    seriesFills: ["#d9603b", "#8194ad", "#e0a93b", "#5e9d6b", "#9ec85a"],
    ...inks("#e9e1d4", "#8a7f70"),
    ...rules("#2c2820"),
    background: "#15130e",
    gridBackground: [],
  },
  neon: {
    seriesFills: ["#22d3ee", "#a3e635", "#f472b6", "#facc15", "#818cf8"],
    ...inks("#ffffff", "#94a3b8"),
    ...rules("white/10"),
    background: [],
    gridBackground: [],
  },
  ocean: {
    seriesFills: ["#0ea5e9", "#14b8a6", "#6366f1", "#38bdf8", "#2dd4bf"],
    ...inks("#e0f2fe", "#7dd3fc"),
    ...rules("#7dd3fc/20"),
    background: "#082f49",
    gridBackground: [],
  },
  sunset: {
    seriesFills: ["#f97316", "#ef4444", "#ec4899", "#f59e0b", "#a855f7"],
    ...inks("#fff7ed", "#fdba74"),
    ...rules("#fdba74/20"),
    background: [],
    gridBackground: [],
  },
  pastel: {
    seriesFills: ["#a5b4fc", "#f9a8d4", "#86efac", "#fde68a", "#7dd3fc"],
    ...inks("#f8fafc", "#cbd5e1"),
    ...rules("white/12"),
    background: [],
    gridBackground: [],
  },
  mono: {
    seriesFills: ["#fafafa", "#a3a3a3", "#737373", "#d4d4d4", "#525252"],
    ...inks("#fafafa", "#a3a3a3"),
    ...rules("white/12"),
    background: [],
    gridBackground: [],
  },
} satisfies Record<string, ChartStylePreset>

/** Series `index`'s fill: its own `fill`, else the style's series fills, cycled. */
export function paletteFill(style: Pick<ChartStyleBase, "seriesFills">, index: number, own?: Fill): Fill {
  if (own != null) return own
  const fills = style.seriesFills
  return fills.length > 0 ? fills[index % fills.length] : "white"
}

/** {@link paletteFill} for a series. */
export function seriesFill(style: Pick<ChartStyleBase, "seriesFills">, series: ChartSeries, index: number): Fill {
  return paletteFill(style, index, series.fill)
}

/** A text style's size in px; an autofit or unset size reads as `fallback`. */
export function sizeOf(text: TextStyle | undefined, fallback = 28): number {
  const size = text?.fontSize
  return typeof size === "number" && Number.isFinite(size) ? size : fallback
}

/**
 * `text` as a text node takes it, aligned where the chart puts it, with `over`
 * laid on top. Unset keys are dropped: an `undefined` spread onto a node is a
 * value, and an unset face must stay unset so the host's default applies.
 */
export function placedText(text: TextStyle, textAlign: TextStyle["textAlign"] = "center", over?: TextStyle): TextStyle {
  return textOps.styleProps({ ...textOps.mergeStyle(text, over), textAlign }) as TextStyle
}

/** Axis markers on `axis`, aligned as that axis sets them. */
export function markerText(style: Pick<CartesianStyle, "xLabelText" | "yLabelText">, axis: "x" | "y"): TextStyle {
  return placedText(axis === "x" ? style.xLabelText : style.yLabelText, axis === "x" ? "center" : "right")
}

/** The figures printed by the marks. */
export function valueText(style: Pick<CartesianStyle, "valueText">, textAlign: TextStyle["textAlign"] = "center"): TextStyle {
  return placedText(style.valueText, textAlign)
}

/**
 * The kit axis parts' config from a style. `x` is the axis under the plot;
 * its grid lines are vertical (one per x marker), the `y` axis's horizontal.
 */
export function axisConfigOf(
  style: Pick<CartesianStyle, "verticalGrid" | "horizontalGrid" | "xLabelText" | "xTitleText" | "yLabelText" | "yTitleText">,
  axis: "x" | "y"
): AxisConfig {
  const gap = Math.round(sizeOf(axis === "x" ? style.xLabelText : style.yLabelText) * 0.6)
  return {
    labelStyle: markerText(style, axis),
    titleStyle: placedText(axis === "x" ? style.xTitleText : style.yTitleText),
    lineStyle: axis === "x" ? style.verticalGrid : style.horizontalGrid,
    tickPadding: axis === "x" ? { top: gap } : { right: gap },
    titlePadding: axis === "x" ? { top: Math.round(gap / 2) } : { right: gap },
  }
}

/** The kit legend's config: captions in `legendText`, the swatch shaped by `swatch` and sized off the captions. */
export function legendConfigOf(style: Pick<ChartStyleBase, "swatch" | "legendText">): LegendConfig {
  const type = sizeOf(style.legendText)
  const size = Math.max(8, Math.round(type * 0.6))
  const marker =
    style.swatch === "line"
      ? { width: Math.round(size * 2), height: Math.max(3, Math.round(size / 4)), borderRadius: size }
      : style.swatch === "circle"
        ? { width: size, height: size, borderRadius: size / 2 }
        : { width: size, height: size, borderRadius: Math.round(size / 4) }
  return {
    padding: 0,
    textStyle: placedText(style.legendText, "left"),
    itemGap: Math.round(type * 1.4),
    markerStyle: { ...marker, stroke: [], shadow: [] },
  }
}

/** Which text a chart drew from the retired shared text fields. */
export type ChartTextLayout = "cartesian" | "pie" | "radar" | "radial"

/**
 * The `style` entry's hook for documents written before every run of text got
 * its own field (0.1.1-alpha.1): `barRadius` became `barCornerRadius`, `palette` became `seriesFills`; `foreground`,
 * `muted` and the one `fontFamily`/`fontSize`/`fontWeight` became the text
 * fields as each chart derived them; a cartesian or radar `background`, which
 * painted the plot, became `gridBackground`. A current style comes back as is.
 */
export function migrateChartStyle(layout: ChartTextLayout): (value: unknown) => unknown {
  return (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value
    const old = value as Record<string, unknown>
    const retired = ["palette", "foreground", "muted", "fontFamily", "fontSize", "fontWeight", "barRadius"]
    const plotBackground = layout === "cartesian" || layout === "radar"
    if (!retired.some((key) => key in old) && !(plotBackground && "background" in old && !("gridBackground" in old))) return value

    const { palette, foreground, muted, fontFamily, fontSize, fontWeight, barRadius, ...rest } = old
    const out: Record<string, unknown> = { ...rest }
    // A bar radius rounded only the far end; its replacement states every corner.
    if (typeof barRadius === "number" && out.barCornerRadius === undefined) {
      out.barCornerRadius = { topLeft: barRadius, topRight: barRadius, bottomRight: 0, bottomLeft: 0 }
    }
    if (palette !== undefined && out.seriesFills === undefined) out.seriesFills = palette
    if (plotBackground && "background" in old && !("gridBackground" in old)) {
      out.gridBackground = old.background
      delete out.background
    }
    const size = typeof fontSize === "number" ? fontSize : undefined
    const weight = typeof fontWeight === "number" ? fontWeight : undefined
    const text = (ink: unknown, scale = 1, heavier = 0): Record<string, unknown> | undefined => {
      const t: Record<string, unknown> = {}
      if (typeof fontFamily === "string" && fontFamily !== "") t.fontFamily = fontFamily
      if (size !== undefined) t.fontSize = Math.round(size * scale)
      if (weight !== undefined) t.fontWeight = Math.min(900, weight + heavier)
      if (ink !== undefined) t.fill = ink
      return Object.keys(t).length > 0 ? t : undefined
    }
    const fields: Record<string, Record<string, unknown> | undefined> = { legendText: text(foreground) }
    if (layout === "cartesian") {
      fields.xLabelText = text(muted)
      fields.yLabelText = text(muted)
      fields.xTitleText = text(muted, 1.1, 100)
      fields.yTitleText = text(muted, 1.1, 100)
      fields.valueText = text(foreground, 0.85, 100)
    } else if (layout === "pie") {
      fields.labelText = text(muted)
      fields.valueText = text(foreground, 1, 200)
      fields.centerText = text(foreground, 1.8, 300)
    } else if (layout === "radar") {
      fields.spokeText = text(muted)
    } else {
      fields.labelText = text(muted)
      fields.centerText = text(foreground, 1.8, 300)
    }
    for (const [key, field] of Object.entries(fields)) if (field && out[key] === undefined) out[key] = field
    return out
  }
}
