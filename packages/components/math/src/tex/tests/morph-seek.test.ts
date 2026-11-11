import { describe, expect, it, vi } from "vitest";
import {
    Canvas2D,
    ContextMap,
    Registry,
    type CompositionDocument,
    type Graphics2D,
    type PathCommand,
} from "@motionscript/sdk";
import { ClipTimeline, ManifestAssetCatalog, NullRenderContext, sampleTree } from "@motionscript/core";

import { NODES } from "../../nodes";

// `geometry.ts` needs a DOM to typeset; the morph's bookkeeping does not. One
// square glyph per character, wider formulas wider.
vi.mock("../geometry", async (original) => {
    const real = await original<typeof import("../geometry")>();
    const square = (x: number): PathCommand[] => [
        { type: "M", x, y: 0 },
        { type: "L", x: x + 8, y: 0 },
        { type: "L", x: x + 8, y: 8 },
        { type: "Z" },
    ];
    return {
        ...real,
        buildLatexPath: (text: string, fontSize: number) => ({
            tokens: [...text].map((ch, i) => ({ token: ch, path: square(i * 10) })),
            parts: [],
            width: text.length * 10 * (fontSize / 16),
            height: 8,
            bounds: [0, 0, text.length * 10, 8] as [number, number, number, number],
        }),
    };
});

const STAGE = { width: 400, height: 200 };

class Recorder extends NullRenderContext {
    readonly drawn: Graphics2D[] = [];

    protected override drawGraphics(graphics: Graphics2D): void {
        this.drawn.push(graphics);
    }
}

/** Each glyph drawn, as where its square starts and how opaque it is painted. */
function glyphsOf(ctx: Recorder): string[] {
    return ctx.drawn.map((graphics) => {
        const ops = graphics.ops();
        const data = (ops.find((op) => op.kind === "path")!.state as { data: string }).data;
        const fill = ops.find((op) => op.kind === "fill") as unknown as { fills: { opacity?: number }[] };
        return `${/M\s*(-?[\d.]+)/.exec(data)![1]}:${(fill.fills[0].opacity ?? 1).toFixed(2)}`;
    });
}

/** A `latex` node morphing from "ab" to "abcd" over clip time 1..2, and a seek that draws a frame at a time. */
function play() {
    const doc = {
        kind: "composition",
        nodes: [
            { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} },
            { id: "f", type: "latex", parentId: "", layerOrder: 0, props: { latex: "ab", fontSize: 16, fill: "#ffffff" } },
        ],
        commands: [
            { id: "m", targetId: "f", type: "morphTo", at: 1, duration: 1, args: { latex: "abcd" }, easing: { kind: "linear" } },
        ],
    } as unknown as CompositionDocument;
    const registry = new Registry({ nodes: NODES });
    const canvas = new Canvas2D({ id: "", ...STAGE, flow: "freeform" } as never);
    const timeline = new ClipTimeline(doc, registry, canvas);
    const assets = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} });
    const measurer = new NullRenderContext();
    const attach = (time: number) => canvas.attach({ assets, context: ContextMap.EMPTY, time });
    const layout = () => canvas.layout({ x: 0, y: 0, ...STAGE }, measurer);
    attach(0);
    timeline.build();
    layout();
    timeline.compile(() => {
        sampleTree(canvas);
        layout();
    });
    return (time: number) => {
        attach(time);
        timeline.syncPresence(time);
        timeline.evaluateAt(time);
        layout();
        const node = timeline.liveNode("f")!;
        const ctx = new Recorder();
        ctx.execute(() => canvas.render(ctx));
        return { glyphs: glyphsOf(ctx), width: (node as unknown as { layoutBounds: { width: number } }).layoutBounds.width };
    };
}

describe("a LaTeX morph, scrubbed", () => {
    it("shows the source formula again after a seek from inside the morph to before it", () => {
        const seek = play();
        const before = seek(0.5);
        expect(before.glyphs).toEqual(["0:1.00", "10:1.00"]);

        // Three quarters through, the glyphs that arrive are half in.
        const inside = seek(1.75);
        expect(inside.glyphs).toEqual(["0:1.00", "10:1.00", "20:0.50", "30:0.50"]);
        expect(inside.width).toBeGreaterThan(before.width);

        const back = seek(0.5);
        expect(back).toEqual(before);
    });

    it("lands on the target formula after it, and again after a trip back and forward", () => {
        const seek = play();
        const after = seek(2.5);
        expect(after.glyphs).toEqual(["0:1.00", "10:1.00", "20:1.00", "30:1.00"]);
        seek(1.5);
        seek(0.25);
        expect(seek(2.5)).toEqual(after);
    });
});
