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
  // Named so this component's emitted type reaches `Node2D` through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps,
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

export interface ChartCanvasProps extends Node2DProps {
  /** Fill of the plot panel behind the marks. */
  fill: Fill
  /** Drop shadow of the panel. Default none. */
  shadow: Shadow
  /** Stroke of the vertical grid lines (one per {@link xMarkers}). */
  xGridStroke: Stroke
  /** Stroke of the horizontal grid lines (one per {@link yMarkers}). */
  yGridStroke: Stroke
  /**
   * Data-unit x positions to draw a vertical grid line at — one per horizontal
   * axis marker, so a line lands under every marker regardless of spacing.
   * Positions at (or past) an {@link xExtent} edge coincide with the border and
   * are skipped. Pass an empty list for a chart whose horizontal axis is
   * categorical and so has no numeric position to rule at.
   */
  xMarkers: number[]
  /** Data-unit y positions to draw a horizontal grid line at. */
  yMarkers: number[]
  /** `[min, max]` of the horizontal scale — maps {@link xMarkers} into the panel. */
  xExtent: Range
  /** `[min, max]` of the vertical scale — maps {@link yMarkers} into the panel. */
  yExtent: Range
}

const strokeEntry = (initial: Stroke) =>
  Types.custom<Stroke, StrokeResolved[]>(initial, { resolve: strokeOps.resolve, lerp: strokeOps.lerp })

/**
 * The plot **backdrop** of a cartesian chart: a filled panel with a grid of
 * faint lines spanning both directions across it, sized from its box and centred
 * on its origin.
 *
 * The thick frame is a **separate** {@link ChartBorder} node so it can be drawn
 * *over* the marks while this panel sits under them. Grid lines are placed from
 * the axis marker positions (in data units) mapped into the panel through
 * {@link ChartCanvasProps.xExtent}/`yExtent` — so each line lands under its
 * marker whether or not the markers are evenly spaced.
 */
export const ChartCanvas = component2d({
  key: "chartCanvas",
  state: {
    fill: Types.custom<Fill, FillResolved[]>(DEFAULT_PLOT_AREA.fill, { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    shadow: Types.custom<Shadow, ShadowResolved[]>(DEFAULT_PLOT_AREA.shadow, { resolve: shadowOps.resolve, lerp: shadowOps.lerp }),
    xGridStroke: strokeEntry(DEFAULT_X_AXIS.lineStyle),
    yGridStroke: strokeEntry(DEFAULT_Y_AXIS.lineStyle),
    xMarkers: fresh<number[]>(() => []),
    yMarkers: fresh<number[]>(() => []),
    xExtent: fresh<Range>(() => [0, 1]),
    yExtent: fresh<Range>(() => [0, 1]),
  },
  // The grid strokes are named past the conventional slots, so they are named here.
  load: (loader, state) =>
    loadPaints(loader, { fills: [state.fill], shadows: [state.shadow], strokes: [state.xGridStroke, state.yGridStroke] }),
  render: (ctx, state) => {
    const { width: W, height: H } = ctx.size
    if (W <= 0 || H <= 0) return

    // Plot panel, centred on the origin (node space is y-up, origin centre).
    ctx.draw(new Graphics2D().rect({ x: 0, y: 0, width: W, height: H }).shadow(state.shadow).fill(state.fill))

    const [xMin, xMax] = state.xExtent
    const [yMin, yMax] = state.yExtent
    // Fraction of a marker across its extent; guard a zero-width extent.
    const xFrac = (v: number) => (xMax <= xMin ? 0 : (v - xMin) / (xMax - xMin))
    const yFrac = (v: number) => (yMax <= yMin ? 0 : (v - yMin) / (yMax - yMin))
    // Skip markers landing on (or outside) the edges — they'd sit under the border.
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
