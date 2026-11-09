import { describe, expect, it } from "vitest";

import { documentDuration, type CommandSpec, type CompositionDocument } from "@/document/types";
import { ClipInstance } from "@/runtime/clip-instance";
import { runtimeScope } from "@/runtime/document.fixtures";
import { Scene3D } from "@/render3d/scene3d";
import { Box3D, type Camera3D, Group3D } from "@/components/builtins/three/three";
import type { Canvas3D } from "@/components/builtins/three/canvas3d";
import { Node3D, type ChildSpace3D } from "@/components/trees/three/node3d";
import type { Node2D } from "@/components/trees/2d/node2d";
import { component2d } from "@/components/factory/component2d";
import { component3d } from "@/components/factory/component3d";

interface Built {
    view: Canvas3D;
    box: Box3D;
    camera: Camera3D;
}

function after(commands: CommandSpec[], at: number, props: Record<string, Record<string, unknown>> = {}): Built {
    const doc: CompositionDocument = {
        kind: "composition",
        nodes: [
            { id: "view", type: "canvas3d", parentId: null, layerOrder: 0, props: { width: 400, height: 300, ...props.view } },
            { id: "box", type: "box3d", parentId: "view", layerOrder: 0, props: { x: 1, ...props.box } },
            { id: "camera", type: "camera3d", parentId: "view", layerOrder: 1, props: { ...props.camera } },
        ],
        commands,
    };
    const instance = new ClipInstance(doc, documentDuration(doc), runtimeScope());
    instance.build();
    instance.evaluateAt(at);
    const view = instance.canvas.children[0] as Canvas3D;
    const [box, camera] = view._allChildren.filter((c) => c instanceof Node3D) as unknown as [Box3D, Camera3D];
    return { view, box, camera };
}

function command(type: string, targetId: string, args: Record<string, unknown>): CommandSpec {
    return { id: `${type}-${targetId}`, type, targetId, at: 0, duration: 1, args };
}

describe("a 3D node's own commands", () => {
    it("moves along the axes it is given and leaves the rest", () => {
        const { box } = after([command("moveTo", "box", { y: 4, z: -2 })], 0.5);
        expect([box.x, box.y, box.z]).toEqual([1, 2, -1]);
    });

    it("turns about the axes it is given", () => {
        const { box } = after([command("rotateTo", "box", { rotationY: 180 })], 0.5, { box: { rotationX: 30 } });
        expect([box.rotationX, box.rotationY, box.rotationZ]).toEqual([30, 90, 0]);
    });

    it("scales every axis by one number, an axis named beside it winning", () => {
        const { box } = after([command("scaleTo", "box", { scale: 3, scaleY: 1 })], 1);
        expect([box.scaleX, box.scaleY, box.scaleZ]).toEqual([3, 1, 3]);
    });
});

describe("framing a 3D scene", () => {
    it("swings the viewport's default camera, one axis at a time", () => {
        const { view } = after([command("orbitTo", "view", { orbit: 135 })], 0.5);
        expect(view.orbit).toBe(85);
        expect(view.elevation).toBe(20);
        expect(view.zoom).toBe(12);
    });

    it("starts a camera with no polar placement from what an unset one reads as", () => {
        const { camera } = after([command("orbitTo", "camera", { orbit: 90, distance: 6 })], 0.5);
        expect(camera.orbit).toBe(45);
        expect(camera.distance).toBe(8);
        expect(camera.elevation).toBeUndefined();
    });

    it("turns a camera toward another point", () => {
        const { camera } = after([command("lookTo", "camera", { target: [0, 2, 4] })], 0.5);
        expect(camera.target).toEqual({ x: 0, y: 1, z: 2 });
    });
});

describe("a 3D parent's own coordinates", () => {
    const doubled: ChildSpace3D = { toLocal: (x, y, z) => ({ x: x * 2, y: z, z: -y }) };
    const Doubled = component3d({ key: "doubled3d", space: () => doubled });

    function positions(root: Node3D): unknown[] {
        const scene = new Scene3D();
        root.render(scene);
        return scene.ops().flatMap((op) => (op.kind === "push" ? [op.transform?.position] : []));
    }

    it("place a child by its position, and only its position", () => {
        const child = new Box3D({ x: 1, y: 2, z: 3, scaleX: 5 });
        const [, placed] = positions(new Doubled({ children: [child] }) as Node3D);
        expect(placed).toEqual({ x: 2, y: 3, z: -2 });
        expect(child.x).toBe(1);
        expect(child.scaleX).toBe(5);
    });

    it("are the node's local space unless it says otherwise", () => {
        const [, placed] = positions(new Group3D({ children: [new Box3D({ x: 1, y: 2, z: 3 })] }));
        expect(placed).toEqual({ x: 1, y: 2, z: 3 });
    });

    it("can be a viewport's, for the 3D nodes directly inside it", () => {
        const Graph = component2d({ key: "doubledGraph", allowedChildren: ["3d"], space: () => doubled });
        const child = new Box3D({ x: 1, y: 2, z: 3 });
        new Graph({ children: [child] as never }) as Node2D;
        const scene = new Scene3D();
        child.render(scene);
        const [placed] = scene.ops().flatMap((op) => (op.kind === "push" ? [op.transform?.position] : []));
        expect(placed).toEqual({ x: 2, y: 3, z: -2 });
        expect(positions(new Group3D({ children: [new Box3D({ x: 1, y: 2, z: 3 })] }))[1]).toEqual({ x: 1, y: 2, z: 3 });
    });
});
