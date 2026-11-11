import {
  Graphics2D,
  Types,
  component2d,
  fillOps,
  shadowOps,
  strokeOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
  type Shadow,
  type ShadowResolved,
  type Stroke,
  type StrokeResolved,
} from "@motionscript/sdk"

import { fresh } from "./entries"
import { loadPaints } from "./paints"
import {
  DEFAULT_PLOT_AREA,
  DEFAULT_X_AXIS,
  DEFAULT_Y_AXIS,
  type Range,
} from "./shared"

const strokeEntry = (initial: Stroke) =>
  Types.custom<Stroke, StrokeResolved[]>(initial, { resolve: strokeOps.resolve, lerp: strokeOps.lerp })

/**
 * The plot backdrop: a filled panel and a grid, sized from its box. The frame is
 * a separate {@link ChartBorder} drawn over the marks. Grid lines are placed from
 * the axis markers' data-unit positions mapped through the extents, so each lands
 * under its marker however the markers are spaced.
 */
export const ChartCanvas = component2d({
  key: "chartCanvas",
  state: {
    fill: Types.custom<Fill, FillResolved[]>(DEFAULT_PLOT_AREA.fill, { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    shadow: Types.custom<Shadow, ShadowResolved[]>(DEFAULT_PLOT_AREA.shadow, { resolve: shadowOps.resolve, lerp: shadowOps.lerp }),
    xGridStroke: strokeEntry(DEFAULT_X_AXIS.lineStyle),
    yGridStroke: strokeEntry(DEFAULT_Y_AXIS.lineStyle),
    /**
     * Data-unit positions of the vertical grid lines, one per horizontal marker.
     * Positions at or past an extent edge coincide with the border and are
     * skipped. Empty for a categorical axis, which has no numeric position to rule at.
     */
    xMarkers: fresh<number[]>(() => []),
    yMarkers: fresh<number[]>(() => []),
    /** `[min, max]` of each scale, mapping the markers into the panel. */
    xExtent: fresh<Range>(() => [0, 1]),
    yExtent: fresh<Range>(() => [0, 1]),
  },
  // The grid strokes sit past the conventional slots, so they are named here.
  load: (loader, state) =>
    loadPaints(loader, { fills: [state.fill], shadows: [state.shadow], strokes: [state.xGridStroke, state.yGridStroke] }),
  render: (ctx, state) => {
    const { width: W, height: H } = ctx.size
    if (W <= 0 || H <= 0) return

    ctx.draw(new Graphics2D().rect({ x: 0, y: 0, width: W, height: H }).shadow(state.shadow).fill(state.fill))

    const [xMin, xMax] = state.xExtent
    const [yMin, yMax] = state.yExtent
    // A zero-width extent maps to 0.
    const xFrac = (v: number) => (xMax <= xMin ? 0 : (v - xMin) / (xMax - xMin))
    const yFrac = (v: number) => (yMax <= yMin ? 0 : (v - yMin) / (yMax - yMin))
    // Markers on or past the edges would sit under the border.
    const interior = (f: number) => f > 1e-6 && f < 1 - 1e-6

    const xStroke = state.xGridStroke[0]
    if (xStroke) {
      const xGrid = new Graphics2D()
      for (const v of state.xMarkers) {
        const f = xFrac(v)
        if (!interior(f)) continue
        xGrid.rect({ x: -W / 2 + f * W, y: 0, width: xStroke.weight, height: H })
      }
      ctx.draw(xGrid.fill(xStroke.fill))
    }

    const yStroke = state.yGridStroke[0]
    if (yStroke) {
      const yGrid = new Graphics2D()
      for (const v of state.yMarkers) {
        const f = yFrac(v)
        if (!interior(f)) continue
        yGrid.rect({ x: 0, y: -H / 2 + f * H, width: W, height: yStroke.weight })
      }
      ctx.draw(yGrid.fill(yStroke.fill))
    }
  },
})

export type ChartCanvas = NodeOf<typeof ChartCanvas>
