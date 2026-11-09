import { describe, expect, it } from "vitest";

import { OrbitCamera } from "@/components/builtins/layout/layout";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { NullRenderContext } from "@/render/null-render-context";
import { applyToPoint, identity, multiply, nodeLocalMatrix, type Matrix2D } from "@/attributes/layout/matrix2d";
import type { TransformState } from "@/render/descriptors/transform";
import type { NodeRenderState, RenderContext2D } from "@/render/render-context2d";
import { Registry } from "@/document/registry";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";
import { nodeBox } from "@/runtime/node-picking";

/**
 * The stage's 2.5D camera, scoped to one subtree: what it paints and in what
 * order, and that a box drawn over one of its children lands on the pixels.
 */

const scope = new FakeMeasureContext();

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

function build(props: Record<string, unknown>, ...children: Rect[]) {
    const stage = new Canvas2D({ width: 800, height: 600, flow: "freeform" } as never);
    const camera = new OrbitCamera(props as never);
    for (const child of children) camera.add(child);
    stage.add(camera);
    stage.attach(attachScope());
    stage.layout({ x: 0, y: 0, width: 800, height: 600 }, scope);
    const render = () => {
        const ctx = new MatrixContext();
        stage.render(ctx);
        return ctx.drawn;
    };
    return { stage, camera, render };
}

const card = (props: Record<string, unknown> = {}) => new Rect({ width: 100, height: 60, fill: "red", ...props });
const centreOf = (m: Matrix2D) => applyToPoint(m, { x: 0, y: 0 });

describe("OrbitCamera", () => {
    it("paints its children far to near, and sizes them by depth", () => {
        const near = card({ depth: 200 });
        const far = card({ depth: -200 });
        const { render } = build({}, near, far);
        const drawn = render().filter((d) => d.id === near.id || d.id === far.id);
        expect(drawn.map((d) => d.id)).toEqual([far.id, near.id]);
        const width = (m: Matrix2D) => applyToPoint(m, { x: 50, y: 0 }).x - applyToPoint(m, { x: -50, y: 0 }).x;
        // The default perspective is a 1000px lens.
        expect(width(drawn[1].ctm)).toBeCloseTo(100 * 1000 / 800, 4);
    });

    it("turns what it holds when it orbits, and leaves the rest of the scene alone", () => {
        const front = card({ depth: 300 });
        const { render, camera } = build({ orbit: 30, perspective: 0 }, front);
        // Swinging the camera right carries what is nearer the viewer to the left.
        expect(centreOf(render().find((d) => d.id === front.id)!.ctm).x).toBeCloseTo(-150, 4);
        expect(camera.layoutBounds.x).toBe(0);
    });

    it("draws a child's selection box on the pixels it painted", () => {
        const child = card({ x: 40, depth: -120, rotationY: 30 });
        const { render } = build({ orbit: 25, elevation: 15, dolly: 100 }, child);
        const drawn = render().find((d) => d.id === child.id)!;
        const box = nodeBox(child, "0.0");
        const corner = applyToPoint(drawn.ctm, { x: -50, y: -30 });
        expect(box.topLeft.x).toBeCloseTo(corner.x, 4);
        expect(box.topLeft.y).toBeCloseTo(-corner.y, 4);
    });

    it("turns on the clock by its own speed", () => {
        const { camera, stage } = build({ orbit: 10, orbitSpeed: 30 });
        stage.attach(attachScope(2));
        expect(camera._spaceCamera()!.orbit).toBe(70);
    });

    it("hugs what it holds, and is offered by the builtins with its camera commands", () => {
        const { camera } = build({}, card(), card({ width: 160 }));
        expect(camera.layoutBounds.width).toBe(160);
        const registry = new Registry();
        expect(registry.hasNode("orbitCamera")).toBe(true);
        expect(registry.commandKeys("orbitCamera")).toEqual(
            expect.arrayContaining(["orbitTo", "dollyTo", "zoomTo", "panTo", "headingTo"]),
        );
    });
});
