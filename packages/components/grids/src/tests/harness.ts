import {
  Canvas2D,
  ContextMap,
  Registry,
  type CommandSpec,
  type CompositionDocument,
  type Node,
  type Node2D,
  type NodeConstructor,
  type NodeSpec,
} from "@motionscript/sdk"
import {
  ManifestAssetCatalog,
  NullRenderContext,
  ClipTimeline,
  sampleTree,
} from "@motionscript/core"

import type { FocusState, GridTransition, RevealState, WaveState } from "../kit"
import { NODES } from "../nodes"

export const VIEWPORT = { width: 1200, height: 900 }

/** A grid node as these tests read it: the entries every grid shares, a reference as the id it holds. */
export type GridNode = Node2D & {
  readonly order: number[]
  readonly spread: number
  readonly arrangeLike: string
  readonly revealState: RevealState | null | undefined
  readonly waveState: WaveState | null | undefined
  readonly focusState: FocusState | null | undefined
  readonly transition: GridTransition | null | undefined
}

/**
 * A composition built and evaluated the way the runtime does it — build,
 * settle, compile, then attach/evaluate/lay out/render per seek — into a
 * renderer that draws nothing. `nodes` is the node types it is built from.
 */
export function clip(nodes: NodeSpec[], commands: CommandSpec[] = [], types: readonly unknown[] = NODES) {
  const registry = new Registry({ nodes: types as unknown as NodeConstructor[] })
  const doc: CompositionDocument = {
    kind: "composition",
    nodes: [{ id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} }, ...nodes],
    commands,
  }
  const canvas = new Canvas2D({ id: "", ...VIEWPORT, flow: "freeform" } as never)
  const timeline = new ClipTimeline(doc, registry, canvas)
  const measurer = new NullRenderContext()
  const assets = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} })
  const attach = (time: number) => canvas.attach({ assets, context: ContextMap.EMPTY, time })
  const layout = () => canvas.layout({ x: 0, y: 0, ...VIEWPORT }, measurer)
  const settle = () => {
    sampleTree(canvas)
    layout()
  }
  attach(0)
  timeline.build()
  settle()
  timeline.compile(settle)
  layout()

  return {
    canvas,
    registry,
    /** The frame at `time`, drawn into `into`: what a grid declares of its camera is what its last render did. */
    seek(time: number, into: NullRenderContext = new NullRenderContext()) {
      attach(time)
      timeline.syncPresence(time)
      timeline.evaluateAt(time)
      layout()
      canvas.render(into)
    },
    node<T extends Node = Node>(id: string): T {
      const found = timeline.liveNode(id)
      if (!found) throw new Error(`no node "${id}"`)
      return found as T
    },
  }
}

/** A row under `parentId`. */
export function row(id: string, type: string, parentId: string | null, layerOrder: number, props: Record<string, unknown> = {}): NodeSpec {
  return { id, type, parentId, layerOrder, props }
}

/** `count` 60×60 squares under `parentId`, ids `${prefix}0…`. */
export function squares(parentId: string, count: number, prefix = "s"): NodeSpec[] {
  return Array.from({ length: count }, (_, i) => row(`${prefix}${i}`, "rect", parentId, i, { width: 60, height: 60, fill: "red" }))
}

/** A command row. With no `easing` the row leaves the command's own default in force. */
export function step(id: string, type: string, targetId: string, at: number, duration: number, args: Record<string, unknown> = {}, easing?: CommandSpec["easing"]): CommandSpec {
  return { id, type, targetId, at, duration, args, ...(easing ? { easing } : {}) } as CommandSpec
}

/** A row's easing: the straight line, so a time inside a command maps to the same share of it. */
export const LINEAR = { kind: "linear" } as const
