/**
 * The line chart: a cartesian plot with a traced polyline, spotlit regions and
 * a staggered entrance.
 *
 * {@link LineChart} composes the parts below plus the shared ones in the kit
 * (the plot panel, the value axis, the legend); each part is exported too, so
 * another node type can reuse one on its own.
 *
 * These files are what a copy of the line chart takes (`registry.json`). Everything they reach for
 * that is *not* here comes from the kit and stays a dependency — see
 * `../engine.ts` for why that line is where it is.
 */
export { LineChart, lineChartDomains } from "./line-chart"
export type { LineChartDomains, LineChartProps, LineChartValues } from "./line-chart"
export { ChartRegion } from "./chart-region"
export { ChartLine } from "./chart-line"
export { HorizontalAxis } from "./horizontal-axis"
export {
  DEFAULT_CHART_THEME,
  EMPTY_REGION_BOX,
  clipPolylineToBox,
  hasRegion,
  lerpChartTheme,
  resolveChartTheme,
  resolveRegionBox,
  resolveYScale,
  seriesPoints,
  yExtent,
} from "./shared"
export type {
  ChartConfig,
  ChartTheme,
  LineSeries,
  PlotRegion,
  RegionBox,
  RegionConfig,
} from "./shared"
export { formatInstant, parseInstant, resolveXScale } from "./x-scale"
export type { XScale, XScaleKind } from "./x-scale"
