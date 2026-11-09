/**
 * The bar chart: grouped or stacked columns off a category axis.
 *
 * Shares the plot panel, the value axis and the legend with the line chart —
 * which is what lets a scene swap one for the other without re-theming — and
 * brings its own category axis, since a band scale is not a continuous one.
 */
export { BarChart, barChartDomain } from "./bar-chart"
export type { BarChartDomain, BarChartProps, BarChartValues } from "./bar-chart"
export { ChartBars } from "./chart-bars"
export type { BarGeometry, ChartBarsProps } from "./chart-bars"
export { CategoryAxis } from "./category-axis"
export type { CategoryAxisProps } from "./category-axis"
export {
  DEFAULT_BAR_CHART_THEME,
  barCategories,
  barSpans,
  barValueExtent,
  lerpBarChartTheme,
  resolveBarChartTheme,
  resolveBarFill,
  resolveBarScale,
  stackCapIndex,
} from "./shared"
export type {
  BarChartConfig,
  BarChartTheme,
  BarSeries,
  BarSpan,
  BarStyleConfig,
} from "./shared"
