import {
  Graphics2D,
  Types,
  component2d,
  strokeOps,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps,
  type Stroke,
  type StrokeResolved,
} from "@motionscript/sdk"

import { loadPaints } from "./paints"
import { DEFAULT_PLOT_AREA } from "./shared"

export interface ChartBorderProps extends Node2DProps {
  /**
   * The plot's thick frame stroke. The stroke resolver's default `align` is
   * `'inside'`, so the whole weight sits within the layout box unless the theme
   * overrides it.
   */
  stroke: Stroke
}

/**
 * The thick **frame** around a cartesian chart's plot: an empty rect wearing an
 * inside stroke, sized from its box.
 *
 * Split out of {@link ChartCanvas} (the filled + gridded backdrop) so it can be
 * placed *after* the marks in the tree — the box then frames the plot **over**
 * them, so a line or a column running to the edge tucks cleanly under the border
 * rather than sitting on top of it.
 */
export const ChartBorder = component2d({
  key: "chartBorder",
  state: {
    stroke: Types.custom<Stroke, StrokeResolved[]>(DEFAULT_PLOT_AREA.stroke, { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
  },
  load: (loader, state) => loadPaints(loader, { strokes: [state.stroke] }),
  render: (ctx, state) => {
    const { width, height } = ctx.size
    if (width <= 0 || height <= 0) return
    // Empty rect (no fill) with the themed stroke, so the frame sits over the
    // marks but the box interior stays clear.
    ctx.draw(new Graphics2D().rect({ x: 0, y: 0, width, height }).stroke(state.stroke))
  },
})

export type ChartBorder = NodeOf<typeof ChartBorder>
