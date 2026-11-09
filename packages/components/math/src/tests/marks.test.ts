import { describe, expect, it } from "vitest";
import { handleValueAt, nodeHandlesAt } from "@motionscript/sdk";
import type { PlotPoint } from "../marks/plot-point";
import type { TangentLine } from "../marks/tangent-line";
import { contours, inkOf, play, scene, type Row } from "./harness";

/** 800 × 400 with no padding: 100 px a unit both ways over [-4, 4] × [-2, 2]. */
const AXES: Row = { id: "axes", type: "axes2d", props: { width: 800, height: 400, xRange: [-4, 4], yRange: [-2, 2], labels: false } };
const plot = (expression: string, id = "plot"): Row => ({ id, type: "functionPlot", parentId: "axes", props: { expression } });
const mark = (type: string, props: Record<string, unknown>): Row => ({ id: "mark", type, parentId: "axes", props });

describe("a plot point", () => {
    it("sits at its graph x and y", () => {
        const played = play(scene([AXES, mark("plotPoint", { x: -1, y: 1.5, radius: 6 })]));
        played.at(0);
        const point = played.node<PlotPoint>("mark");
        expect(point.global.x).toBeCloseTo(-100, 6);
        expect(point.global.y).toBeCloseTo(150, 6);
        expect(point.layoutBounds).toMatchObject({ width: 12, height: 12 });
    });

    it("rides a plot: its x is where along it, its height the curve's", () => {
        const played = play(scene([AXES, plot("x^2 / 2"), mark("plotPoint", { on: "plot", x: 1, y: 99 })], [{ type: "moveTo", targetId: "mark", args: { x: 2 } }]));
        played.at(0);
        expect(played.node("mark").global.y).toBeCloseTo(50, 6);
        expect(played.node<PlotPoint>("mark").value).toBeCloseTo(0.5, 9);
        played.at(1);
        expect(played.node("mark").global.x).toBeCloseTo(200, 6);
        expect(played.node("mark").global.y).toBeCloseTo(200, 6);
    });

    it("follows a variable, which is how one value drives a scene", () => {
        const played = play(
            scene(
                [AXES, plot("sin(x)"), mark("plotPoint", { on: "plot", x: "=[t]" })],
                [{ type: "variableTo", targetId: "t", args: { value: Math.PI } }],
                [{ id: "t", value: 0 }],
            ),
        );
        played.at(0.5);
        expect(played.node("mark").global.x).toBeCloseTo(50 * Math.PI, 6);
        expect(played.node("mark").global.y).toBeCloseTo(100, 6);
    });

    it("stays at its own y where its curve has no value", () => {
        const played = play(scene([AXES, plot("sqrt(x)"), mark("plotPoint", { on: "plot", x: -1, y: 0.5 })]));
        played.at(0);
        expect(played.node("mark").global.y).toBeCloseTo(50, 6);
    });

    it("draws its label beside the dot", () => {
        const played = play(scene([AXES, mark("plotPoint", { x: 0, y: 0, label: "P", labelSide: "right", fontFamily: "Inter" })]));
        const text = played.at(0).ops().find((op) => op.kind === "text")!.state as { text: string; x: number; textAlign: string };
        expect(text).toMatchObject({ text: "P", textAlign: "left" });
        expect(text.x).toBeGreaterThan(7);
    });
});

describe("a vector arrow", () => {
    it("runs between two graph points", () => {
        const played = play(scene([AXES, mark("vectorArrow", { tail: { x: 0, y: 0 }, head: { x: 2, y: 1 } })]));
        played.at(0);
        expect(inkOf(played.node("mark"))).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    });

    it("moves either end with endpointsTo, and as a whole with its own x and y", () => {
        const played = play(scene(
            [AXES, mark("vectorArrow", { tail: { x: 0, y: 0 }, head: { x: 2, y: 0 }, y: 1 })],
            [{ type: "endpointsTo", targetId: "mark", args: { head: { x: 2, y: 2 } } }],
        ));
        played.at(0);
        expect(inkOf(played.node("mark")).y).toBeCloseTo(100, 6);
        played.at(0.5);
        expect(inkOf(played.node("mark"))).toMatchObject({ width: 200, height: 100 });
    });

    it("bows into an arc when bent", () => {
        const played = play(scene([AXES, mark("vectorArrow", { tail: { x: -1, y: 0 }, head: { x: 1, y: 0 }, bend: 180 })]));
        played.at(0);
        const ink = inkOf(played.node("mark"));
        // A half circle on a 200 px chord rises 100 px to the tail-to-head left.
        expect(ink.width).toBeCloseTo(200, 0);
        expect(ink.height).toBeCloseTo(100, 0);
        expect(ink.y).toBeCloseTo(50, 0);
    });

    it("still ends on its two points at a shallower bend, bowing left for a positive one", () => {
        for (const bend of [90, -90]) {
            const played = play(scene([AXES, mark("vectorArrow", { tail: { x: -1, y: 0 }, head: { x: 1, y: 0 }, bend })]));
            played.at(0);
            const ink = inkOf(played.node("mark"));
            // A quarter circle on a 200 px chord: its ends are the chord's, and it rises 100(√2 − 1).
            expect(ink.width).toBeCloseTo(200, 0);
            expect(ink.height).toBeCloseTo(100 * (Math.SQRT2 - 1), 0);
            expect(Math.sign(ink.y)).toBe(Math.sign(bend));
        }
    });

    it("offers its two ends to drag, in graph units", () => {
        const played = play(scene([AXES, mark("vectorArrow", { tail: { x: 0, y: 0 }, head: { x: 2, y: 0 }, y: 1 })]));
        played.at(0);
        expect(nodeHandlesAt(played.root, "0.0")).toEqual([
            { prop: "tail", at: { x: 0, y: 100 } },
            { prop: "head", at: { x: 200, y: 100 } },
        ]);
        // Its own y is a shift the value does not include.
        const head = handleValueAt(played.root, "0.0", "head", { x: 300, y: -50 })!;
        expect(head.x).toBeCloseTo(3, 9);
        expect(head.y).toBeCloseTo(-1.5, 9);
        expect(handleValueAt(played.root, "0.0", "bend", { x: 0, y: 0 })).toBeNull();
    });

    it("is pixels outside a coordinate system", () => {
        const played = play(scene([{ id: "mark", type: "vectorArrow", props: { tail: { x: 0, y: 0 }, head: { x: 30, y: 40 }, x: 100 } }]));
        played.at(0);
        expect(played.node("mark").layoutBounds).toMatchObject({ width: 30, height: 40 });
        expect(played.node("mark").global.x).toBeCloseTo(100, 6);
    });
});

describe("an area and a Riemann sum", () => {
    it("fills between a plot and the x axis over its domain", () => {
        const played = play(scene([AXES, plot("1"), mark("curveArea", { on: "plot", domain: [0, 2] })]));
        const ops = played.at(0).ops();
        expect(inkOf(played.node("mark"))).toEqual({ x: 100, y: 50, width: 200, height: 100 });
        expect(contours(ops)).toBe(2);
    });

    it("fills between two plots", () => {
        const played = play(scene([AXES, plot("1.5"), plot("0.5", "floor"), mark("curveArea", { on: "plot", under: "floor", domain: [-1, 1] })]));
        played.at(0);
        expect(inkOf(played.node("mark"))).toEqual({ x: 0, y: 100, width: 200, height: 100 });
    });

    it("sweeps open with domainTo", () => {
        const played = play(scene([AXES, plot("1"), mark("curveArea", { on: "plot", domain: [0, 0.001] })], [{ type: "domainTo", targetId: "mark", args: { domain: [0, 3] } }]));
        played.at(0.5);
        expect(inkOf(played.node("mark")).width).toBeCloseTo(150, 0);
    });

    it("draws nothing without a plot to fill under", () => {
        const played = play(scene([AXES, mark("curveArea", { on: "nowhere", domain: [0, 2] })]));
        played.at(0);
        expect(inkOf(played.node("mark"))).toMatchObject({ width: 0, height: 0 });
    });

    it("stands a rectangle on every step, as tall as the curve where it is sampled", () => {
        const sum = (sample: string) => {
            const played = play(scene([AXES, plot("x"), mark("riemannSum", { on: "plot", domain: [0, 2], dx: 0.5, sample })]));
            const ops = played.at(0).ops();
            // The plot's own contour, then one per rectangle.
            return { rectangles: contours(ops) - 1, ink: inkOf(played.node("mark")) };
        };
        expect(sum("left")).toEqual({ rectangles: 4, ink: { x: 100, y: 75, width: 200, height: 150 } });
        expect(sum("right").ink.height).toBeCloseTo(200, 6);
        expect(sum("center").ink.height).toBeCloseTo(175, 6);
    });

    it("closes in on the area as refineTo narrows the rectangles", () => {
        const played = play(scene([AXES, plot("x"), mark("riemannSum", { on: "plot", domain: [0, 2], dx: 1 })], [{ type: "refineTo", targetId: "mark", args: { dx: 0.1 } }]));
        expect(contours(played.at(0).ops()) - 1).toBe(2);
        expect(contours(played.at(1).ops()) - 1).toBe(20);
    });
});

describe("a tangent and drop lines", () => {
    it("draws the tangent at its x, a fixed length on screen", () => {
        const played = play(scene([AXES, plot("x^2 / 2"), mark("tangentLine", { on: "plot", x: 1, length: 200 })]));
        played.at(0);
        const ink = inkOf(played.node("mark"));
        // Slope 1 at x = 1, and a unit is as long as it is tall here: a 45° line 200 px long.
        expect(ink.width).toBeCloseTo(200 / Math.SQRT2, 2);
        expect(ink.height).toBeCloseTo(200 / Math.SQRT2, 2);
        expect(ink.x).toBeCloseTo(100, 2);
        expect(ink.y).toBeCloseTo(50, 2);
        expect(played.node<TangentLine>("mark").slope).toBeCloseTo(1, 6);
    });

    it("slides along its plot with moveTo", () => {
        const played = play(scene([AXES, plot("x^2 / 2"), mark("tangentLine", { on: "plot", x: 1 })], [{ type: "moveTo", targetId: "mark", args: { x: 0 } }]));
        played.at(1);
        expect(inkOf(played.node("mark")).height).toBeCloseTo(0, 3);
        expect(played.node<TangentLine>("mark").slope).toBeCloseTo(0, 6);
    });

    it("draws the secant through two points, with its run and rise", () => {
        const played = play(scene([AXES, plot("x^2 / 2"), mark("tangentLine", { on: "plot", x: 0, dx: 2, legs: true })]));
        const ops = played.at(0).ops();
        expect(contours(ops) - 1).toBe(2);
        expect(played.node<TangentLine>("mark").slope).toBeCloseTo(1, 9);
    });

    it("drops guide lines from a point to both axes", () => {
        const played = play(scene([AXES, mark("dropLines", { x: 2, y: 1 })]));
        const ops = played.at(0).ops();
        expect(contours(ops)).toBe(2);
        expect(inkOf(played.node("mark"))).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    });

    it("takes the point's height from a plot, and can drop to one axis", () => {
        const played = play(scene([AXES, plot("x / 2"), mark("dropLines", { on: "plot", x: 2, axis: "x" })]));
        const ops = played.at(0).ops();
        expect(contours(ops) - 1).toBe(1);
        expect(inkOf(played.node("mark"))).toEqual({ x: 200, y: 50, width: 0, height: 100 });
    });
});
