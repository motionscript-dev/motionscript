import { describe, expect, it } from "vitest";
import { handleValueAt, nodeHandlesAt, type Graphics2D, type Node2D } from "@motionscript/sdk";
import type { AngleMark } from "../annotate/angle-mark";
import { play, scene, type Recorder, type Row, type Step } from "./harness";

/** Two boxes on the stage, 200 × 100 at (-200, 50) and 100 × 60 at (250, -80). */
const A: Row = { id: "a", type: "rect", props: { x: -200, y: 50, width: 200, height: 100 } };
const B: Row = { id: "b", type: "rect", props: { x: 250, y: -80, width: 100, height: 60 } };
const FORMULA: Row = { id: "f", type: "latex", props: { x: 0, y: 150, latex: "a^2 + b^2", fontSize: 40 } };

const mark = (type: string, props: Record<string, unknown>): Row => ({ id: "m", type, props });

/** A mark's ink on the stage: its own place plus its local bounds, y-up. */
function ink(node: Node2D) {
    const local = (node as unknown as { _localBounds(): { x: number; y: number; width: number; height: number } })._localBounds();
    const at = node.global;
    return { x: at.x + local.x, y: at.y + local.y, width: local.width, height: local.height };
}

function run(rows: Row[], steps: Step[] = []) {
    const played = play(scene(rows, steps));
    return {
        at(time: number) {
            const ctx = played.at(time);
            return { ctx, ink: ink(played.node("m")), node: played.node("m") };
        },
        node: played.node,
    };
}

const kinds = (ctx: Recorder) => ctx.drawn.flatMap((graphics: Graphics2D) => graphics.ops().map((op) => op.kind));

describe("an emphasis mark", () => {
    it("boxes the node it names, with room around it, wherever it is itself", () => {
        for (const own of [{}, { x: 300, y: -200 }]) {
            const { ink: box } = run([A, mark("emphasisMark", { on: "a", clearance: 10, ...own })]).at(0);
            expect(box.x).toBeCloseTo(-200, 6);
            expect(box.y).toBeCloseTo(50, 6);
            expect(box.width).toBeCloseTo(220, 6);
            expect(box.height).toBeCloseTo(120, 6);
        }
    });

    it("draws nothing for a node that is not there", () => {
        const { ink: box, ctx } = run([A, mark("emphasisMark", { on: "nobody" })]).at(0);
        expect(box).toMatchObject({ width: 0, height: 0 });
        expect(kinds(ctx)).not.toContain("path");
    });

    it("draws each shape on the same box", () => {
        const sizes = Object.fromEntries(
            (["box", "circle", "underline", "cross"] as const).map((shape) => {
                const { ink: box } = run([A, mark("emphasisMark", { on: "a", shape, clearance: 0 })]).at(0);
                return [shape, [Math.round(box.width), Math.round(box.height)]];
            }),
        );
        expect(sizes.box).toEqual([200, 100]);
        expect(sizes.cross).toEqual([200, 100]);
        expect(sizes.underline).toEqual([200, 0]);
        // An ellipse through the corners reaches past the sides by √2.
        expect(sizes.circle[0]).toBeGreaterThan(270);
        expect(sizes.circle[0]).toBeLessThan(290);
    });

    it("boxes one part of a formula", () => {
        const whole = run([FORMULA, mark("emphasisMark", { on: "f", clearance: 0 })]).at(0).ink;
        const part = run([FORMULA, mark("emphasisMark", { on: "f", part: "b^2", clearance: 0 })]).at(0).ink;
        expect(part.width).toBeLessThan(whole.width / 2);
        expect(part.x).toBeGreaterThan(whole.x);
        expect(Math.abs(part.y - whole.y)).toBeLessThan(5);
    });

    it("slides to another node with retargetTo, and holds there", () => {
        const played = run([A, B, mark("emphasisMark", { on: "a", clearance: 0 })], [
            { type: "retargetTo", targetId: "m", args: { on: "b" } },
        ]);
        expect(played.at(0).ink).toMatchObject({ x: -200, y: 50, width: 200, height: 100 });
        const half = played.at(0.5).ink;
        expect(half.x).toBeCloseTo(25, 6);
        expect(half.y).toBeCloseTo(-15, 6);
        expect(half.width).toBeCloseTo(150, 6);
        const end = played.at(1).ink;
        expect(end.x).toBeCloseTo(250, 6);
        expect(end.width).toBeCloseTo(100, 6);
        expect(played.at(3).ink.x).toBeCloseTo(250, 6);
        expect(played.at(0).ink.x).toBeCloseTo(-200, 6);
    });

    it("moves from one part of a formula to another", () => {
        const played = run([FORMULA, mark("emphasisMark", { on: "f", part: "a^2", clearance: 0 })], [
            { type: "retargetTo", targetId: "m", args: { part: "b^2" } },
        ]);
        const from = played.at(0).ink.x;
        const to = played.at(1).ink.x;
        expect(to).toBeGreaterThan(from);
        expect(played.at(0.5).ink.x).toBeCloseTo((from + to) / 2, 6);
    });
});

describe("a curly brace", () => {
    it("runs along the side of its target that it is told, outside it", () => {
        const below = run([A, mark("curlyBrace", { on: "a", side: "below", clearance: 8, reach: 20 })]).at(0).ink;
        expect(below.width).toBeCloseTo(200, 6);
        expect(below.x).toBeCloseTo(-200, 6);
        // Under the box's bottom edge (y = 0) by the clearance, and as deep as its reach.
        expect(below.y + below.height / 2).toBeCloseTo(-8, 6);
        expect(below.height).toBeCloseTo(20, 6);

        const right = run([A, mark("curlyBrace", { on: "a", side: "right", clearance: 8, reach: 20 })]).at(0).ink;
        expect(right.height).toBeCloseTo(100, 6);
        expect(right.x - right.width / 2).toBeCloseTo(-100 + 8, 6);
    });

    it("spans two points when it follows nothing, from where it is itself", () => {
        const { ink: box } = run([mark("curlyBrace", { x: 100, y: 40, tail: { x: -50, y: 0 }, head: { x: 50, y: 0 }, clearance: 0, reach: 10 })]).at(0);
        expect(box.width).toBeCloseTo(100, 6);
        expect(box.x).toBeCloseTo(100, 6);
        // It bulges to the left of tail to head: upwards.
        expect(box.y - box.height / 2).toBeCloseTo(40, 6);
    });

    it("offers those two points to drag while it spans them, and none while it follows a node", () => {
        const played = play(scene([A, mark("curlyBrace", { x: 100, y: 40, tail: { x: -50, y: 0 }, head: { x: 50, y: 0 } })]));
        played.at(0);
        expect(nodeHandlesAt(played.root, "1")).toEqual([
            { prop: "tail", at: { x: 50, y: 40 } },
            { prop: "head", at: { x: 150, y: 40 } },
        ]);
        expect(handleValueAt(played.root, "1", "head", { x: 160, y: 60 })).toEqual({ x: 60, y: 20 });

        const following = play(scene([A, mark("curlyBrace", { on: "a" })]));
        following.at(0);
        expect(nodeHandlesAt(following.root, "1")).toEqual([]);
    });

    it("writes its label as text, or typesets one written between dollar signs", () => {
        const paths = (ctx: Recorder) => kinds(ctx).filter((kind) => kind === "path").length;
        const text = run([A, mark("curlyBrace", { on: "a", label: "width", fontFamily: "Inter" })]).at(0).ctx;
        expect(kinds(text)).toContain("text");
        const formula = run([A, mark("curlyBrace", { on: "a", label: "$x^2$" })]).at(0).ctx;
        expect(kinds(formula)).not.toContain("text");
        // The formula's two glyphs, beside the brace itself.
        expect(paths(formula) - paths(text)).toBe(2);
    });
});

describe("an angle mark", () => {
    it("draws an arc from one direction to the other, at its own position", () => {
        const { ink: box } = run([mark("angleMark", { x: 50, y: 20, fromAngle: 0, toAngle: 90, radius: 40, corner: "arc" })]).at(0);
        expect(box.width).toBeCloseTo(40, 0);
        expect(box.height).toBeCloseTo(40, 0);
        expect(box.x).toBeCloseTo(70, 0);
        expect(box.y).toBeCloseTo(40, 0);
    });

    it("draws the square of a right angle unless told to draw the arc", () => {
        const points = (props: Record<string, unknown>) => {
            const { ctx } = run([mark("angleMark", { radius: 40, ...props })]).at(0);
            const path = ctx.drawn[0].ops().find((op) => op.kind === "path")!.state as { data: unknown[] };
            return path.data.length;
        };
        expect(points({ fromAngle: 10, toAngle: 100 })).toBe(3);
        expect(points({ fromAngle: 10, toAngle: 100, corner: "arc" })).toBeGreaterThan(3);
        expect(points({ fromAngle: 0, toAngle: 60 })).toBeGreaterThan(3);
        expect(points({ fromAngle: 0, toAngle: 60, corner: "square" })).toBe(3);
    });

    it("says its own size for a label of °, and follows a variable", () => {
        const played = play(
            scene(
                [mark("angleMark", { fromAngle: 0, toAngle: "=[theta]", label: "°", fontFamily: "Inter" })],
                [{ type: "variableTo", targetId: "theta", args: { value: 120 } }],
                [{ id: "theta", value: 30 }],
            ),
        );
        const label = (ctx: Recorder) =>
            ctx.drawn.flatMap((graphics: Graphics2D) => graphics.ops().flatMap((op) => (op.kind === "text" ? [(op.state as { text: string }).text] : [])));
        expect(label(played.at(0))).toEqual(["30°"]);
        expect(label(played.at(1))).toEqual(["120°"]);
        expect(played.node<AngleMark>("m").value).toBe(120);
    });

    it("grows with radiusTo", () => {
        const played = run([mark("angleMark", { radius: 20, corner: "arc", toAngle: 90 })], [
            { type: "radiusTo", targetId: "m", args: { radius: 60 } },
        ]);
        expect(played.at(0).ink.width).toBeCloseTo(20, 0);
        expect(played.at(1).ink.width).toBeCloseTo(60, 0);
    });
});

describe("a label written between dollar signs", () => {
    it("is typeset on a plot point too", () => {
        const played = play(scene([{ id: "p", type: "plotPoint", props: { radius: 5, label: "$x_0$" } }]));
        const ops = kinds(played.at(0));
        expect(ops).not.toContain("text");
        expect(ops.filter((kind) => kind === "path")).toHaveLength(2);
    });

    it("is drawn as written when it will not typeset", () => {
        const played = play(scene([{ id: "p", type: "plotPoint", props: { radius: 5, label: "$\\frac{$", fontFamily: "Inter" } }]));
        expect(kinds(played.at(0))).toContain("text");
    });
});
