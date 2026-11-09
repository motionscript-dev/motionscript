import { ManifestAssetCatalog, NullRenderContext } from "@motionscript/core"
import { ContextMap, type Clip, type Graphics2D, type Node, type PathCommand } from "@motionscript/sdk"

/** One drawing, with its op kinds in order — `rect+shadow+fill`, `path+stroke`. */
export interface Drawing {
  graphics: Graphics2D
  kinds: string[]
}

/**
 * A render context that writes down what a pattern asks of it: the drawings in
 * order, and where each clip opens and closes among them. It paints nothing, but
 * it walks as a painting backend would.
 */
export class Recorder extends NullRenderContext {
  readonly drawings: Drawing[] = []
  readonly clips: Clip[] = []
  /** `draw:<kinds>`, `beginClip`, `endClip`, in the order they happened. */
  readonly events: string[] = []

  protected override drawGraphics(graphics: Graphics2D): void {
    const kinds = graphics.ops().map((op) => op.kind)
    this.drawings.push({ graphics, kinds })
    this.events.push(`draw:${kinds.join("+")}`)
  }

  override beginClip(clip: Clip): void {
    this.clips.push(clip)
    this.events.push("beginClip")
  }

  override endClip(): void {
    this.events.push("endClip")
  }

  /** The drawings that stroke a path — the grid lines — in order. */
  get lineDrawings(): Drawing[] {
    return this.drawings.filter((d) => d.kinds.join("+") === "path+stroke")
  }
}

const EMPTY_CATALOG = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} })

/** Attach `node` as a live root, so it can render and be animated. */
export function mount<T extends Node>(node: T, time = 0): T {
  node.attach({ assets: EMPTY_CATALOG, context: ContextMap.EMPTY, time })
  return node
}

/** Render a mounted, laid-out node into a fresh recorder. */
export function render(node: { render(ctx: Recorder): void }): Recorder {
  const ctx = new Recorder()
  node.render(ctx)
  return ctx
}

/** What a drawing's `path` op carries. */
export function pathOf(drawing: Drawing): { data: PathCommand[]; centerBounds: readonly number[] } {
  const op = drawing.graphics.ops().find((o) => o.kind === "path") as
    | { state: { data: PathCommand[]; centerBounds: readonly number[] } }
    | undefined
  if (!op) throw new Error("no path op in this drawing")
  return op.state
}

/** The strokes a drawing's `stroke` op carries. */
export function strokesOf(drawing: Drawing): Array<{
  weight: number
  align: number
  dash?: number[]
  dashOffset: number
  fill: Array<{ opacity?: number; color?: number[] }>
}> {
  const op = drawing.graphics.ops().find((o) => o.kind === "stroke") as { strokes: never } | undefined
  if (!op) throw new Error("no stroke op in this drawing")
  return op.strokes
}

/** The vertical and horizontal lines of a union path, as the positions they sit at, in drawing order. */
export function linesOf(data: PathCommand[]): { vertical: number[]; horizontal: number[] } {
  const vertical: number[] = []
  const horizontal: number[] = []
  for (let i = 0; i + 1 < data.length; i += 2) {
    const from = data[i] as { x: number; y: number }
    const to = data[i + 1] as { x: number; y: number }
    if (from.x === to.x) vertical.push(from.x)
    else horizontal.push(from.y)
  }
  return { vertical, horizontal }
}
