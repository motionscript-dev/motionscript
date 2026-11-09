import { describe, expect, it } from "vitest";
import { childPlanePointAt, parentPlanePointAt } from "@motionscript/sdk";
import type { Axes2d } from "../systems/axes2d";
import { count, play, scene, type Row } from "./harness";

/** 800 × 400 with no padding: 100 px a unit both ways over [-4, 4] × [-2, 2]. */
const AXES: Row = { id: "axes", type: "axes2d", props: { width: 800, height: 400, xRange: [-4, 4], yRange: [-2, 2], fontFamily: "Inter" } };
const dot = (props: Record<string, unknown>): Row => ({ id: "dot", type: "ellipse", parentId: "axes", props: { width: 10, height: 10, ...props } });

describe("a coordinate system", () => {
    it("places any child by its graph x and y, at its own size", () => {
        const played = play(scene([AXES, dot({ x: 2, y: 1, width: 50, height: 30 })]));
        played.at(0);
        const node = played.node("dot");
        expect(node.global.x).toBeCloseTo(200, 6);
        expect(node.global.y).toBeCloseTo(100, 6);
        expect(node.layoutBounds).toMatchObject({ width: 50, height: 30 });
    });

    it("carries its children when its range is animated", () => {
        const played = play(scene([AXES, dot({ x: 2, y: 0 })], [{ type: "rangeTo", targetId: "axes", args: { xRange: [0, 8] } }]));
        played.at(0.5);
        // Halfway the window is [-2, 6], so x = 2 is at its centre.
        expect(played.node("dot").global.x).toBeCloseTo(0, 6);
        played.at(1);
        expect(played.node("dot").global.x).toBeCloseTo(-200, 6);
        expect(played.node<Axes2d>("axes").xRange).toEqual([0, 8]);
    });

    it("moves a child in graph units with the built-in moveTo", () => {
        const played = play(scene([AXES, dot({ x: 0, y: 0 })], [{ type: "moveTo", targetId: "dot", args: { x: 3, y: -1 } }]));
        played.at(1);
        expect(played.node("dot").global.x).toBeCloseTo(300, 6);
        expect(played.node("dot").global.y).toBeCloseTo(-100, 6);
    });

    it("answers a drag in graph units", () => {
        const played = play(scene([AXES, dot({ x: 2, y: 1 })]));
        played.at(0);
        const at = parentPlanePointAt(played.root, "0.0", { x: -100, y: 150 })!;
        expect(at.x).toBeCloseTo(-1, 6);
        expect(at.y).toBeCloseTo(1.5, 6);
    });

    it("says where a node dropped on it would sit, which a plain parent does not", () => {
        const played = play(scene([{ ...AXES, props: { ...AXES.props, padding: 50 } }, dot({})]));
        played.at(0);
        const at = childPlanePointAt(played.root, "0", { x: 350, y: 0 })!;
        expect(at.x).toBeCloseTo(4, 6);
        expect(at.y).toBeCloseTo(0, 6);
        expect(childPlanePointAt(played.root, "", { x: 350, y: 0 })).toBeNull();
    });

    it("keeps its plot area inside its padding", () => {
        const played = play(scene([{ ...AXES, props: { ...AXES.props, padding: 50 } }, dot({ x: 4, y: 2 })]));
        played.at(0);
        expect(played.node("dot").global.x).toBeCloseTo(350, 6);
        expect(played.node("dot").global.y).toBeCloseTo(150, 6);
    });

    it("spreads a log axis by the decade", () => {
        const played = play(scene([
            { ...AXES, props: { ...AXES.props, yScaling: "log", yRange: [1, 100] } },
            dot({ x: 0, y: 10 }),
        ]));
        played.at(0);
        expect(played.node("dot").global.y).toBeCloseTo(0, 6);
    });

    it("draws both axes, a tick and a number at every step but the crossing", () => {
        const played = play(scene([{ ...AXES, props: { ...AXES.props, xRange: [-2, 2], yRange: [-1, 1], xStep: 1, yStep: 1 } }]));
        const ops = played.at(0).ops();
        // Two axis lines, then ticks at x = -2, -1, 1, 2 and y = -1, 1.
        expect(count(ops, "line")).toBe(2 + 6);
        expect(ops.filter((op) => op.kind === "text").map((op) => (op.state as { text: string }).text)).toEqual(["-2", "-1", "1", "2", "-1", "1"]);
    });

    it("draws itself on with its outline's progress, ticks appearing as the line reaches them", () => {
        const played = play(scene([{ ...AXES, props: { ...AXES.props, xRange: [-2, 2], yRange: [-1, 1], xStep: 1, yStep: 1, end: 0.5 } }]));
        const ops = played.at(0).ops();
        // Half of each axis: x has reached -2 and -1, y has reached -1.
        expect(count(ops, "line")).toBe(2 + 3);
        expect(count(ops, "text")).toBe(3);
    });

    it("draws no numbers and no ticks when told not to", () => {
        const played = play(scene([{ ...AXES, props: { ...AXES.props, ticks: false, labels: false } }]));
        const ops = played.at(0).ops();
        expect(count(ops, "line")).toBe(2);
        expect(count(ops, "text")).toBe(0);
    });
});

describe("a number line", () => {
    const LINE: Row = { id: "axes", type: "numberLine", props: { width: 800, height: 100, range: [0, 10], fontFamily: "Inter" } };

    it("places a child by a value along it and pixels above it", () => {
        const played = play(scene([LINE, dot({ x: 5, y: 20 })]));
        played.at(0);
        expect(played.node("dot").global.x).toBeCloseTo(0, 6);
        expect(played.node("dot").global.y).toBeCloseTo(20, 6);
    });

    it("marks every step, the crossing included, and can leave numbers out", () => {
        const played = play(scene([{ ...LINE, props: { ...LINE.props, range: [0, 4], step: 1, labelExclude: [0] } }]));
        const ops = played.at(0).ops();
        expect(count(ops, "line")).toBe(1 + 5);
        expect(ops.filter((op) => op.kind === "text").map((op) => (op.state as { text: string }).text)).toEqual(["1", "2", "3", "4"]);
    });
});

describe("a number plane", () => {
    const PLANE: Row = { id: "axes", type: "numberPlane", props: { width: 800, height: 400, xRange: [-4, 4], yRange: [-10, 10], fontFamily: "Inter" } };

    it("keeps its units square, around the middle of the y range it was given", () => {
        const played = play(scene([PLANE, dot({ x: 1, y: 1 })]));
        played.at(0);
        expect(played.node("dot").global.x).toBeCloseTo(100, 6);
        expect(played.node("dot").global.y).toBeCloseTo(100, 6);
    });

    it("draws a line at every tick and the minor ones between", () => {
        const played = play(scene([{ ...PLANE, props: { ...PLANE.props, ticks: false, labels: false } }]));
        const lines = count(played.at(0).ops(), "line");
        // x ticks -4..4 and y ticks -2..2 are 14 major lines, with one minor between each pair, and two axes.
        expect(lines).toBe(14 + 8 + 4 + 2);
    });

    it("draws no grid when told not to", () => {
        const played = play(scene([{ ...PLANE, props: { ...PLANE.props, grid: false, ticks: false, labels: false } }]));
        expect(count(played.at(0).ops(), "line")).toBe(2);
    });
});
