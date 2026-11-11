import {
  Graphics2D,
  Types,
  component2d,
  strokeOps,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
  type Stroke,
  type StrokeResolved,
} from "@motionscript/sdk"

import { loadPaints } from "./paints"
import { DEFAULT_PLOT_AREA } from "./shared"

/**
 * The frame around a cartesian plot: an empty rect with an inside stroke. Split
 * from {@link ChartCanvas} so it is placed after the marks and frames the plot
 * over them, tucking a line or column running to the edge under the border.
 */
export const ChartBorder = component2d({
  key: "chartBorder",
  state: {
    /** The stroke resolver's default `align` is `'inside'`, so the whole weight sits within the box unless the theme overrides it. */
    stroke: Types.custom<Stroke, StrokeResolved[]>(DEFAULT_PLOT_AREA.stroke, { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
  },
  load: (loader, state) => loadPaints(loader, { strokes: [state.stroke] }),
  render: (ctx, state) => {
    const { width, height } = ctx.size
    if (width <= 0 || height <= 0) return
    ctx.draw(new Graphics2D().rect({ x: 0, y: 0, width, height }).stroke(state.stroke))
  },
})

export type ChartBorder = NodeOf<typeof ChartBorder>
