import { describe, expect, it } from "vitest";
import { fillOps, Graphics2D, strokeOps, type TextSegment } from "@motionscript/core";
import type { Node, Paint } from "../../doc";
import { WgpuRenderContext } from "../context";

/** A segmented text paints itself: core sends no fill or stroke op after it. */
function textNodes(state: Record<string, unknown>): Node[] {
    const ctx = new WgpuRenderContext(400, 300, (text, size) => ({ width: text.length * size * 0.5, height: size }));
    ctx.execute(() => ctx.draw(new Graphics2D().text(state as never)));
    const out: Node[] = [];
    const walk = (n: Node) => {
        if (n.kind === "text") out.push(n);
        n.children.forEach(walk);
    };
    walk(ctx.doc.root);
    return out;
}

const red = fillOps.resolve("#ff0000" as never);
const blue = fillOps.resolve("#0000ff" as never);

function segment(text: string, over: Partial<TextSegment> = {}): TextSegment {
    return {
        text, fontFamily: "Inter", fontSize: 40, fontStyle: "normal", fontWeight: 400, letterSpacing: 0,
        textDecoration: "none", opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, fill: red, stroke: [], ...over,
    };
}

const alpha = (p: Paint | undefined) => (p?.kind === "solid" ? p.color[3] : undefined);

describe("segmented text (styled runs, a Write On reveal)", () => {
    it("draws every character, the unrevealed ones clear, so the line keeps its layout", () => {
        const [node, ...rest] = textNodes({
            text: "Hello", fontFamily: "Inter", fontSize: 40, width: 200, height: 60,
            segments: [segment("Hel"), segment("lo", { opacity: 0 })],
        });
        expect(rest).toEqual([]);
        expect(node.text!.runs.map((r) => r.text)).toEqual(["Hel", "lo"]);
        expect(node.text!.runs.map((r) => alpha(r.paint))).toEqual([1, 0]);
    });

    it("paints each run with its own fill", () => {
        const [node] = textNodes({
            text: "ab", fontFamily: "Inter", fontSize: 40, width: 100, height: 60,
            segments: [segment("a"), segment("b", { fill: blue, fontSize: 60, fontWeight: 700 })],
        });
        expect(node.text!.runs).toMatchObject([
            { text: "a", size: 40, weight: 400, paint: { kind: "solid", color: [1, 0, 0, 1] } },
            { text: "b", size: 60, weight: 700, paint: { kind: "solid", color: [0, 0, 1, 1] } },
        ]);
    });

    it("strokes the runs that carry a stroke", () => {
        const stroke = strokeOps.resolve({ fill: "#0000ff", weight: 3, align: "center" } as never);
        const nodes = textNodes({
            text: "ab", fontFamily: "Inter", fontSize: 40, width: 100, height: 60,
            segments: [segment("a", { stroke }), segment("b", { stroke, opacity: 0 })],
        });
        const stroked = nodes.find((n) => n.stroke && n.stroke.width > 0)!;
        expect(stroked.stroke!.width).toBe(3);
        expect(stroked.text!.runs.map((r) => alpha(r.paint))).toEqual([1, 0]);
    });

    it("fits an autofit block's runs to its box, which the renderer does for a single run only", () => {
        const [node] = textNodes({
            text: "Hello", fontFamily: "Inter", fontSize: "autofit", width: 125, height: 100,
            segments: [segment("Hel", { fontSize: 100 }), segment("lo", { fontSize: 100, opacity: 0 })],
        });
        expect(node.text!.fontSize).toBeUndefined();
        expect(node.text!.runs.map((r) => r.size)).toEqual([50, 50]);
    });

    it("draws nothing visible for a reveal that has not started", () => {
        const nodes = textNodes({
            text: "Hi", fontFamily: "Inter", fontSize: 40, width: 100, height: 60,
            segments: [segment("Hi", { opacity: 0 })],
        });
        expect(nodes.length).toBeGreaterThan(0);
        for (const n of nodes) for (const r of n.text!.runs) expect(alpha(r.paint)).toBe(0);
    });
});
