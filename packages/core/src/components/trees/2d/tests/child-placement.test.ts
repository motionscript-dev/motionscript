import { describe, expect, it } from "vitest";

import { Node2D, type ChildPlacement } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { NullRenderContext } from "@/render/null-render-context";
import { applyToPoint, identity, multiply, nodeLocalMatrix, type Matrix2D } from "@/attributes/layout/matrix2d";
import type { SpaceCamera } from "@/attributes/layout/space3d";
import type { TransformState } from "@/render/descriptors/transform";
import type { NodeRenderState, RenderContext2D } from "@/render/render-context2d";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";
import { nodeBox, parentPlanePointAt } from "@/runtime/node-picking";

/**
 * A parent that places its children in slots beyond their layout boxes — the
 * seam a ring or sphere layout is built on. What these pin down is that the
 * renderer, picking and `global` all see the same slot.
 */

const scope = new FakeMeasureContext();

const NO_SLOT: ChildPlacement = { rotation: 0, scale: 1, rotationX: 0, rotationY: 0, depth: 0, opacity: 1 };

class Slotted extends Node2D {
    readonly slots = new Map<Node2D, ChildPlacement>();
    camera: SpaceCamera | null = null;

    override _placementOf(child: Node2D): ChildPlacement | null {
        return this.slots.get(child) ?? null;
    }

    override _spaceCamera(): SpaceCamera | null {
        return this.camera;
    }
}

class MatrixContext extends NullRenderContext {
    override readonly drawsVisibleOnly = true;
    readonly drawn: { id: string; ctm: Matrix2D; opacity: number }[] = [];
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
        this.drawn.push({ id: this.ids[this.ids.length - 1], ctm: this.ctm, opacity: s.opacity ?? 1 });
        return super.transform(s);
    }
}

function build(...children: Rect[]) {
    const stage = new Canvas2D({ width: 800, height: 600, flow: "freeform" } as never);
    const parent = new Slotted({ width: 800, height: 600 });
    for (const child of children) parent.add(child);
    stage.add(parent);
    stage.attach(attachScope());
    const layout = () => stage.layout({ x: 0, y: 0, width: 800, height: 600 }, scope);
    layout();
    const render = () => {
        const ctx = new MatrixContext();
        stage.render(ctx);
        return ctx.drawn;
    };
    return { stage, parent, layout, render };
}

const card = (props: Record<string, unknown> = {}) => new Rect({ width: 100, height: 60, fill: "red", ...props });

describe("a parent's slot", () => {
    it("turns and scales a child about its box, before the child's own offset", () => {
        const child = card({ x: 50 });
        const { parent, render } = build(child);
        parent.slots.set(child, { ...NO_SLOT, rotation: 90, scale: 2 });

        // The child's +x offset is turned with the slot: 50 right becomes 100 down.
        const drawn = render().find((d) => d.id === child.id)!;
        const centre = applyToPoint(drawn.ctm, { x: 0, y: 0 });
        expect(centre.x).toBeCloseTo(0, 6);
        expect(centre.y).toBeCloseTo(100, 6);

        const g = child.global;
        expect(g.x).toBeCloseTo(0, 6);
        expect(g.y).toBeCloseTo(-100, 6);
        expect(g.rotation).toBeCloseTo(90, 6);
        expect(g.scale).toBeCloseTo(2, 6);
    });

    it("draws a selection box on the pixels it painted", () => {
        const child = card({ x: 20, rotation: 15 });
        const { parent, render } = build(child);
        parent.slots.set(child, { ...NO_SLOT, rotation: -40, scale: 1.5 });

        const drawn = render().find((d) => d.id === child.id)!;
        const box = nodeBox(child, "0.0");
        const corner = applyToPoint(drawn.ctm, { x: -50, y: -30 });
        expect(box.topLeft.x).toBeCloseTo(corner.x, 6);
        expect(box.topLeft.y).toBeCloseTo(-corner.y, 6);
        expect(box.rotation).toBeCloseTo(-25, 6);
    });

    it("fades a child with it, and skips one faded out", () => {
        const faded = card();
        const gone = card();
        const { parent, render } = build(faded, gone);
        parent.slots.set(faded, { ...NO_SLOT, opacity: 0.25 });
        parent.slots.set(gone, { ...NO_SLOT, opacity: 0 });

        const drawn = render();
        expect(drawn.find((d) => d.id === faded.id)!.opacity).toBeCloseTo(0.25, 6);
        expect(drawn.some((d) => d.id === gone.id)).toBe(false);
        expect(nodeBox(faded, "0.0").opacity).toBeCloseTo(0.25, 6);
    });

    it("drags a child across its turned slot rather than its parent's axes", () => {
        const child = card();
        const { parent } = build(child);
        parent.slots.set(child, { ...NO_SLOT, rotation: 90 });

        const a = parentPlanePointAt(parent.parent as Node2D, "0.0", { x: 0, y: 0 })!;
        const b = parentPlanePointAt(parent.parent as Node2D, "0.0", { x: 0, y: -30 })!;
        // Straight down on screen is the slot's +x once it has turned a quarter clockwise.
        expect(b.x - a.x).toBeCloseTo(30, 6);
        expect(b.y - a.y).toBeCloseTo(0, 6);
    });

    it("leaves a child with no slot exactly where it was", () => {
        const child = card({ x: 30, y: -10 });
        const { render } = build(child);
        const drawn = render().find((d) => d.id === child.id)!;
        expect(applyToPoint(drawn.ctm, { x: 0, y: 0 })).toEqual({ x: 30, y: 10 });
    });
});

describe("a node opening a space of its own", () => {
    const camera: SpaceCamera = {
        perspective: 800, orbit: 0, elevation: 0, dolly: 0,
        lookAt: { x: 0, y: 0 }, zoom: 1, heading: 0, viewportX: 0, viewportY: 0,
    };

    it("paints its slotted children far to near, and scales them by depth", () => {
        const near = card();
        const far = card();
        const { parent, render } = build(near, far);
        parent.camera = camera;
        parent.slots.set(near, { ...NO_SLOT, depth: 200 });
        parent.slots.set(far, { ...NO_SLOT, depth: -200 });

        const drawn = render().filter((d) => d.id === near.id || d.id === far.id);
        expect(drawn.map((d) => d.id)).toEqual([far.id, near.id]);

        const width = (id: string) => {
            const m = drawn.find((d) => d.id === id)!.ctm;
            return applyToPoint(m, { x: 50, y: 0 }).x - applyToPoint(m, { x: -50, y: 0 }).x;
        };
        expect(width(near.id)).toBeCloseTo(100 * 800 / 600, 4);
        expect(width(far.id)).toBeCloseTo(100 * 800 / 1000, 4);
        expect(nodeBox(near, "0.0.0").width).toBe(100);
        const box = nodeBox(near, "0.0.0");
        expect(box.topRight.x - box.topLeft.x).toBeCloseTo(width(near.id), 4);
    });
});
