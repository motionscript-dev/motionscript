import { describe, expect, it } from "vitest";

import type { Vector2 } from "@/attributes/layout/vector2";
import type { NodeHandle } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";
import { handleValueAt, nodeHandlesAt } from "@/runtime/node-picking";
import { generated } from "@/components/factory/tests/generated.fixtures";

/** A rect with one point of its own an editor can drag, stored in its own frame. */
class Tipped extends generated(Rect) {
    tip: Vector2 = { x: 30, y: 10 };

    override _handles(): readonly NodeHandle[] {
        return [{ prop: "tip", at: this.tip }];
    }

    override _handleValue(prop: string, at: Vector2): Vector2 | null {
        return prop === "tip" ? at : null;
    }
}

function build(props: Record<string, unknown>) {
    const stage = new Canvas2D({ width: 800, height: 600, flow: "freeform" } as never);
    const node = new Tipped({ width: 100, height: 60, ...props });
    stage.add(node);
    stage.attach(attachScope());
    stage.layout({ x: 0, y: 0, width: 800, height: 600 }, new FakeMeasureContext());
    return { stage, node };
}

describe("a node's handles", () => {
    it("are where its own frame puts them on screen", () => {
        const { stage } = build({ x: 100, y: 50 });
        expect(nodeHandlesAt(stage, "0")).toEqual([{ prop: "tip", at: { x: 130, y: 60 } }]);
    });

    it("answer a drag with the value that puts the handle under the pointer, turned with the node", () => {
        const { stage, node } = build({ x: 100, y: 50, rotation: 90, scale: 2 });
        const [handle] = nodeHandlesAt(stage, "0")!;
        expect(Math.hypot(handle.at.x - 100, handle.at.y - 50)).toBeCloseTo(2 * Math.hypot(30, 10), 6);

        const value = handleValueAt(stage, "0", "tip", { x: handle.at.x + 10, y: handle.at.y })!;
        node.tip = value;
        const [moved] = nodeHandlesAt(stage, "0")!;
        expect(moved.at.x).toBeCloseTo(handle.at.x + 10, 6);
        expect(moved.at.y).toBeCloseTo(handle.at.y, 6);
    });

    it("are none on a node that names none, and refuse a prop that is not one", () => {
        const { stage } = build({});
        expect(nodeHandlesAt(stage, "")).toEqual([]);
        expect(handleValueAt(stage, "0", "x", { x: 0, y: 0 })).toBeNull();
        expect(nodeHandlesAt(stage, "5")).toBeNull();
    });
});
