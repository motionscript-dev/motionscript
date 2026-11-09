import { describe, expect, it } from "vitest";

import { Node2D } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { MaskGroup } from "@/components/builtins/geometry/composite";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { NullRenderContext } from "@/render/null-render-context";
import {
    applyToPoint, cameraMatrix, identity, isProjective, multiply, nodeLocalMatrix, type Matrix2D,
} from "@/attributes/layout/matrix2d";
import type { TransformState } from "@/render/descriptors/transform";
import type { NodeRenderState, RenderContext2D } from "@/render/render-context2d";
import type { Vector2 } from "@/attributes/layout/vector2";
import { getCommandMeta } from "@/tween/command-decorator";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";
import { nodeBox, parentPlanePointAt, pickNode } from "@/runtime/node-picking";

/**
 * The stage as a 2.5D space: its children placed in one 3D frame and seen
 * through its camera. What these check is the renderer's side — the matrix each
 * node ends up drawn under, and the order they are drawn in — and that picking
 * lands on the same pixels.
 */

const scope = new FakeMeasureContext();

/**
 * Tracks the canvas matrix the way a 2D renderer does — a node scope saves it, a
 * transform concats onto it, a camera pushes its own — and records what each
 * node was drawn under, in draw order.
 */
class MatrixContext extends NullRenderContext {
    override readonly drawsVisibleOnly = true;
    readonly drawn: { id: string; ctm: Matrix2D }[] = [];
    private ctm: Matrix2D = identity();
    private readonly saved: Matrix2D[] = [];
    private readonly cameras: Matrix2D[] = [];
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

    override beginCamera(viewport: { x: number; y: number }, lookAt: Vector2, zoom: number, heading: number): void {
        this.cameras.push(this.ctm);
        this.ctm = multiply(this.ctm, cameraMatrix(viewport.x, viewport.y, lookAt, zoom, heading));
    }

    override endCamera(): void {
        this.ctm = this.cameras.pop()!;
    }
}

function scene(stageProps: Record<string, unknown>, children: Record<string, Node2D>) {
    const stage = new Canvas2D({ width: 800, height: 600, flow: "freeform", ...stageProps } as never);
    for (const child of Object.values(children)) stage.add(child);
    stage.attach(attachScope());
    stage.layout({ x: 0, y: 0, width: 800, height: 600 }, scope);
    const names = new Map(Object.entries(children).map(([name, node]) => [node.id, name]));
    const render = () => {
        const ctx = new MatrixContext();
        stage.render(ctx);
        return ctx.drawn
            .filter((d) => names.has(d.id))
            .map((d) => ({ name: names.get(d.id)!, ctm: d.ctm }));
    };
    return { stage, render };
}

function samePoints(a: Matrix2D, b: Matrix2D, eps = 1e-6): void {
    for (const p of [{ x: 0, y: 0 }, { x: 40, y: -25 }, { x: -60, y: 30 }]) {
        const pa = applyToPoint(a, p), pb = applyToPoint(b, p);
        expect(Math.abs(pa.x - pb.x)).toBeLessThanOrEqual(eps);
        expect(Math.abs(pa.y - pb.y)).toBeLessThanOrEqual(eps);
    }
}

const card = (props: Record<string, unknown> = {}) => new Rect({ width: 120, height: 80, fill: "red", ...props });

describe("space3D — turning it on", () => {
    it("changes nothing until something moves in depth", () => {
        const build = (space3D: boolean) => scene(
            { space3D, perspective: 900, zoom: 1.3, heading: 12, lookAt: { x: 40, y: -30 } },
            {
                a: card({ x: -200, y: 80, rotation: 20 }),
                b: card({ x: 150, y: -60, scale: 1.5 }),
                c: card({ x: 20, y: 10, rotation: -35, scale: 0.7 }),
            },
        ).render();
        const flat = build(false);
        const space = build(true);
        expect(space.map((d) => d.name)).toEqual(["a", "b", "c"]);
        for (let i = 0; i < flat.length; i++) samePoints(space[i].ctm, flat[i].ctm);
    });

    it("keeps the stage's own tilt off the stage, which is the camera's", () => {
        const { stage } = scene({ space3D: true, perspective: 900, rotationY: 40, depth: 300 }, {});
        const ctx = new MatrixContext();
        stage.render(ctx);
        expect(ctx.drawn[0].ctm).toEqual(identity());
    });

    it("declares its camera moves as commands", () => {
        const keys = getCommandMeta(new Canvas2D({})).map((m) => m.key);
        expect(keys).toEqual(expect.arrayContaining(["panTo", "zoomTo", "headingTo", "orbitTo", "dollyTo"]));
    });
});

describe("space3D — paint order", () => {
    it("paints siblings far to near, whatever order they were authored in", () => {
        const { render } = scene({ space3D: true, perspective: 1000, orbit: 20 }, {
            near: card({ depth: 300 }),
            far: card({ depth: -800 }),
            middle: card({ depth: 0 }),
        });
        expect(render().map((d) => d.name)).toEqual(["far", "middle", "near"]);
    });

    it("leaves coplanar siblings in their authored order", () => {
        const { render } = scene({ space3D: true, perspective: 1000, orbit: 35, elevation: 15 }, {
            back: card({ x: 150, width: 600, height: 400 }),
            label: card({ x: -150 }),
        });
        expect(render().map((d) => d.name)).toEqual(["back", "label"]);
    });

    it("sorts a group as one unit and its children among themselves", () => {
        const ring = new Rect({ width: 10, height: 10 });
        const front = card({ depth: 200 });
        const back = card({ depth: -200 });
        ring.add(front);
        ring.add(back);
        const { stage } = scene({ space3D: true, perspective: 1000 }, { ring, wall: card({ depth: -1500 }) });
        const ctx = new MatrixContext();
        stage.render(ctx);
        const order = ctx.drawn.map((d) => d.id);
        expect(order.indexOf(back.id)).toBeLessThan(order.indexOf(front.id));
    });
});

describe("space3D — the camera decides", () => {
    it("shows the back of every node once it orbits half way round", () => {
        const { render } = scene({ space3D: true, perspective: 1000, orbit: 180 }, {
            front: card({ backfaceVisible: false }),
            turned: card({ rotationY: 180, backfaceVisible: false }),
        });
        expect(render().map((d) => d.name)).toEqual(["turned"]);
    });

    it("stops drawing what the camera has flown past, but not what is still ahead of it", () => {
        const group = new Rect({ width: 200, height: 200 });
        const ahead = card({ depth: -1000 });
        group.add(ahead);
        const { stage } = scene({ space3D: true, perspective: 1000, lookAt: { x: 0, y: 0, z: -1500 } }, { group });
        const ctx = new MatrixContext();
        stage.render(ctx);
        const byId = new Map(ctx.drawn.map((d) => [d.id, d.ctm]));
        // The group is behind the lens: it pushes no plane, so its scope is the stage's.
        expect(byId.get(group.id)).toEqual(identity());
        // The child still lands exactly where the space puts it.
        const expected = nodeBox(ahead, "0.0");
        const at = applyToPoint(byId.get(ahead.id)!, { x: 0, y: 0 });
        expect(at.x).toBeCloseTo(expected.center.x, 6);
        expect(-at.y).toBeCloseTo(expected.center.y, 6);
    });

    it("flattens a mask's children into its plane", () => {
        const mask = new MaskGroup({ width: 200, height: 200 } as never);
        const shape = card({ depth: 500 });
        const content = card();
        mask.add(shape);
        mask.add(content);
        const { stage } = scene({ space3D: true, perspective: 1000, orbit: 30 }, { mask });
        const ctx = new MatrixContext();
        stage.render(ctx);
        const shapeDrawn = ctx.drawn.find((d) => d.id === shape.id)!;
        // A flat node under the mask: its own per-node rules, not the space's —
        // `depth` without a perspective of its own does nothing.
        const maskDrawn = ctx.drawn.find((d) => d.id === mask.id)!;
        samePoints(shapeDrawn.ctm, multiply(maskDrawn.ctm, shape._localMatrix()));
    });
});

describe("space3D — picking agrees with the pixels", () => {
    it("boxes a tilted node at its projected corners", () => {
        const tilted = card({ rotationY: 50, depth: 100 });
        const { render } = scene({ space3D: true, perspective: 900, orbit: -20, elevation: 10 }, { tilted });
        const drawn = render()[0].ctm;
        expect(isProjective(drawn)).toBe(true);
        const box = nodeBox(tilted, "0");
        const corner = applyToPoint(drawn, { x: -60, y: -40 });
        expect(box.topLeft.x).toBeCloseTo(corner.x, 6);
        expect(box.topLeft.y).toBeCloseTo(-corner.y, 6);
    });

    it("picks the nearest node, not the last authored one", () => {
        const near = card({ depth: 300 });
        const far = card({ depth: -300 });
        const { stage } = scene({ space3D: true, perspective: 1000 }, { near, far });
        expect(pickNode(stage, { x: 0, y: 0 })?.id).toBe(near.id);
    });

    it("does not pick a node behind the camera", () => {
        const { stage } = scene({ space3D: true, perspective: 1000, lookAt: { x: 0, y: 0, z: -1500 } }, { gone: card() });
        expect(pickNode(stage, { x: 0, y: 0 })).toBeNull();
    });

    it("maps a screen point back onto the plane a node moves in", () => {
        const moved = card({ x: 70, y: -40, depth: -300, rotationY: 25 });
        const { stage } = scene({ space3D: true, perspective: 900, orbit: 30, elevation: 20 }, { moved });
        const onScreen = nodeBox(moved, "0").center;
        const onPlane = parentPlanePointAt(stage, "0", onScreen)!;
        expect(onPlane.x).toBeCloseTo(70, 6);
        expect(onPlane.y).toBeCloseTo(-40, 6);
    });
});
