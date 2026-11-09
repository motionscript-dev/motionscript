import { describe, expect, it } from "vitest";
import { childPlanePointAt, parentPlanePointAt, type Graphics2D, type Node2D } from "@motionscript/sdk";
import type { Latex } from "../tex/node";
import { inkOf, play, scene, type Row, type Step } from "./harness";

/** 800 × 400 with no padding: 100 px a unit both ways over [-4, 4] × [-2, 2]. */
const AXES: Row = { id: "axes", type: "axes2d", props: { width: 800, height: 400, xRange: [-4, 4], yRange: [-2, 2], labels: false } };
const PLOT: Row = { id: "plot", type: "functionPlot", parentId: "axes", props: { expression: "x / 2" } };

/** The same mark twice: inside the plot with nothing said, and beside it naming it. */
function bothWays(type: string, props: Record<string, unknown>, steps: Step[] = []) {
    const inside = play(scene([AXES, PLOT, { id: "m", type, parentId: "plot", props }], steps));
    const beside = play(scene([AXES, PLOT, { id: "m", type, parentId: "axes", props: { ...props, on: "plot" } }], steps));
    return { inside, beside };
}

/** A node's ink on the stage, y-up: where its box is, wherever it hangs in the tree. */
function onStage(node: Node2D) {
    const { width, height } = node.layoutBounds;
    const at = node.global;
    return { x: at.x, y: at.y, width, height };
}

describe("a mark inside a plot", () => {
    it.each([
        ["curveArea", { domain: [0, 2] }],
        ["riemannSum", { domain: [0, 2], dx: 0.5 }],
        ["tangentLine", { x: 1, length: 200 }],
        ["dropLines", { x: 2 }],
    ])("reads that plot with nothing said: %s", (type, props) => {
        const { inside, beside } = bothWays(type, props);
        inside.at(0);
        beside.at(0);
        const nested = onStage(inside.node("m"));
        const named = onStage(beside.node("m"));
        expect(nested.width).toBeGreaterThan(0);
        for (const key of ["x", "y", "width", "height"] as const) expect(nested[key], key).toBeCloseTo(named[key], 6);
    });

    it("is drawn, where on its own beside the plot it is not", () => {
        const orphan = play(scene([AXES, PLOT, { id: "m", type: "curveArea", parentId: "axes", props: { domain: [0, 2] } }]));
        orphan.at(0);
        expect(inkOf(orphan.node("m")).width).toBe(0);
    });

    it("is drawn over the plot's curve, not under it", () => {
        const played = play(scene([
            AXES,
            { ...PLOT, props: { ...PLOT.props, stroke: { weight: 3, fill: "#ff0000" } } },
            { id: "t", type: "tangentLine", parentId: "plot", props: { x: 1, length: 200, stroke: { weight: 2, fill: "#0000ff" } } },
            { id: "p", type: "plotPoint", parentId: "plot", props: { x: 1, radius: 5, fill: "#00ff00" } },
        ]));
        const drawn = played.at(0).drawn.map((graphics) => JSON.stringify([...graphics.ops()]));
        const paintedIn = (color: string) => drawn.findIndex((ops) => ops.includes(`"color":${color}`));
        const curve = paintedIn("[1,0,0,1]");
        expect(curve).toBeGreaterThanOrEqual(0);
        expect(paintedIn("[0,0,1,1]")).toBeGreaterThan(curve);
        expect(paintedIn("[0,1,0,1]")).toBeGreaterThan(curve);
    });

    it("rides it as a point does, and is free in the axes themselves", () => {
        const riding = play(scene([AXES, PLOT, { id: "p", type: "plotPoint", parentId: "plot", props: { x: 2, y: -1, radius: 5 } }]));
        riding.at(0);
        expect(riding.node("p").global.x).toBeCloseTo(200, 6);
        expect(riding.node("p").global.y).toBeCloseTo(100, 6);

        const free = play(scene([AXES, PLOT, { id: "p", type: "plotPoint", parentId: "axes", props: { x: 2, y: -1, radius: 5 } }]));
        free.at(0);
        expect(free.node("p").global.y).toBeCloseTo(-100, 6);
    });

    it("still reads another plot when it names one", () => {
        const other: Row = { id: "flat", type: "functionPlot", parentId: "axes", props: { expression: "1.5" } };
        const played = play(scene([AXES, PLOT, other, { id: "p", type: "plotPoint", parentId: "plot", props: { x: 2, on: "flat", radius: 5 } }]));
        played.at(0);
        expect(played.node("p").global.y).toBeCloseTo(150, 6);
    });

    it("follows its plot through a morph and its axes through a zoom", () => {
        const played = play(
            scene(
                [AXES, PLOT, { id: "p", type: "plotPoint", parentId: "plot", props: { x: 2, radius: 5 } }],
                [
                    { type: "morphTo", targetId: "plot", at: 0, args: { expression: "-x / 2" } },
                    { type: "rangeTo", targetId: "axes", at: 1, args: { xRange: [0, 8] } },
                ],
            ),
        );
        played.at(1);
        expect(played.node("p").global.y).toBeCloseTo(-100, 6);
        played.at(2);
        // The window is now [0, 8]: x = 2 sits a quarter of the way across.
        expect(played.node("p").global.x).toBeCloseTo(-200, 6);
    });

    it("is dragged, and dropped on, in graph units", () => {
        const played = play(scene([AXES, PLOT, { id: "p", type: "plotPoint", parentId: "plot", props: { x: 2, radius: 5 } }]));
        played.at(0);
        const dragged = parentPlanePointAt(played.root, "0.0.0", { x: -100, y: 150 })!;
        expect(dragged.x).toBeCloseTo(-1, 6);
        expect(dragged.y).toBeCloseTo(1.5, 6);
        const dropped = childPlanePointAt(played.root, "0.0", { x: 300, y: -50 })!;
        expect(dropped.x).toBeCloseTo(3, 6);
        expect(dropped.y).toBeCloseTo(-0.5, 6);
    });

    it("works with no axes at all, where a graph unit is a pixel", () => {
        const played = play(
            scene([
                { id: "plot", type: "functionPlot", props: { expression: "x / 2", domain: [-100, 100] } },
                { id: "m", type: "curveArea", parentId: "plot", props: { domain: [0, 80] } },
            ]),
        );
        played.at(0);
        expect(inkOf(played.node("m")).width).toBeCloseTo(80, 6);
    });
});

describe("a mark inside a formula", () => {
    const FORMULA: Row = { id: "f", type: "latex", props: { x: 100, y: 50, latex: "a^2 + b^2", fontSize: 40 } };
    const ink = (node: Node2D) => {
        const local = (node as unknown as { _localBounds(): { x: number; y: number; width: number; height: number } })._localBounds();
        const at = node.global;
        return { x: at.x + local.x, y: at.y + local.y, width: local.width, height: local.height };
    };

    it("is drawn on that formula with nothing said, and on one part of it", () => {
        const whole = play(scene([FORMULA, { id: "m", type: "emphasisMark", parentId: "f", props: { clearance: 0 } }]));
        whole.at(0);
        const box = ink(whole.node("m"));
        const formula = whole.node<Latex>("f");
        expect(box.x).toBeCloseTo(100, 6);
        expect(box.y).toBeCloseTo(50, 6);
        expect(box.width).toBeCloseTo(formula.layoutBounds.width, 6);

        const part = play(scene([FORMULA, { id: "m", type: "emphasisMark", parentId: "f", props: { clearance: 0, part: "b^2" } }]));
        part.at(0);
        expect(ink(part.node("m")).width).toBeLessThan(box.width / 2);
        expect(ink(part.node("m")).x).toBeGreaterThan(100);
    });

    it("is a brace along it, where a brace that follows nothing spans its own two points", () => {
        const inside = play(scene([FORMULA, { id: "m", type: "curlyBrace", parentId: "f", props: { clearance: 0, reach: 10 } }]));
        inside.at(0);
        expect(ink(inside.node("m")).width).toBeCloseTo(inside.node("f").layoutBounds.width, 6);

        const alone = play(scene([{ id: "m", type: "curlyBrace", props: { tail: { x: -30, y: 0 }, head: { x: 30, y: 0 }, clearance: 0, reach: 10 } }]));
        alone.at(0);
        expect(ink(alone.node("m")).width).toBeCloseTo(60, 6);
    });

    it("leaves the formula's own glyphs and size as they were", () => {
        const bare = play(scene([FORMULA]));
        const marked = play(scene([FORMULA, { id: "m", type: "emphasisMark", parentId: "f", props: {} }]));
        bare.at(0);
        // A glyph's outline is a path string; the mark's is a list of commands.
        const glyphs = (ctx: { drawn: Graphics2D[] }) =>
            ctx.drawn.filter((g) => g.ops().some((op) => op.kind === "path" && typeof (op.state as { data: unknown }).data === "string")).length;
        expect(glyphs(marked.at(0))).toBe(glyphs(bare.at(0)));
        expect(marked.node("f").layoutBounds).toEqual(bare.node("f").layoutBounds);
    });
});
