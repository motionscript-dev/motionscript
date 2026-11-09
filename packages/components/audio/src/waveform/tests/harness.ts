import {
  Canvas2D,
  ContextMap,
  Registry,
  fillOps,
  type CommandSpec,
  type CompositionDocument,
  type FillResolved,
  type Graphics2D,
  type Node2D,
  type NodeSpec,
} from "@motionscript/sdk"
import { ClipTimeline, ManifestAssetCatalog, NullRenderContext, sampleTree } from "@motionscript/core"

import { NODES } from "../../nodes"

const STAGE = { width: 600, height: 300 }

/** One run of bars as it was handed to the renderer: the rects it chained, and the paint it was filled with (resolved, so a colour string and a resolved fill compare alike). */
export interface Batch {
  rects: { x: number; y: number; width: number; height: number; cornerRadius?: number }[]
  fill: FillResolved[] | undefined
}

/**
 * A render context that keeps the draws it is handed instead of rasterizing them,
 * so a test reads what a node drew without a GPU surface.
 */
export class Recorder extends NullRenderContext {
  readonly drawn: Graphics2D[] = []

  protected override drawGraphics(graphics: Graphics2D): void {
    this.drawn.push(graphics)
  }

  /** One entry per `ctx.draw`, in draw order. */
  batches(): Batch[] {
    return this.drawn.map((graphics) => {
      const ops = graphics.ops()
      const fill = ops.find((op) => op.kind === "fill")
      return {
        rects: ops.flatMap((op) => (op.kind === "rect" ? [op.state as Batch["rects"][number]] : [])),
        fill: fill?.kind === "fill" ? fillOps.resolve(fill.fills) : undefined,
      }
    })
  }
}

/** A node row under the stage, present for the whole clip. */
export function waveform(type: "fullWaveform" | "liveWaveform", props: Record<string, unknown>, id = "wave"): NodeSpec {
  return { id, type, parentId: "", layerOrder: 0, props: { width: 400, height: 100, ...props } } as NodeSpec
}

/** A command row on `targetId`. With no `easing` the row leaves the command's own default in force. */
export function step(
  id: string,
  type: string,
  targetId: string,
  at: number,
  duration: number,
  args: Record<string, unknown> = {},
  easing?: CommandSpec["easing"],
): CommandSpec {
  return { id, type, targetId, at, duration, args, ...(easing ? { easing } : {}) } as CommandSpec
}

/**
 * A composition built and played the way a host does it: build, settle, compile,
 * then attach, evaluate and lay out per seek. `draw` runs the node's render pass
 * into a {@link Recorder}.
 */
export function play(nodes: NodeSpec[], commands: CommandSpec[] = []) {
  const registry = new Registry({ nodes: NODES })
  const doc = {
    kind: "composition",
    nodes: [{ id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} }, ...nodes],
    commands,
  } as CompositionDocument
  const canvas = new Canvas2D({ id: "", ...STAGE, flow: "freeform" } as never)
  const timeline = new ClipTimeline(doc, registry, canvas)
  const assets = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} })
  const measurer = new NullRenderContext()
  const attach = (time: number) => canvas.attach({ assets, context: ContextMap.EMPTY, time })
  const layout = () => canvas.layout({ x: 0, y: 0, ...STAGE }, measurer)

  attach(0)
  timeline.build()
  layout()
  timeline.compile(() => {
    sampleTree(canvas)
    layout()
  })

  const seek = (time: number) => {
    attach(time)
    timeline.syncPresence(time)
    timeline.evaluateAt(time)
    layout()
  }
  return {
    seek,
    node<T extends Node2D>(id = "wave"): T {
      const found = timeline.liveNode(id)
      if (!found) throw new Error(`no node "${id}"`)
      return found as T
    },
    /** Seeks to `time` and draws the node there. */
    draw(time: number, id = "wave"): Recorder {
      seek(time)
      const ctx = new Recorder()
      const node = timeline.liveNode(id) as Node2D
      ctx.execute(() => node.render(ctx))
      return ctx
    },
  }
}
