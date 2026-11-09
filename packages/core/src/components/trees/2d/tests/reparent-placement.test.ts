import { describe, expect, it } from "vitest";

import { Node2D, type ChildPlane } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Camera } from "@/components/builtins/layout/layout";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";
import { nodeBox, reparentPlacementAt } from "@/runtime/node-picking";
import type { Vector2 } from "@/attributes/layout/vector2";

/**
 * What a host asks before it moves a node to another parent: the `x`/`y`,
 * turn and scale that leave it looking as it does. Each case moves the node
 * for real afterwards and checks its four corners did not move.
 */

const scope = new FakeMeasureContext();

/** 40 px per unit on x, 20 on y. */
const LINEAR: ChildPlane = {
    toOffset: (x, y) => ({ x: x * 40, y: y * 20 }),
    toCoords: (x, y) => ({ x: x / 40, y: y / 20 }),
};

class Plane extends Node2D {
    override _planeOf(): ChildPlane | null {
        return LINEAR;
    }
}

function stage(props: Record<string, unknown> = {}) {
    const root = new Canvas2D({ width: 800, height: 600, flow: "freeform", ...props } as never);
    root.attach(attachScope());
    return root;
}

const layout = (root: Canvas2D) => root.layout({ x: 0, y: 0, width: 800, height: 600 }, scope);

const card = (props: Record<string, unknown> = {}) => new Rect({ width: 100, height: 60, fill: "red", ...props });

// A component frame, laid out by its spec's `Flow`, which answers where a free child lands.
const frameOf = (props: Record<string, unknown>) => new Rect({ fill: "red", ...props });

/** Where `node`'s corners are drawn, viewport space. */
function cornersOf(node: Node2D, path: string): Vector2[] {
    const box = nodeBox(node, path);
    return [box.topLeft, box.topRight, box.bottomRight, box.bottomLeft];
}

/** Asks how `node` keeps its look under `to`, moves it there so, and returns its corners before and after. */
function move(root: Canvas2D, node: Rect, from: string, to: Node2D, toPath: string, newPath: string) {
    layout(root);
    const before = cornersOf(node, from);
    const placement = reparentPlacementAt(root, from, toPath, [{ x: node.x, y: node.y }])!;
    node.parent!.remove(node);
    to.add(node);
    node.x = placement.offsets[0].x;
    node.y = placement.offsets[0].y;
    node.rotation += placement.turn;
    node.scale *= placement.scale;
    layout(root);
    return { placement, before, after: cornersOf(node, newPath) };
}

function expectSame(after: Vector2[], before: Vector2[]) {
    after.forEach((corner, i) => {
        expect(corner.x).toBeCloseTo(before[i].x, 6);
        expect(corner.y).toBeCloseTo(before[i].y, 6);
    });
}

describe("moving a node to another parent", () => {
    it("takes its parent's place with it when it leaves for the stage", () => {
        const root = stage();
        const frame = card({ x: 200, y: 200, width: 400, height: 300 });
        const child = card({ x: 0, y: 0 });
        frame.add(child);
        root.add(frame);

        const { placement, before, after } = move(root, child, "0.0", root, "", "1");
        expect(placement).toEqual({ offsets: [{ x: 200, y: 200 }], turn: 0, scale: 1 });
        expectSame(after, before);
    });

    it("comes into a frame at the offset that keeps it, past the frame's padding and alignment", () => {
        const root = stage();
        const frame = frameOf({ x: -150, y: 80, width: 400, height: 300, padding: { top: 40, left: 10 }, align: "topLeft" });
        const child = card({ x: 120, y: -50, width: 80, height: 40 });
        root.add(frame);
        root.add(child);

        const { before, after } = move(root, child, "1", frame, "0", "0.0");
        expectSame(after, before);
    });

    it("stays as it is under the stage's camera", () => {
        const root = stage({ zoom: 2, lookAt: { x: 60, y: -30 }, heading: 25 });
        const frame = card({ x: 100, y: 50, width: 400, height: 300 });
        const child = card({ x: 30, y: 20 });
        frame.add(child);
        root.add(frame);

        const { placement, before, after } = move(root, child, "0.0", root, "", "1");
        expect(placement.turn).toBeCloseTo(0, 9);
        expect(placement.scale).toBeCloseTo(1, 9);
        expectSame(after, before);
    });

    it("undoes a turned, scaled parent's turn and scale, about an off-centre pivot", () => {
        const root = stage();
        const frame = card({ x: 100, y: 0, width: 400, height: 300, rotation: 90, scale: 1.5 });
        const child = card({ x: 50, y: 0, rotation: 30, scale: 0.8, transformOrigin: "topLeft" });
        frame.add(child);
        root.add(frame);

        const { placement, before, after } = move(root, child, "0.0", root, "", "1");
        expect(placement.turn).toBeCloseTo(90, 9);
        expect(placement.scale).toBeCloseTo(1.5, 9);
        expect(child.rotation).toBeCloseTo(120, 9);
        expect(child.scale).toBeCloseTo(1.2, 9);
        expectSame(after, before);
    });

    it("comes into a turned, scaled frame looking as it did", () => {
        const root = stage();
        const frame = frameOf({ x: -100, y: 40, width: 400, height: 300, rotation: -20, scale: 2 });
        const child = card({ x: 150, y: -60 });
        root.add(frame);
        root.add(child);

        const { placement, before, after } = move(root, child, "1", frame, "0", "0.0");
        expect(placement.turn).toBeCloseTo(20, 9);
        expect(placement.scale).toBeCloseTo(0.5, 9);
        expectSame(after, before);
    });

    it("undoes a camera's zoom and heading when it leaves the camera's view", () => {
        const root = stage();
        const camera = new Camera({ width: 600, height: 400, zoom: 2, heading: 30, lookAt: { x: 20, y: 10 } });
        const child = card({ x: 40, y: -30 });
        camera.add(child);
        root.add(camera);

        const { placement, before, after } = move(root, child, "0.0", root, "", "1");
        expect(placement.turn).toBeCloseTo(-30, 9);
        expect(placement.scale).toBeCloseTo(2, 9);
        expectSame(after, before);
    });

    it("answers in a parent's own coordinates when it has them", () => {
        const root = stage();
        const plane = new Plane({ width: 800, height: 600 });
        const child = card({ x: 80, y: 60 });
        root.add(plane);
        root.add(child);

        const { placement, before, after } = move(root, child, "1", plane, "0", "0.0");
        expect(placement.offsets[0].x).toBeCloseTo(2, 6);
        expect(placement.offsets[0].y).toBeCloseTo(3, 6);
        expectSame(after, before);
    });

    it("carries a move's destination with the node, so the move still ends where it did", () => {
        const root = stage();
        const frame = card({ x: 200, y: 100, width: 400, height: 300, scale: 2 });
        const child = card({ x: 10, y: 0 });
        frame.add(child);
        root.add(frame);

        child.x = 40;
        child.y = -20;
        layout(root);
        const destination = cornersOf(child, "0.0");
        child.x = 10;
        child.y = 0;
        layout(root);

        const placement = reparentPlacementAt(root, "0.0", "", [{ x: 10, y: 0 }, { x: 40, y: -20 }])!;
        frame.remove(child);
        root.add(child);
        child.x = placement.offsets[1].x;
        child.y = placement.offsets[1].y;
        child.scale *= placement.scale;
        layout(root);
        expectSame(cornersOf(child, "1"), destination);
    });

    it("leaves the place to a parent that arranges its children, and refuses one inside the node", () => {
        const root = stage();
        const row = card({ x: 0, y: 0, width: 400, height: 100, flow: "horizontal" });
        const child = card({ x: 30, y: 0 });
        const inner = card({ width: 20, height: 20 });
        child.add(inner);
        root.add(row);
        root.add(child);
        layout(root);

        expect(reparentPlacementAt(root, "1", "0", [{ x: 30, y: 0 }])).toBeNull();
        expect(reparentPlacementAt(root, "1", "1.0", [{ x: 30, y: 0 }])).toBeNull();
        expect(reparentPlacementAt(root, "1", "1", [{ x: 30, y: 0 }])).toBeNull();
    });

    it("comes into an empty component frame, clear of its stroke", () => {
        const root = stage();
        const frame = frameOf({ x: 120, y: -40, width: 300, height: 200, stroke: { color: "black", width: 12 }, align: "bottomRight" });
        const child = card({ x: -200, y: 90, width: 50, height: 30 });
        root.add(frame);
        root.add(child);
        layout(root);
        expect(frame.children).toHaveLength(0);
        expect(frame._slotFor({ width: 50, height: 30 })).not.toBeNull();

        const { before, after } = move(root, child, "1", frame, "0", "0.0");
        expectSame(after, before);
    });

    it("finds no free slot in a component frame that arranges its children in a run", () => {
        const root = stage();
        root.add(frameOf({ width: 300, height: 200, flow: "horizontal" }));
        root.add(card({ x: 40, y: 0 }));
        layout(root);
        expect(reparentPlacementAt(root, "1", "0", [{ x: 40, y: 0 }])).toBeNull();
    });
});
