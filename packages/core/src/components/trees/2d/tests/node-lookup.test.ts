import { describe, expect, it } from "vitest";
import { findNode2D, frameIn, Node2D } from "@/components/trees/2d/node2d";
import { attached } from "@/components/trees/node/node.fixtures";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";
import type { BoxBounds } from "@/layout/bounds";

const scope = new FakeMeasureContext();

class Tile extends Node2D {
    constructor(props?: ConstructorParameters<typeof Node2D>[0]) {
        super(props ?? {});
    }
    place(rect: BoxBounds): this {
        this.layout(rect, scope);
        return this;
    }
}

/** Two branches under one root: `host` turned and scaled, `far` offset in the other. */
function tree() {
    const root = new Tile({ id: "root" });
    const left = new Tile({ id: "left", x: -100 });
    const host = new Tile({ id: "host", rotation: 90, scale: 2 });
    const right = new Tile({ id: "right", x: 100 });
    const far = new Tile({ id: "far", y: 40 });
    root.add(left);
    root.add(right);
    left.add(host);
    right.add(far);
    attached(root);
    for (const node of [root, left, host, right, far]) node.place({ x: 0, y: 0, width: 10, height: 10 });
    return { root, host, far };
}

describe("reaching another node by id", () => {
    it("finds a node in another branch, starting anywhere in the tree", () => {
        const { host, far, root } = tree();
        expect(findNode2D(host, "far")).toBe(far);
        expect(findNode2D(far, "root")).toBe(root);
        expect(findNode2D(host, "nowhere")).toBeNull();
    });

    it("reads where that node sits in the host's own frame", () => {
        const { host, far } = tree();
        // `far` is 200 right and 40 up of `host`, which is turned a quarter clockwise at twice the size.
        const frame = frameIn(host, far);
        expect(frame.x).toBeCloseTo(-20, 6);
        expect(frame.y).toBeCloseTo(100, 6);
        expect(frame.rotation).toBeCloseTo(-90, 6);
        expect(frame.scale).toBeCloseTo(0.5, 6);
    });
});
