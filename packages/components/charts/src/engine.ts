/**
 * The chart **kit**: everything the three charts share, and the one thing a
 * copied chart does not copy.
 *
 * `ms add line-chart` writes `line-chart/*` into your project and rewrites its
 * reach for these to `@motionscript/charts`, so the plot panel, the value
 * axis, the legend and the number formatting stay a real dependency. That is
 * not a size decision — it is the only arrangement that works.
 *
 * A chart identifies its own parts by component identity (`VerticalAxis.is`).
 * Copy `VerticalAxis` alongside your fork and there are now two of it — two
 * components answering one name, and whichever one your chart did not get is
 * a part it never finds, with no error. Keeping the kit external makes that
 * impossible rather than unlikely.
 *
 * It also means a fix to the axis reaches a forked chart without a re-add,
 * which is the half of the bargain you get back for it.
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
