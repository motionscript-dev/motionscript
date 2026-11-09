import { describe, it, expect } from "vitest";
import { Rect } from "@/components/builtins/geometry/geometry";
import { attached } from "@/components/trees/node/node.fixtures";

/**
 * A tween that positions a node via a named alignment prop (`topRight: {x, y}`,
 * or the new `pivot` option on `moveTo`/`rotateTo`/`scaleTo`) sets the node's
 * *transient* `transformOrigin`, never its permanent `pivot` — which stays
 * exactly what the node's own construction-time alignment put it at, for the
 * node's whole life. Before this, `_prepareStep` wrote straight to `pivot`,
 * so a `moveTo` aligned differently from the node quietly re-pointed every
 * rotation/scale that ran after it.
 */
describe("a tween's alignment/pivot never touches the node's own pivot", () => {
    it("sets transformOrigin, not pivot, for a tween positioned via a named prop", () => {
        const node = attached(new Rect({ width: 100, height: 50, pivot: "center" }));
        expect(node.pivot as unknown).toEqual({ x: 0, y: 0 });

        const cmd = node.to({ data: { topRight: { x: 10, y: 20 } } as never, duration: 1 });
        cmd._stepper().seek(1);

        expect(node.pivot as unknown).toEqual({ x: 0, y: 0 });
        expect(node.transformOrigin as unknown).toEqual({ x: 1, y: 1 });
    });

    it("moveTo's object form accepts an explicit pivot, independent of its target", () => {
        const node = attached(new Rect({ width: 100, height: 50, pivot: "topLeft" }));

        const cmd = node.moveTo({ data: { x: 50, y: 60, pivot: "bottomRight" }, duration: 1 });
        cmd._stepper().seek(1);

        expect(node.x).toBeCloseTo(50, 6);
        expect(node.y).toBeCloseTo(60, 6);
        expect(node.pivot as unknown).toEqual({ x: -1, y: 1 });
        expect(node.transformOrigin as unknown).toEqual({ x: 1, y: -1 });
    });

    it("moveTo's positional form still works, unchanged", () => {
        const node = attached(new Rect({ width: 100, height: 50, x: 0, y: 0 }));

        const cmd = node.moveTo({ data: { x: 30, y: 40 }, duration: 1 });
        cmd._stepper().seek(1);

        expect(node.x).toBeCloseTo(30, 6);
        expect(node.y).toBeCloseTo(40, 6);
    });

    it("rotateTo's object form takes its own pivot without moving the node's own", () => {
        const node = attached(new Rect({ width: 100, height: 50, pivot: "center" }));

        const cmd = node.rotateTo({ data: { rotation: 90, pivot: "topLeft" }, duration: 1 });
        cmd._stepper().seek(1);

        expect(node.rotation).toBeCloseTo(90, 6);
        expect(node.pivot as unknown).toEqual({ x: 0, y: 0 });
        expect(node.transformOrigin as unknown).toEqual({ x: -1, y: 1 });
    });

    it("rotateTo's positional form still works, unchanged", () => {
        const node = attached(new Rect({ width: 100, height: 50 }));

        const cmd = node.rotateTo({ data: { rotation: 180 }, duration: 1 });
        cmd._stepper().seek(1);

        expect(node.rotation).toBeCloseTo(180, 6);
    });

    it("scaleTo's object form takes its own pivot without moving the node's own", () => {
        const node = attached(new Rect({ width: 100, height: 50, pivot: "center" }));

        const cmd = node.scaleTo({ data: { scale: 2, pivot: "bottomCenter" }, duration: 1 });
        cmd._stepper().seek(1);

        expect(node.scale).toBeCloseTo(2, 6);
        expect(node.pivot as unknown).toEqual({ x: 0, y: 0 });
        expect(node.transformOrigin as unknown).toEqual({ x: 0, y: -1 });
    });

    it("scaleTo's positional form still works, unchanged", () => {
        const node = attached(new Rect({ width: 100, height: 50 }));

        const cmd = node.scaleTo({ data: { scale: 0.5 }, duration: 1 });
        cmd._stepper().seek(1);

        expect(node.scale).toBeCloseTo(0.5, 6);
    });

    it("a later step with no pivot of its own carries the last one forward, like any other prop", () => {
        const node = attached(new Rect({ width: 100, height: 50, pivot: "center" }));

        node.rotateTo({ data: { rotation: 45, pivot: "topLeft" }, duration: 1 })._stepper().seek(1);
        expect(node.transformOrigin as unknown).toEqual({ x: -1, y: 1 });

        // No pivot on this one -- transformOrigin is untouched by it, exactly
        // as an unstated `x` or `opacity` would be.
        node.rotateTo({ data: { rotation: 90 }, duration: 1 })._stepper().seek(1);
        expect(node.rotation).toBeCloseTo(90, 6);
        expect(node.transformOrigin as unknown).toEqual({ x: -1, y: 1 });
        expect(node.pivot as unknown).toEqual({ x: 0, y: 0 });
    });
});

describe("transformOrigin: null", () => {
    it("reads as unset, so the transform turns about the pivot", () => {
        const node = attached(new Rect({ width: 100, height: 50, transformOrigin: null as never }));
        expect(node.transformOrigin).toBeUndefined();

        node.set({ transformOrigin: "topLeft" });
        expect(node.transformOrigin as unknown).toEqual({ x: -1, y: 1 });
        node.set({ transformOrigin: null as never });
        expect(node.transformOrigin).toBeUndefined();
    });
});
