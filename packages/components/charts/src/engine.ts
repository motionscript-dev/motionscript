/**
 * The chart kit: what the three charts share, and what a copied chart does not
 * copy. A chart finds its parts by component identity (`VerticalAxis.is`), so a
 * second copy of `VerticalAxis` would be a second component that the chart never
 * finds, with no error. Copies import the kit from `@motionscript/charts`.
 */
export * from "./kit/shared"
export * from "./kit/cartesian"
export * from "./kit/chart-border"
export * from "./kit/chart-canvas"
export * from "./kit/chart-legend"
export * from "./kit/entries"
export * from "./kit/motion"
export * from "./kit/paints"
export * from "./kit/vertical-axis"
export * from "@motionscript/sdk/component"
