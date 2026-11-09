import { describe, expect, it } from "vitest";

import type { Rect } from "@/components/builtins/geometry/geometry";
import { ClipInstance } from "@/runtime/clip-instance";
import { runtimeScope } from "@/runtime/document.fixtures";

import { documentDuration, type CommandSpec, type CompositionDocument } from "../types";

function rectAfter(commands: CommandSpec[], at: number, props: Record<string, unknown> = {}): Rect {
    const doc: CompositionDocument = {
        kind: "composition",
        nodes: [{ id: "box", type: "rect", parentId: null, layerOrder: 0, props: { width: 100, height: 40, ...props } }],
        commands,
    };
    const instance = new ClipInstance(doc, documentDuration(doc), runtimeScope());
    instance.build();
    instance.evaluateAt(at);
    return instance.canvas.children[0] as Rect;
}

function command(type: string, args: Record<string, unknown>, duration = 1): CommandSpec {
    return { id: type, type, targetId: "box", at: 0, duration, args };
}

describe("layoutTo", () => {
    it("tweens the sizes it is given and leaves the other alone", () => {
        const half = rectAfter([command("layoutTo", { width: 300 })], 0.5);
        expect(half.width).toBe(200);
        expect(half.height).toBe(40);
    });

    it("tweens width, height and padding together", () => {
        const done = rectAfter([command("layoutTo", { width: 10, height: 20, padding: 8 })], 1);
        expect(done.width).toBe(10);
        expect(done.height).toBe(20);
        expect(done.padding).toMatchObject({ top: 8, right: 8, bottom: 8, left: 8 });
    });
});

describe("effectTo", () => {
    it("tweens the effect stack", () => {
        const half = rectAfter(
            [command("effectTo", { effects: [{ type: "blur", radius: 20 }] })],
            0.5,
            { effects: [{ type: "blur", radius: 0 }] },
        );
        expect(half.effects).toMatchObject([{ type: "blur", radius: 10 }]);
    });
});

describe("progressTo", () => {
    it("tweens the end it is given and leaves the start alone", () => {
        const half = rectAfter([command("progressTo", { end: 1 })], 0.5, { end: 0 });
        expect(half.start).toBe(0);
        expect(half.end).toBe(0.5);
    });

    it("tweens both ends", () => {
        const done = rectAfter([command("progressTo", { start: 0.5, end: 0.5 })], 1);
        expect(done.start).toBe(0.5);
        expect(done.end).toBe(0.5);
    });
});

describe("pulse", () => {
    it("swells to its factor at the middle and is back where it began at the end", () => {
        const args = { factor: 1.5 };
        expect(rectAfter([command("pulse", args)], 0.5, { scale: 2 }).scale).toBeCloseTo(3, 9);
        expect(rectAfter([command("pulse", args)], 0.25, { scale: 2 }).scale).toBeCloseTo(2 + Math.SQRT1_2, 9);
        expect(rectAfter([command("pulse", args)], 1, { scale: 2 }).scale).toBeCloseTo(2, 9);
        expect(rectAfter([command("pulse", args)], 3, { scale: 2 }).scale).toBeCloseTo(2, 9);
    });

    it("swells by a fifth when it is given no factor", () => {
        expect(rectAfter([command("pulse", {})], 0.5).scale).toBeCloseTo(1.2, 9);
    });
});

describe("wiggle", () => {
    it("rocks about the node's own turn and comes back to it", () => {
        const args = { angle: 10, turns: 1 };
        const turn = (at: number) => rectAfter([command("wiggle", args)], at, { rotation: 30 }).rotation;
        expect(turn(0)).toBeCloseTo(30, 9);
        // A quarter of the way one swing is at its far side, under an envelope still building.
        expect(turn(0.25)).toBeCloseTo(30 + 10 * Math.SQRT1_2, 9);
        expect(turn(0.75)).toBeCloseTo(30 - 10 * Math.SQRT1_2, 9);
        expect(turn(1)).toBeCloseTo(30, 9);
    });
});

describe("flash", () => {
    it("sends a stretch of the outline along it, and leaves the node drawing what it did", () => {
        const args = { portion: 0.5 };
        const window = (at: number, props = { end: 0 }) => {
            const rect = rectAfter([command("flash", args)], at, props);
            return [rect.start, rect.end];
        };
        expect(window(0)).toEqual([0, 0]);
        expect(window(0.2)[0]).toBe(0);
        expect(window(0.2)[1]).toBeCloseTo(0.3, 9);
        expect(window(0.5)[0]).toBeCloseTo(0.25, 9);
        expect(window(0.5)[1]).toBeCloseTo(0.75, 9);
        expect(window(0.9)[0]).toBeCloseTo(0.85, 9);
        expect(window(0.9)[1]).toBe(1);
        expect(window(1)).toEqual([0, 0]);
        expect(window(1, { end: 1 })).toEqual([0, 1]);
    });
});
