import { Rect, type ChildView, type Node2D, type Size2D } from "@motionscript/sdk"

import { VerticalAxis } from "./vertical-axis"

/**
 * Headroom above the plot, in px.
 *
 * Two jobs, and the second is why it is real padding on the composition rather
 * than a number the point-mapping math imagines: a series peaking at the top of
 * the scale isn't flush to the top edge, **and** the top marker, which is
 * centred on that top grid line, has somewhere to be. Without it the marker's
 * upper half is drawn above the chart's own box.
 */
export const TOP_HEADROOM = 24

/** The parts of a cartesian chart's frame, as {@link cartesianFrame} arranges them. */
export interface CartesianParts {
  /** The value axis, left of the plot. */
  readonly axis: Node2D
  /** The plot panel: the box the grid and the marks share. */
  readonly plot: Node2D
  /** An invisible twin of the value axis, reserving its gutter under the plot. */
  readonly gutter: Node2D
  /** What sits under the plot, top to bottom: the other axis, then the legend. */
  readonly below: readonly Node2D[]
}

/**
 * The frame the line and bar charts share: the value axis beside the plot, and
 * under them the gutter beside the rows below the plot, so those rows start at
 * the plot's left edge rather than the chart's.
 */
export function cartesianFrame(parts: CartesianParts): Node2D {
  return new Rect({
    flow: "vertical",
    width: "fill",
    height: "fill",
    padding: { top: TOP_HEADROOM },
    children: [
      new Rect({ flow: "horizontal", height: "fill", width: "fill", children: [parts.axis, parts.plot] }),
      new Rect({
        flow: "horizontal",
        width: "fill",
        children: [parts.gutter, new Rect({ flow: "vertical", width: "fill", gap: 20, children: [...parts.below] })],
      }),
    ],
  }) as unknown as Node2D
}

/** A cartesian frame's parts, as a command reaches them through its chart's children. */
export interface CartesianViews {
  readonly axis: ChildView
  /** The plot panel's own children: the grid, the marks, the border. */
  readonly plot: readonly ChildView[]
  readonly below: readonly ChildView[]
}

/**
 * The frame among a chart's children: the last child shaped as
 * {@link cartesianFrame} builds it. The chart builds it after the children it
 * was given, and a document adds its own later still, so it is found by shape.
 */
export function cartesianViews(children: readonly ChildView[]): CartesianViews | null {
  for (let i = children.length - 1; i >= 0; i--) {
    const frame = children[i]
    if (!Rect.is(frame)) continue
    const [top, bottom] = frame.children
    const axis = top?.children[0]
    const plot = top?.children[1]
    const below = bottom?.children[1]
    if (!axis || !VerticalAxis.is(axis) || !plot || !below) continue
    return { axis, plot: plot.children, below: below.children }
  }
  return null
}

/** A part's laid-out size, or nothing before it is built or laid out. */
export function laidOutSize(node: Node2D | undefined): Size2D {
  const bounds = node?.layoutBounds
  return { width: bounds?.width ?? 0, height: bounds?.height ?? 0 }
}
