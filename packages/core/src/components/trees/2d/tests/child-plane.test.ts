import { describe, expect, it } from "vitest";

import { Node2D, type ChildPlane } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { NullRenderContext } from "@/render/null-render-context";
import { applyToPoint, identity, multiply, nodeLocalMatrix, type Matrix2D } from "@/attributes/layout/matrix2d";
import type { TransformState } from "@/render/descriptors/transform";
import type { NodeRenderState, RenderContext2D } from "@/render/render-context2d";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";
import { childPlanePointAt, nodeBox, parentPlanePointAt } from "@/runtime/node-picking";

/**
 * A parent whose children's `x`/`y` are in its own coordinates — the seam a
 * coordinate system is built on. What these pin down is that the renderer,
 * `global`, picking and `moveTo({ target })` all read the same mapping.
 */

const scope = new FakeMeasureContext();

/** 40 px per unit on x, 20 on y. */
const LINEAR: ChildPlane = {
    toOffset: (x, y) => ({ x: x * 40, y: y * 20 }),
    toCoords: (x, y) => ({ x: x / 40, y: y / 20 }),
};

/** A decade is 100 px on x; y is pixels. */
const LOG: ChildPlane = {
    toOffset: (x, y) => ({ x: Math.log10(x) * 100, y }),
    toCoords: (x, y) => ({ x: 10 ** (x / 100), y }),
};

class Plane extends Node2D {
    plane: ChildPlane | null = LINEAR;
    asked: (Node2D | null)[] = [];

    override _planeOf(child: Node2D | null): ChildPlane | null {
        this.asked.push(child);
        return this.plane;
    }
}

class MatrixContext extends NullRenderContext {
    override readonly drawsVisibleOnly = true;
    readonly drawn: { id: string; ctm: Matrix2D }[] = [];
    private ctm: Matrix2D = identity();
    private readonly saved: Matrix2D[] = [];
    private readonly ids: string[] = [];

    override begin(state: NodeRenderState): void {
        super.begin(state);
        this.saved.push(this.ctm);
        this.ids.push(state.id);
    }

    override end(): void {
        super.end();
        this.ctm = this.saved.pop()!;
        this.ids.pop();
    }

    override transform(s: Partial<TransformState>): RenderContext2D {
        const width = s.width ?? 0, height = s.height ?? 0;
        const pivot = s.pivot ?? { x: 0, y: 0 };
        const local = s.matrix ?? nodeLocalMatrix(
            s.x ?? 0, s.y ?? 0, s.rotation ?? 0, s.scale ?? 1, pivot.x * (width / 2), -pivot.y * (height / 2),
        );
        this.ctm = multiply(this.ctm, local);
        this.drawn.push({ id: this.ids[this.ids.length - 1], ctm: this.ctm });
        return super.transform(s);
    }
}

function build(...children: Rect[]) {
    const stage = new Canvas2D({ width: 800, height: 600, flow: "freeform" } as never);
    const parent = new Plane({ width: 800, height: 600 });
    for (const child of children) parent.add(child);
    stage.add(parent);
    stage.attach(attachScope());
    stage.layout({ x: 0, y: 0, width: 800, height: 600 }, scope);
    const centreOf = (child: Rect) => {
        const ctx = new MatrixContext();
        stage.render(ctx);
        return applyToPoint(ctx.drawn.find((d) => d.id === child.id)!.ctm, { x: 0, y: 0 });
    };
    return { stage, parent, centreOf };
}

const card = (props: Record<string, unknown> = {}) => new Rect({ width: 100, height: 60, fill: "red", ...props });

describe("a parent's own coordinates", () => {
    it("places a child by them and leaves its size alone", () => {
        const child = card({ x: 2, y: 3 });
        const { centreOf } = build(child);

        expect(centreOf(child)).toEqual({ x: 80, y: -60 });
        const box = nodeBox(child, "0.0");
        expect(box.width).toBe(100);
        expect(box.height).toBe(60);
    });

    it("reports the same place through global and the local anchors", () => {
        const child = card({ x: 2, y: 3 });
        build(child);

        expect(child.global.x).toBeCloseTo(80, 6);
        expect(child.global.y).toBeCloseTo(60, 6);
        expect(child.center).toEqual({ x: 80, y: 60 });
        expect(child.topRight).toEqual({ x: 130, y: 90 });
    });

    it("turns a child about its mapped position", () => {
        const child = card({ x: 2, y: 0, rotation: 90 });
        const { centreOf } = build(child);
        expect(centreOf(child).x).toBeCloseTo(80, 6);
        expect(centreOf(child).y).toBeCloseTo(0, 6);
    });

    it("answers a drag in them, as the x/y that centres the child on the pointer", () => {
        const child = card({ x: 2, y: 3 });
        const { stage, centreOf } = build(child);

        const at = parentPlanePointAt(stage, "0.0", { x: 120, y: 40 })!;
        expect(at.x).toBeCloseTo(3, 6);
        expect(at.y).toBeCloseTo(2, 6);

        child.x = at.x;
        child.y = at.y;
        expect(centreOf(child)).toEqual({ x: 120, y: -40 });
    });

    it("answers where a child that is not there yet would sit, and nothing where children are in pixels", () => {
        const { stage, parent } = build(card({ x: 2, y: 3 }));

        parent.asked = [];
        const at = childPlanePointAt(stage, "0", { x: 120, y: 40 })!;
        expect(parent.asked).toEqual([null]);
        expect(at.x).toBeCloseTo(3, 6);
        expect(at.y).toBeCloseTo(2, 6);
        expect(at).toEqual(parentPlanePointAt(stage, "0.0", { x: 120, y: 40 }));

        expect(childPlanePointAt(stage, "", { x: 120, y: 40 })).toBeNull();
        parent.plane = null;
        expect(childPlanePointAt(stage, "0", { x: 120, y: 40 })).toBeNull();
    });

    it("round-trips a drag through coordinates that are not linear", () => {
        const child = card({ x: 10, y: 0 });
        const { stage, parent, centreOf } = build(child);
        parent.plane = LOG;

        expect(centreOf(child).x).toBeCloseTo(100, 6);
        const at = parentPlanePointAt(stage, "0.0", { x: 250, y: 0 })!;
        expect(at.x).toBeCloseTo(10 ** 2.5, 6);
        child.x = at.x;
        expect(centreOf(child).x).toBeCloseTo(250, 6);
    });

    it("lands moveTo on a target sibling, with the destination in them", () => {
        const target = card({ id: "target", x: 5, y: -2 });
        const mover = card({ id: "mover" });
        const { centreOf } = build(target, mover);

        mover.moveTo({ data: { target: "target" }, duration: 1 })._stepper().seek(1);
        expect(mover.x).toBeCloseTo(5, 6);
        expect(mover.y).toBeCloseTo(-2, 6);
        expect(centreOf(mover)).toEqual(centreOf(target));
    });

    it("is pixels again once the parent stops answering", () => {
        const child = card({ x: 2, y: 3 });
        const { parent, centreOf } = build(child);
        parent.plane = null;
        expect(centreOf(child)).toEqual({ x: 2, y: -3 });
    });
});
