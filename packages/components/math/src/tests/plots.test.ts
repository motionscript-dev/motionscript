import { describe, expect, it } from "vitest";
import { curveValue } from "../kit/curve";
import type { FunctionPlot } from "../plots/function-plot";
import { inkOf, play, scene, type Row } from "./harness";

/** 800 × 400 with no padding: 100 px a unit both ways over [-4, 4] × [-2, 2]. */
const AXES: Row = { id: "axes", type: "axes2d", props: { width: 800, height: 400, xRange: [-4, 4], yRange: [-2, 2], labels: false } };
const plot = (expression: string, props: Record<string, unknown> = {}): Row => ({ id: "plot", type: "functionPlot", parentId: "axes", props: { expression, ...props } });

const valueAt = (plot: FunctionPlot, x: number) => curveValue(plot, x);

function ink(rows: Row[], time = 0) {
    const played = play(scene(rows));
    played.at(time);
    return inkOf(played.node("plot"));
}

describe("a function plot", () => {
    it("is laid out on the ink of its curve, in its system's pixels", () => {
        const box = ink([AXES, plot("x / 2")]);
        expect(box.x).toBeCloseTo(0, 6);
        expect(box.y).toBeCloseTo(0, 6);
        expect(box.width).toBeCloseTo(800, 6);
        expect(box.height).toBeCloseTo(400, 6);
    });

    it("hands the renderer y-up commands: a rising line rises", () => {
        const played = play(scene([AXES, plot("x / 2")]));
        const path = played.at(0).ops().find((op) => op.kind === "path")!.state as {
            data: { type: string; x: number; y: number }[];
            centerBounds: readonly number[];
        };
        const first = path.data[0];
        const last = path.data[path.data.length - 1];
        expect([first.x, first.y]).toEqual([-400, -200]);
        expect([last.x, last.y]).toEqual([400, 200]);
        expect(path.centerBounds).toEqual([-400, -200, 400, 200]);
    });

    it("draws only the span its domain names", () => {
        const box = ink([AXES, plot("1", { domain: [0, 2] })]);
        expect(box.x).toBeCloseTo(100, 6);
        expect(box.width).toBeCloseTo(200, 6);
        expect(box.y).toBeCloseTo(100, 6);
    });

    it("stops at its system's edge however far the curve goes", () => {
        const box = ink([AXES, plot("x^2")]);
        expect(box.height).toBeCloseTo(200, 0);
        expect(box.y).toBeCloseTo(100, 0);
        expect(box.width).toBeLessThan(300);
    });

    it("draws a polar equation over one turn", () => {
        const box = ink([AXES, plot("r = 1.5")]);
        expect(box.width).toBeCloseTo(300, 0);
        expect(box.height).toBeCloseTo(300, 0);
        expect(box.x).toBeCloseTo(0, 0);
    });

    it("draws a parametric pair over its domain", () => {
        const box = ink([AXES, plot("(3cos(t), sin(t))", { domain: [0, Math.PI * 2] })]);
        expect(box.width).toBeCloseTo(600, 0);
        expect(box.height).toBeCloseTo(200, 0);
    });

    it("draws x as a function of y", () => {
        const box = ink([AXES, plot("x = y^2")]);
        // From the vertex at the origin out to x = 4 at y = ±2.
        expect(box.x).toBeCloseTo(200, 0);
        expect(box.width).toBeCloseTo(400, 0);
        expect(box.height).toBeCloseTo(400, 0);
    });

    it("is shifted in graph units by its own x and y", () => {
        const played = play(scene([AXES, plot("0 * x", { x: 0, y: 1, domain: [0, 1] })]));
        played.at(0);
        expect(inkOf(played.node("plot")).y).toBeCloseTo(100, 6);
        expect(valueAt(played.node<FunctionPlot>("plot"), 0.5)).toBe(1);
    });

    it("draws nothing, and says nothing, for text that is not an equation", () => {
        for (const expression of ["", "sin(", "sinn(x)", "x + y"]) {
            const box = ink([AXES, plot(expression)]);
            expect(box).toMatchObject({ width: 0, height: 0 });
        }
    });

    it("draws nothing outside a coordinate system", () => {
        const played = play(scene([{ id: "plot", type: "functionPlot", props: { expression: "sin(x)" } }]));
        expect(() => played.at(0)).not.toThrow();
        expect(inkOf(played.node("plot"))).toMatchObject({ width: 0, height: 0 });
    });
});

describe("animating a plot", () => {
    it("bends one equation into another", () => {
        const played = play(scene([AXES, plot("1")], [{ type: "morphTo", targetId: "plot", args: { expression: "-1" } }]));
        played.at(0);
        expect(inkOf(played.node("plot")).y).toBeCloseTo(100, 6);
        played.at(0.5);
        expect(inkOf(played.node("plot")).y).toBeCloseTo(0, 6);
        expect(valueAt(played.node<FunctionPlot>("plot"), 0)).toBeCloseTo(0, 9);
        played.at(1);
        expect(inkOf(played.node("plot")).y).toBeCloseTo(-100, 6);
        expect(played.node<FunctionPlot>("plot").expression).toEqual({ source: "-1" });
    });

    it("bends a function into a polar curve, kind to kind", () => {
        const played = play(scene([AXES, plot("0 * x")], [{ type: "morphTo", targetId: "plot", args: { expression: "r = 1" } }]));
        played.at(0.5);
        const half = inkOf(played.node("plot"));
        expect(half.height).toBeGreaterThan(50);
        expect(half.height).toBeLessThan(200);
        played.at(1);
        expect(inkOf(played.node("plot")).height).toBeCloseTo(200, 0);
    });

    it("reads its named values, and follows one bound to a variable", () => {
        const played = play(
            scene(
                [AXES, plot("a * x", { params: { a: "=[k]" } })],
                [{ type: "variableTo", targetId: "k", args: { value: 3 } }],
                [{ id: "k", value: 1 }],
            ),
        );
        played.at(0);
        expect(valueAt(played.node<FunctionPlot>("plot"), 1)).toBe(1);
        played.at(0.5);
        expect(valueAt(played.node<FunctionPlot>("plot"), 1)).toBeCloseTo(2, 9);
    });

    it("animates its named values with paramsTo", () => {
        const played = play(scene([AXES, plot("a * x", { params: { a: 1 } })], [{ type: "paramsTo", targetId: "plot", args: { params: { a: 2 } } }]));
        played.at(0.5);
        expect(valueAt(played.node<FunctionPlot>("plot"), 1)).toBeCloseTo(1.5, 9);
    });

    it("draws with a named value nobody has set as 1, and tweens from there", () => {
        const played = play(scene([AXES, plot("a * x + b")], [{ type: "paramsTo", targetId: "plot", args: { params: { a: 3 } } }]));
        played.at(0);
        expect(valueAt(played.node<FunctionPlot>("plot"), 2)).toBe(3);
        expect(inkOf(played.node("plot")).width).toBeGreaterThan(0);
        played.at(0.5);
        expect(valueAt(played.node<FunctionPlot>("plot"), 2)).toBeCloseTo(5, 9);
    });

    it("animates the span it draws with domainTo", () => {
        const played = play(scene([AXES, plot("1", { domain: [0, 1] })], [{ type: "domainTo", targetId: "plot", args: { domain: [0, 3] } }]));
        played.at(0.5);
        expect(inkOf(played.node("plot")).width).toBeCloseTo(200, 6);
    });

    it("draws the same frame however the playhead got there", () => {
        const document = scene([AXES, plot("sin(x)")], [
            { type: "morphTo", targetId: "plot", args: { expression: "cos(2x)" } },
            { type: "rangeTo", targetId: "axes", at: 0.5, args: { xRange: [0, 6] } },
        ]);
        const direct = play(document);
        const scrubbed = play(document);
        for (const time of [1.4, 0.2, 0.9]) scrubbed.at(time);
        expect(JSON.stringify(scrubbed.at(0.75).ops())).toBe(JSON.stringify(direct.at(0.75).ops()));
    });
});
