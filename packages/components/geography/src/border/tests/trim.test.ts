import { beforeAll, describe, expect, it } from "vitest"
import {
    ContextMap,
    type Graphics2D,
    type GraphicsOp,
    type RenderContext2D,
    type Size2D,
} from "@motionscript/sdk"
import { CanvasRenderContext2D, ManifestAssetCatalog } from "@motionscript/core"

import { GeoBorder } from "../geo-border"
import { countryFileKey, loadGeoFile } from "../loader"
import { geoRegistry } from "../registry"
import { fixtureSource } from "./fixture-source"

beforeAll(async () => {
    geoRegistry.use(fixtureSource)
    await loadGeoFile(countryFileKey("FR"))
})

class Recorder extends CanvasRenderContext2D {
    readonly draws: GraphicsOp[][] = []
    protected drawGraphics(graphics: Graphics2D): void {
        this.draws.push([...graphics.ops()])
    }
    measureText(text: string, fontSize: number): Size2D {
        return { width: text.length * fontSize * 0.6, height: fontSize }
    }
    unmount(): void { }
    execute(callback: () => void): void { callback() }
    screenshot(): undefined { return undefined }
    transform(): RenderContext2D { return this }
    beginBoolean(): void { }
    endBoolean(): void { }
    beginMask(): void { }
    applyMask(): void { }
    endMask(): void { }
    beginClip(): void { }
    endClip(): void { }
    beginCamera(): void { }
    endCamera(): void { }
}

/** The three passes a node paints in, in order: the fill, the overlay over the children, the stroke. */
type Pass = "fill" | "overlay" | "stroke"

/** The path ops one pass of a drawn node records. */
function pathsOf(pass: Pass, props: Record<string, unknown>) {
    const node = new GeoBorder({ iso: "FR", frame: "mainland", detail: 0.3, ...props } as never)
    node.attach({
        assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }),
        context: ContextMap.EMPTY,
        time: 0,
    })
    const ctx = new Recorder()
    node.layout({ x: 0, y: 0, width: 200, height: 200 }, ctx)
    ctx.execute(() => node.render(ctx))
    // Only a pass with something to paint draws: what a stroke-only or unfilled node skips moves the rest up.
    const paints: Pass[] = []
    if (props.fill) paints.push("fill")
    if (props.overlay) paints.push("overlay")
    if (props.stroke) paints.push("stroke")
    const drawn = ctx.draws.filter((ops) => ops.some((op) => op.kind === "path"))
    return (drawn[paints.indexOf(pass)] ?? [])
        .filter((op) => op.kind === "path")
        .map((op) => (op as unknown as { state: { start?: number; end?: number } }).state)
}

const PAINT = { fill: "#1d3557", overlay: "#ffffff40", stroke: { weight: 3, fill: "#f1faee" } }

describe("GeoBorder start and end", () => {
    // `start` and `end` draw the whole node on: the fill and the overlay are
    // trimmed along with the line, so a filled node grows as partial polygons
    // closed by a chord, and a stroke-only one grows as an outline. Trimming the
    // line alone would need its own prop.
    it.each(["fill", "overlay", "stroke"] as const)("trims what the %s pass draws", (pass) => {
        const whole = pathsOf(pass, PAINT)
        expect(whole.length).toBeGreaterThan(0)
        for (const op of whole) expect(op.end ?? 1).toBe(1)

        const half = pathsOf(pass, { ...PAINT, end: 0.5 })
        expect(half.length).toBeGreaterThan(0)
        for (const op of half) expect(op.end).toBeLessThanOrEqual(1)
        expect(half.some((op) => op.end !== undefined && op.end < 1)).toBe(true)
    })

    it("draws nothing for a fill when start is not below end", () => {
        expect(pathsOf("fill", { ...PAINT, start: 0.6, end: 0.4 })).toHaveLength(0)
        expect(pathsOf("stroke", { ...PAINT, start: 0.6, end: 0.4 })).toHaveLength(0)
    })
})
