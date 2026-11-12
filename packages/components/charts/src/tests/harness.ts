import {
  ContextMap,
  fillOps,
  type Command,
  type FillResolved,
  type Graphics2D,
  type GraphicsOp,
  type Node,
  type Node2D,
  type Size2D,
  type Text,
} from "@motionscript/sdk"
import { ManifestAssetCatalog, NullRenderContext } from "@motionscript/core"

/** The time a node is attached at is whatever the caller says; the catalog is empty. */
const catalog = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} })

/** Puts `node` in a live tree at `time`: laying out, drawing and animating all need it. */
export function attachAt<T extends Node>(node: T, time = 0): T {
  node.attach({ assets: catalog, context: ContextMap.EMPTY, time })
  return node
}

/**
 * Gives text a size — half an em a glyph, one and a fifth an em tall — so the
 * axes and the legend lay out as they would in a host, and keeps every draw it
 * is handed instead of rasterizing it.
 */
export class Recorder extends NullRenderContext {
  readonly drawn: Graphics2D[] = []

  protected override drawGraphics(graphics: Graphics2D): void {
    this.drawn.push(graphics)
  }

  override measureText(...args: unknown[]): Size2D {
    const [text, fontSize] = args as [string, number]
    return { width: text.length * fontSize * 0.5, height: fontSize * 1.2 }
  }

  /** The ops of every draw, in draw order. */
  ops(): GraphicsOp[][] {
    return this.drawn.map((graphics) => [...graphics.ops()])
  }
}

/** The rects a draw chained, in order. */
export function rectsOf(ops: readonly GraphicsOp[]) {
  return ops.flatMap((op) => (op.kind === "rect" ? [op.state as { x: number; y: number; width: number; height: number }] : []))
}

/** The resolved layers of a draw's fill op, whichever spelling the node wrote. */
export function fillOf(ops: readonly GraphicsOp[]): FillResolved[] | undefined {
  const fill = ops.find((op) => op.kind === "fill")
  return fill?.kind === "fill" ? fillOps.resolve(fill.fills as never) : undefined
}

/**
 * Attaches `node`, lays it out in a box and draws it into a fresh {@link Recorder}.
 * Returns the recorder, which has the measurer's answers built in.
 */
export function draw(node: Node2D, box: { width: number; height: number }, time = 0): Recorder {
  attachAt(node, time)
  const ctx = new Recorder()
  node.layout({ x: 0, y: 0, ...box }, ctx)
  ctx.execute(() => node.render(ctx))
  return ctx
}

/** Lays a node out without drawing it. */
export function layOut(node: Node2D, box: { width: number; height: number }, time = 0): Recorder {
  attachAt(node, time)
  const ctx = new Recorder()
  node.layout({ x: 0, y: 0, ...box }, ctx)
  return ctx
}

/** Anything a command returns that can be asked for a frame at a time: a command or a seekable. */
type Playable = Pick<Command<unknown>, "_stepper">

/** The command's frame at `seconds` into it, from the start every time. */
export function at(playable: Playable, seconds: number): void {
  const step = playable._stepper()
  step.seek(0)
  step.seek(seconds)
}

/**
 * One stepper for the whole run, primed at 0: what a timeline holds while a clip
 * is scrubbed. Tweens snapshot the node when the stepper is made, so a test that
 * seeks forwards and back has to seek the *same* stepper rather than making one
 * per frame.
 */
export function scrub(playable: Playable): (seconds: number) => void {
  const step = playable._stepper()
  step.seek(0)
  return (seconds) => step.seek(seconds)
}

/** A value axis's marker text, top → bottom: the column that ends the row it is made of. */
export function verticalMarkers(axis: Node2D): Text[] {
  const row = axis.children[0]
  return row.children[row.children.length - 1].children as Text[]
}

/** A horizontal axis's marker text, left → right: the row that starts the column it is made of. */
export function horizontalMarkers(axis: Node2D): Text[] {
  return axis.children[0].children[0].children as Text[]
}
