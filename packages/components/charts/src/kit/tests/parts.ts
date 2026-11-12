import type { Node2D, NodeOf } from "@motionscript/sdk"

import { ChartCanvas } from "../chart-canvas"

/** Every node under `root`, depth first in build order. */
export function descendants(root: Node2D): Node2D[] {
  const out: Node2D[] = []
  const walk = (node: Node2D) => {
    for (const child of node.children as Node2D[]) {
      out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out
}

/** A component, by what a test needs of it: its node class. */
type Built = { readonly node: abstract new (...args: never[]) => unknown }

/** The first part of `component`'s type under `root`: the one a chart's command reaches. */
export function partOf<C extends Built>(root: Node2D, component: C): NodeOf<C> | undefined {
  return descendants(root).find((node) => node instanceof component.node) as NodeOf<C> | undefined
}

export function partsOf<C extends Built>(root: Node2D, component: C): NodeOf<C>[] {
  return descendants(root).filter((node) => node instanceof component.node) as unknown as NodeOf<C>[]
}

/** The plot panel: the box the grid and the marks share. */
export function plotOf(root: Node2D): Node2D {
  return (partOf(root, ChartCanvas) as unknown as Node2D).parent as Node2D
}
