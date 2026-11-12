import {
  Rect,
  RotatedBox,
  Text,
  textOps,
  type ChildView,
  type Fill,
  type FillResolved,
  type Insets,
  type Node2D,
  type Size2D,
  type TextStyle,
} from "@motionscript/sdk"

import type { CartesianStyle, LegendPosition } from "./style"

/** Space between the frame's rows and columns: the plot and the legend, the axes and the legend. */
export function frameGap(style: Pick<CartesianStyle, "fontSize">): number {
  return Math.round(style.fontSize * 0.9)
}

/** Room above the plot for the top value marker, which is centred on the top grid line. */
export function headroom(style: Pick<CartesianStyle, "fontSize">): number {
  return Math.ceil(style.fontSize * 0.7)
}

/** How far an end marker of a horizontal value axis may hang past the plot: half a short caption. */
export function overhang(style: Pick<CartesianStyle, "fontSize">): number {
  return Math.ceil(style.fontSize * 1.1)
}

interface CartesianParts {
  /** The axis beside the plot, on its left. */
  readonly left?: Node2D
  /** An invisible twin of `left` under the plot, so the row there starts at the plot's left edge. */
  readonly ghost?: Node2D
  /** The box the grid and the marks share. */
  readonly plot: Node2D
  /** The axis under the plot. */
  readonly bottom?: Node2D
  readonly legend?: Node2D
  readonly legendAt: LegendPosition
  readonly gap: () => number
  readonly padding: () => Insets
}

/**
 * The frame the line and bar charts share. A legend above or below is centred
 * on the whole chart; one on the right is a column beside the plot. An axis the
 * style turns off is simply not here, and the plot takes its room.
 */
export function cartesianFrame(parts: CartesianParts): Node2D {
  const top = new Rect({ flow: "horizontal", width: "fill", height: "fill", children: [...(parts.left ? [parts.left] : []), parts.plot] })
  const rows: Node2D[] = [top as unknown as Node2D]
  if (parts.bottom) {
    rows.push(new Rect({ flow: "horizontal", width: "fill", height: "hug", children: [...(parts.ghost ? [parts.ghost] : []), parts.bottom] }) as unknown as Node2D)
  }
  const body = new Rect({ flow: "vertical", width: "fill", height: "fill", children: rows })
  const legend = parts.legend && parts.legendAt !== "none" ? parts.legend : undefined
  const main = new Rect({
    flow: "horizontal",
    width: "fill",
    height: "fill",
    align: "center",
    gap: parts.gap,
    children: [body, ...(legend && parts.legendAt === "right" ? [legend] : [])],
  })
  const across = (node: Node2D) => new Rect({ flow: "horizontal", width: "fill", height: "hug", align: "center", children: [node] })
  return new Rect({
    flow: "vertical",
    width: "fill",
    height: "fill",
    gap: parts.gap,
    padding: parts.padding,
    children: [
      ...(legend && parts.legendAt === "top" ? [across(legend)] : []),
      main,
      ...(legend && parts.legendAt === "bottom" ? [across(legend)] : []),
    ],
  }) as unknown as Node2D
}

/** Every view under `children`, depth first in build order: the axis beside the plot comes before its twin, which holds no parts. */
export function chartViews(children: readonly ChildView[]): ChildView[] {
  const out: ChildView[] = []
  const walk = (views: readonly ChildView[]) => {
    for (const view of views) {
      out.push(view)
      walk(view.children)
    }
  }
  walk(children)
  return out
}

/** A part's laid-out size; zero before it is built or laid out. */
export function laidOutSize(node: Node2D | undefined): Size2D {
  const bounds = node?.layoutBounds
  return { width: bounds?.width ?? 0, height: bounds?.height ?? 0 }
}

/**
 * A text style as props bound to `read`, so a style tween reaches text built
 * once. Only the keys set at build are bound: an unset family stays unset, so
 * the host's default face still applies.
 */
export function boundText(read: () => TextStyle): Record<string, unknown> {
  const keys = Object.keys(textOps.styleProps(read())) as (keyof TextStyle)[]
  const props: Record<string, unknown> = {}
  for (const key of keys) props[key] = () => read()[key]
  return props
}

interface GhostSpec {
  readonly captions: () => readonly string[]
  /** How many captions the real axis built. */
  readonly count: number
  readonly text: () => TextStyle
  readonly title: string
  readonly titleText: () => TextStyle
  readonly tickPad: () => number
  readonly titlePad: () => number
}

/**
 * An invisible column as wide as a vertical axis built from the same captions:
 * the widest caption plus the tick padding, and the rotated title before it. A
 * plain tree, so a command looking for the axis never finds this instead.
 */
export function columnGhost(spec: GhostSpec): Node2D {
  const captions = Array.from({ length: spec.count }, (_, i) => new Text({ ...boundText(spec.text), text: () => spec.captions()[i] ?? "" }))
  const children: Node2D[] = []
  if (spec.title !== "") {
    children.push(new RotatedBox({ angle: -90, width: "hug", height: "hug", children: new Text({ ...boundText(spec.titleText), text: spec.title }) }) as unknown as Node2D)
  }
  children.push(new Rect({ flow: "vertical", width: "hug", height: "hug", padding: () => ({ right: spec.tickPad() }), children: captions }) as unknown as Node2D)
  return new Rect({ opacity: 0, flow: "horizontal", gap: spec.titlePad, width: "hug", height: 0, children }) as unknown as Node2D
}

/** `fill` with every layer's opacity scaled by `k`. */
export function fade(fill: Fill, k: number): Fill {
  const layers = (Array.isArray(fill) ? fill : [fill]) as FillResolved[]
  return layers.map((layer) => (typeof layer === "object" && layer !== null ? { ...layer, opacity: ((layer as { opacity?: number }).opacity ?? 1) * k } : layer)) as Fill
}
