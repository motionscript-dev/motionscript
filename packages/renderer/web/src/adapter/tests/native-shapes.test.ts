import { describe, expect, it } from "vitest";
import { Graphics2D } from "@motionscript/core";
import type { Node } from "../../doc";
import { WgpuRenderContext } from "../context";

/** The leaves one Graphics2D draws into a fresh doc. */
function leaves(g: Graphics2D): Node[] {
    const ctx = new WgpuRenderContext(400, 300, () => ({ width: 0, height: 0 }));
    ctx.execute(() => ctx.draw(g));
    const out: Node[] = [];
    const walk = (n: Node) => {
        if (n.kind !== "group") out.push(n);
        n.children.forEach(walk);
    };
    walk(ctx.doc.root);
    return out;
}

const kinds = (g: Graphics2D) => leaves(g).map((n) => n.kind);
/** Drawn, and only as paths (or compounds of them). */
function expectPaths(g: Graphics2D, what: string): void {
    const drawn = kinds(g);
    expect(drawn.length > 0 && drawn.every((k) => k === "path" || k === "compound"), `${what}: ${drawn.join(", ")}`).toBe(true);
}

describe("a rect or ellipse drawn as the renderer's own shape", () => {
    it("fills solid as a rect node in its box, y down, corners tl tr br bl", () => {
        const [rect] = leaves(new Graphics2D().rect({ x: 10, y: 20, width: 40, height: 30, cornerRadius: { topLeft: 4, topRight: 0, bottomRight: 6, bottomLeft: 2 } }).fill("#ff0000"));
        expect(rect).toMatchObject({ kind: "rect", w: 40, h: 30, radii: [4, 0, 6, 2] });
        expect(rect.transform).toEqual([1, 0, 0, 1, 10 - 20, -20 - 15]);
        expect(rect.fill).toMatchObject({ kind: "solid" });
    });

    it("fills a whole ellipse as an ellipse node", () => {
        expect(leaves(new Graphics2D().ellipse({ width: 30, height: 10 }).fill("blue"))).toMatchObject([{ kind: "ellipse", w: 30, h: 10 }]);
    });

    it("keeps a path for whatever the renderer's shape would draw otherwise", () => {
        const g = () => new Graphics2D();
        const cases: [string, Graphics2D][] = [
            ["a gradient", g().rect({ width: 20, height: 20 }).fill({ type: "linear-gradient", colors: ["red", "blue"] } as never)],
            ["a shadow", g().rect({ width: 20, height: 20 }).shadow({ color: "black", blur: 4 } as never).fill("red")],
            ["a turn of its own", g().rect({ width: 20, height: 20, rotation: 30 }).fill("red")],
            ["a trim", g().ellipse({ width: 20, height: 20, end: 0.5 }).fill("red")],
            ["a hole", g().ellipse({ width: 20, height: 20, ratio: 0.5 }).fill("red")],
            ["a partial sweep", g().ellipse({ width: 20, height: 20, sweep: 90 }).fill("red")],
            ["an angled corner", g().rect({ width: 20, height: 20, cornerRadius: 4, cornerStyle: "angled" }).fill("red")],
            ["a radius past half the short side", g().rect({ width: 100, height: 20, cornerRadius: { topLeft: 18, topRight: 0, bottomRight: 0, bottomLeft: 2 } }).fill("red")],
            ["two shapes painted together", g().rect({ width: 20, height: 20 }).ellipse({ x: 30, width: 20, height: 20 }).fill("red")],
        ];
        for (const [what, graphics] of cases) expectPaths(graphics, what);
    });

    it("strokes a rect centred at its width, and a biased band round the offset rect", () => {
        const at = (align: unknown) => leaves(new Graphics2D().rect({ width: 40, height: 20, cornerRadius: 6 }).stroke({ fill: "red", weight: 4, align } as never));
        expect(at("center")).toMatchObject([{ kind: "rect", w: 40, h: 20, radii: [6, 6, 6, 6], stroke: { width: 4 } }]);
        expect(at("inside")).toMatchObject([{ kind: "rect", w: 36, h: 16, radii: [4, 4, 4, 4], stroke: { width: 4 } }]);
        expect(at("outside")).toMatchObject([{ kind: "rect", w: 44, h: 24, radii: [8, 8, 8, 8], stroke: { width: 4 } }]);
    });

    it("strokes a circle, but not an ellipse, whose offset outline is no ellipse", () => {
        const stroke = { fill: "red", weight: 2, align: "center" } as never;
        expect(kinds(new Graphics2D().ellipse({ width: 20, height: 20 }).stroke(stroke))).toEqual(["ellipse"]);
        expect(kinds(new Graphics2D().ellipse({ width: 30, height: 20 }).stroke(stroke))).toEqual(["path"]);
    });

    it("keeps a path for a stroke the renderer's shape would draw otherwise", () => {
        const rect = () => new Graphics2D().rect({ width: 40, height: 20 });
        const rounded = () => new Graphics2D().rect({ width: 40, height: 20, cornerRadius: 2 });
        const cases: [string, Graphics2D][] = [
            ["a dash", rect().stroke({ fill: "red", weight: 2, align: "center", dash: [4, 2] } as never)],
            ["a round join on a square corner", rect().stroke({ fill: "red", weight: 2, align: "center", join: "round" } as never)],
            ["a rounded corner shrunk away", rounded().stroke({ fill: "red", weight: 8, align: "inside" } as never)],
            ["a gradient", rect().stroke({ fill: { type: "linear-gradient", colors: ["red", "blue"] }, weight: 2, align: "center" } as never)],
        ];
        for (const [what, graphics] of cases) expectPaths(graphics, what);
    });
});
