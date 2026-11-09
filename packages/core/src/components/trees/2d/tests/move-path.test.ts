import { describe, it, expect } from "vitest";
import { Rect } from "@/components/builtins/geometry/geometry";
import { attached } from "@/components/trees/node/node.fixtures";
import { PathBuilder } from "@/render/descriptors/path-builder";

/**
 * `moveTo` with a `path` travels the curve by arc length, in the same y-up
 * space its `x`/`y` destination form writes into — so where the node is at `t`
 * is a fact of the path, not of wherever the previous command left it.
 */
describe("moveTo along a path", () => {
    it("walks the path by arc length, not by command index", () => {
        const node = attached(new Rect({ width: 10, height: 10 }));
        // Three quarters of the length is in the first (long) leg.
        const cmd = node.moveTo({ data: { path: "M 0 0 L 300 0 L 300 100" }, duration: 1 });
        const step = cmd._stepper();

        step.seek(0);
        expect([node.x, node.y]).toEqual([0, 0]);

        step.seek(0.5);
        expect(node.x).toBeCloseTo(200, 4);
        expect(node.y).toBeCloseTo(0, 4);

        step.seek(1);
        expect(node.x).toBeCloseTo(300, 4);
        expect(node.y).toBeCloseTo(100, 4);
    });

    it("is a pure function of t — a backward seek lands where the forward one did", () => {
        const node = attached(new Rect({ width: 10, height: 10 }));
        const cmd = node.moveTo({
            data: { path: new PathBuilder().ellipse({ width: 400 }) },
            duration: 2,
        });

        cmd.at(0.25);
        const forward = { x: node.x, y: node.y };
        cmd.at(0.9);
        cmd.at(0.25);

        expect(node.x).toBeCloseTo(forward.x, 6);
        expect(node.y).toBeCloseTo(forward.y, 6);
    });

    it("ignores where the node started: the path says where it is at t=0", () => {
        const node = attached(new Rect({ width: 10, height: 10, x: -500, y: 400 }));
        node.moveTo({ data: { path: "M 20 30 L 20 90" }, duration: 1 })._stepper().seek(0);

        expect(node.x).toBeCloseTo(20, 6);
        expect(node.y).toBeCloseTo(30, 6);
    });

    it("still takes a pivot, and writes it to transformOrigin rather than pivot", () => {
        const node = attached(new Rect({ width: 100, height: 50, pivot: "center" }));
        const cmd = node.moveTo({
            data: { path: "M 0 0 L 100 0", pivot: "bottomRight" },
            duration: 1,
        });
        cmd._stepper().seek(1);

        expect(node.x).toBeCloseTo(100, 6);
        expect(node.pivot as unknown).toEqual({ x: 0, y: 0 });
        expect(node.transformOrigin as unknown).toEqual({ x: 1, y: -1 });
    });

    it("refuses a path and an x/y destination together", () => {
        const node = attached(new Rect({ width: 10, height: 10 }));
        expect(() => node.moveTo({ data: { path: "M 0 0 L 10 0", x: 50 }, duration: 1 }))
            .toThrow(/not both/);
    });

    it("writes nothing for a degenerate path rather than collapsing onto the origin", () => {
        const node = attached(new Rect({ width: 10, height: 10, x: 40, y: 60 }));
        node.moveTo({ data: { path: "M 5 5" }, duration: 1 })._stepper().seek(1);

        expect([node.x, node.y]).toEqual([40, 60]);
    });

    it("leaves the plain destination form alone", () => {
        const node = attached(new Rect({ width: 10, height: 10 }));
        node.moveTo({ data: { x: 30, y: 40 }, duration: 1 })._stepper().seek(1);

        expect(node.x).toBeCloseTo(30, 6);
        expect(node.y).toBeCloseTo(40, 6);
    });
});
