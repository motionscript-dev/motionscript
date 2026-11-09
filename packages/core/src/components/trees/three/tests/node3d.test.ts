import { describe, it, expect } from 'vitest';
import { Scene3D, type Scene3DOp } from '@/render3d/scene3d';
import { Node3D } from '@/components/trees/three/node3d';
import { Group3D, Box3D, Sphere3D, AmbientLight3D, DirectionalLight3D, Camera3D, Fog3D } from "@/components/builtins/three/three";
import { Canvas3D as Canvas3DComponent } from "@/components/builtins/three/canvas3d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Text } from "@/components/builtins/text/text";
import { Node2D } from '@/components/trees/2d/node2d';
import { parseColor } from '@/attributes/shape/fill/color/parser';
import { attached } from '@/components/trees/node/node.fixtures';

/** The viewport, with the scene its render builds now. */
type Canvas3D = Canvas3DComponent & { _scene3D(): Scene3D };
const Canvas3D = Canvas3DComponent as unknown as new (props?: ConstructorParameters<typeof Canvas3DComponent>[0]) => Canvas3D;

/** A node's 3D children: the ones a viewport renders into its scene. */
const children3D = (node: Node2D) => node._allChildren.filter((child): child is Node3D => child instanceof Node3D);

/** Record a subtree the way `Canvas3D` does, and hand back the op list. */
function record(root: Node3D): readonly Scene3DOp[] {
    const scene = new Scene3D();
    root.render(scene);
    return scene.ops();
}

/** The `key` on each `push`, i.e. the identity the renderer caches against. */
function pushKeys(ops: readonly Scene3DOp[]): (string | undefined)[] {
    return ops
        .filter((o): o is Extract<Scene3DOp, { kind: 'push' }> => o.kind === 'push')
        .map((o) => o.transform?.key);
}

describe('Node3D → Scene3D', () => {
    it('brackets every node with a balanced push/pop', () => {
        const tree = new Group3D({
            children: [new Box3D(), new Group3D({ children: [new Sphere3D()] })],
        });

        const ops = record(tree);
        expect(ops.map((o) => o.kind)).toEqual([
            'push', /* Box3D */ 'push', 'mesh', 'pop',
            /* inner Group3D */ 'push', /* Sphere3D */ 'push', 'mesh', 'pop', 'pop',
            'pop',
        ]);

        const scene = new Scene3D();
        tree.render(scene);
        expect(() => scene.assertBalanced()).not.toThrow();
    });

    it('carries a mesh node\'s shadow onto the mesh it draws, not only its group', () => {
        const modes = (box: Box3D) => record(box).flatMap((o) => (o.kind === 'mesh' ? [o.transform?.shadow] : []));

        expect(modes(new Box3D())).toEqual([true]);
        expect(modes(new Box3D({ shadow: false }))).toEqual([false]);
        expect(modes(new Box3D({ shadow: 'receive' }))).toEqual(['receive']);
    });

    it('keys each group by its node id, not by its index among siblings', () => {
        const box = new Box3D();
        const tree = new Group3D({ children: [box] });

        expect(pushKeys(record(tree))).toEqual([tree.id, box.id]);
    });

    // The whole reason identity moved off the structural path: a conditional
    // sibling used to renumber every later slot and rebuild the tail of the cache.
    it('a conditional sibling does not renumber the nodes after it', () => {
        const kept = new Box3D();
        const withoutFirst = new Group3D({ children: [kept] });
        const first = new Sphere3D();
        const withFirst = new Group3D({ children: [first, kept] });

        expect(pushKeys(record(withoutFirst))).toContain(kept.id);
        expect(pushKeys(record(withFirst))).toContain(kept.id);
    });

    it('a light, a camera and a fog each record their own kind of op', () => {
        const tree = new Group3D({
            children: [
                new Camera3D({ fov: 45 }),
                new AmbientLight3D({ intensity: 0.4 }),
                new Fog3D({ color: '#0b0d12', near: 5, far: 30 }),
                new Box3D({ width: 2 }),
            ],
        });

        const scene = new Scene3D();
        tree.render(scene);

        expect(scene.ops().filter((o) => o.kind === 'camera')).toHaveLength(1);
        expect(scene.ops().filter((o) => o.kind === 'light')).toHaveLength(1);
        expect(scene.cameraDescriptor()).toMatchObject({ type: 'perspective', fov: 45 });
        // `color` is a resolved attribute, so it arrives normalized — the same form
        // `Mesh3D.color` takes, and what the backend's `writeColor` reads.
        expect(scene.fogDescriptor()).toEqual({
            color: parseColor('#0b0d12'), near: 5, far: 30,
        });
    });

    it('carries a node\'s transform onto its group, so a rig moves its contents', () => {
        const rig = new Group3D({ position: [1, 2, 3] });
        const [push] = record(rig);

        expect(push).toMatchObject({
            kind: 'push',
            transform: { position: { x: 1, y: 2, z: 3 } },
        });
    });

    // A camera nested in a moving group must be carried by it. The scene records
    // the camera *inside* the group's push/pop and lets the renderer compose the
    // world matrix, rather than writing an absolute placement.
    it('records a nested camera inside its parent group\'s scope', () => {
        const camera = new Camera3D({ position: [0, 0, 5] });
        const rig = new Group3D({ position: [0, 10, 0], children: [camera] });

        const kinds = record(rig).map((o) => o.kind);
        const push = kinds.indexOf('push');
        const cameraAt = kinds.indexOf('camera');
        const pop = kinds.lastIndexOf('pop');

        expect(push).toBeLessThan(cameraAt);
        expect(cameraAt).toBeLessThan(pop);
    });

    it('an invisible node still records, so hiding does not rebuild its resources', () => {
        const box = new Box3D({ visible: false });
        const ops = record(box);

        expect(ops.map((o) => o.kind)).toEqual(['push', 'mesh', 'pop']);
        expect(ops[0]).toMatchObject({ transform: { visible: false } });
    });

    it('desugars material props onto the mesh the same way the builder does', () => {
        const [, mesh] = record(new Box3D({ width: 2, fill: 'red', roughness: 0.3 }));

        expect(mesh).toMatchObject({
            kind: 'mesh',
            geometry: { type: 'box', width: 2 },
            material: { type: 'standard', roughness: 0.3 },
        });
    });

    it('unlit selects a basic material, as the builder shorthand does', () => {
        const [, mesh] = record(new Box3D({ unlit: true }));
        expect(mesh).toMatchObject({ material: { type: 'basic' } });
    });
});

describe('Node3D animation', () => {
    it('interpolates position / scale rather than snapping', () => {
        const box = attached(new Box3D({ position: [0, 0, 0] }));
        const step = box._prepareStep({ position: [0, 10, 0] } as never, 1);

        step.seek(0.5);
        expect(box.position).toMatchObject({ x: 0, y: 5, z: 0 });

        step.seek(1);
        expect(box.position).toMatchObject({ x: 0, y: 10, z: 0 });
    });

    it('interpolates a Euler rotation per axis', () => {
        const rig = attached(new Group3D({ rotation: [0, 0, 0] }));
        const step = rig._prepareStep({ rotation: [0, 360, 0] } as never, 1);

        step.seek(0.25);
        expect(rig.rotation).toMatchObject({ x: 0, y: 90, z: 0 });
    });

    // `lookAt`, a camera's `target` and a light's `target` carried no tween, so a
    // `to` on them left the prop where it started with no error.
    it('interpolates lookAt, a camera target and a light target', () => {
        const box = attached(new Box3D({ lookAt: [0, 0, 0] }));
        const camera = attached(new Camera3D({ target: [0, 0, 0] }));
        const light = attached(new DirectionalLight3D({ target: [0, 0, 0] }));

        box._prepareStep({ lookAt: [0, 10, 0] } as never, 1).seek(0.5);
        camera._prepareStep({ target: [4, 0, 0] } as never, 1).seek(0.5);
        light._prepareStep({ target: [0, 0, 6] } as never, 1).seek(0.5);

        expect(box.lookAt).toMatchObject({ x: 0, y: 5, z: 0 });
        expect(camera.target).toMatchObject({ x: 2, y: 0, z: 0 });
        expect(light.target).toMatchObject({ x: 0, y: 0, z: 3 });
    });

    it('tweens an unset target from the origin, and holds an unset lookAt until the end', () => {
        const camera = attached(new Camera3D());
        const box = attached(new Box3D());

        camera._prepareStep({ target: [0, 8, 0] } as never, 1).seek(0.5);
        expect(camera.target).toMatchObject({ x: 0, y: 4, z: 0 });

        const step = box._prepareStep({ lookAt: [0, 8, 0] } as never, 1);
        step.seek(0.5);
        expect(box.lookAt).toBeUndefined();
        step.seek(1);
        expect(box.lookAt).toMatchObject({ x: 0, y: 8, z: 0 });
    });

    it('keeps an unset lookAt unset rather than aiming at the origin', () => {
        expect(new Box3D().lookAt).toBeUndefined();
        const box = new Box3D({ lookAt: () => undefined } as never);
        expect(box.lookAt).toBeUndefined();
    });

    it('broadcasts a scalar across all three axes', () => {
        expect(new Box3D({ position: 2 }).position).toMatchObject({ x: 2, y: 2, z: 2 });
        expect(new Box3D().scale).toMatchObject({ x: 1, y: 1, z: 1 });
    });
});

describe('Node3D vector sugar', () => {
    it('lets an axis stated in the same bag win over the vector, in the constructor', () => {
        const box = new Box3D({ position: [1, 2, 3], y: 9 });
        expect(box.position).toEqual({ x: 1, y: 9, z: 3 });

        const spun = new Box3D({ rotation: [10, 20, 30], rotationZ: 0 });
        expect(spun.rotation).toMatchObject({ x: 10, y: 20, z: 0 });

        const scaled = new Box3D({ scale: 2, scaleY: 5 });
        expect(scaled.scale).toEqual({ x: 2, y: 5, z: 2 });
    });

    it('lets an axis stated in the same set() call win over the vector', () => {
        const box = new Box3D();
        box.set({ position: [5, 6, 7], z: 0 } as never);
        expect(box.position).toEqual({ x: 5, y: 6, z: 0 });
    });

    it('lets an axis stated in a to() target win over the vector', () => {
        const box = attached(new Box3D());
        const step = box._prepareStep({ position: [0, 10, 0], y: 4 } as never, 1);
        step.seek(1);
        expect(box.position).toEqual({ x: 0, y: 4, z: 0 });
    });

    it('does not leave the vector behind as a prop of its own', () => {
        const box = new Box3D({ position: [1, 2, 3] });
        box.set({ position: [4, 5, 6] } as never);
        // The getter composes the axes; there is no separate slot to disagree with them.
        expect(box.position).toEqual({ x: 4, y: 5, z: 6 });
        expect(box.x).toBe(4);
    });

    it('tweens position and the three axis spellings identically', () => {
        const viaVector = attached(new Box3D());
        const viaAxes = attached(new Box3D());
        viaVector._prepareStep({ position: [4, 8, 12] } as never, 1).seek(0.25);
        viaAxes._prepareStep({ x: 4, y: 8, z: 12 } as never, 1).seek(0.25);
        expect(viaVector.position).toEqual(viaAxes.position);
        expect(viaVector.position).toEqual({ x: 1, y: 2, z: 3 });
    });

    it('turns a bound position into three bindings that each read one component', () => {
        let lift = 1;
        const box = attached(new Box3D({ position: () => [10, lift, 30] } as never));
        expect(box.position).toEqual({ x: 10, y: 1, z: 30 });
        lift = 5;
        expect(box.position).toEqual({ x: 10, y: 5, z: 30 });
    });

    it('lets an explicit axis beside a bound vector keep its own value', () => {
        const box = attached(new Box3D({ position: () => [10, 20, 30], y: 2 } as never));
        expect(box.position).toEqual({ x: 10, y: 2, z: 30 });
    });

    it('sets rotationOrder from the order carried by a rotation', () => {
        expect(new Box3D({ rotation: { x: 1, y: 2, z: 3, order: 'ZYX' } }).rotationOrder).toBe('ZYX');
        const box = new Box3D();
        box.set({ rotation: { x: 0, y: 0, z: 0, order: 'YXZ' } } as never);
        expect(box.rotationOrder).toBe('YXZ');
        expect(box.rotation.order).toBe('YXZ');
    });

    it('lets an explicit rotationOrder win over the order inside the rotation', () => {
        const box = new Box3D({ rotation: { x: 1, y: 2, z: 3, order: 'ZYX' }, rotationOrder: 'YXZ' });
        expect(box.rotationOrder).toBe('YXZ');
    });

    it('leaves the rotation order alone for a plain vector', () => {
        const box = new Box3D({ rotationOrder: 'ZXY' });
        box.set({ rotation: [10, 0, 0] } as never);
        expect(box.rotationOrder).toBe('ZXY');
    });

    it('defaults to XYZ order, identity scale, the origin and no rotation', () => {
        const box = new Box3D();
        expect(box.position).toEqual({ x: 0, y: 0, z: 0 });
        expect(box.rotation).toEqual({ x: 0, y: 0, z: 0, order: 'XYZ' });
        expect(box.scale).toEqual({ x: 1, y: 1, z: 1 });
    });

    it('tweens a quaternion by shortest-arc slerp, staying on the unit sphere', () => {
        const box = attached(new Box3D());
        const half = Math.SQRT1_2;
        const step = box._prepareStep({ quaternion: { x: 0, y: half, z: 0, w: half } } as never, 1);

        step.seek(0.5);
        const q = box.quaternion as unknown as { x: number; y: number; z: number; w: number };
        expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
        // Halfway between identity and a quarter turn about Y is an eighth of a turn.
        const eighth = Math.PI / 8;
        expect(q.y).toBeCloseTo(Math.sin(eighth), 9);
        expect(q.w).toBeCloseTo(Math.cos(eighth), 9);

        step.seek(1);
        expect(box.quaternion).toMatchObject({ x: 0, y: expect.closeTo(half, 9), z: 0, w: expect.closeTo(half, 9) });
    });
});

describe('mixing the two trees', () => {
    it('a Node2D refuses a Node3D child, and vice versa', () => {
        expect(() => new Rect({ children: [new Box3D()] as never })).toThrow(/Canvas3D/);
        expect(() => new Group3D({ children: [new Rect({})] as never })).toThrow(/Canvas3D/);
        expect(() => new Rect({}).add(new Box3D() as never)).toThrow(/cannot hold/);
    });

    it('Canvas3D accepts both and partitions them', () => {
        const box = new Box3D();
        const label = new Text({ text: 'FPS 60' });
        const canvas = new Canvas3D({ children: [box, label] });

        expect(children3D(canvas)).toEqual([box]);
        // `children` is the 2D tree — the HUD, not the scene.
        expect(canvas.children).toEqual([label]);
        expect(canvas.dimension).toBe('2d');
        expect(box.dimension).toBe('3d');
    });

    it('keeps a 3D child out of layout entirely', () => {
        const label = new Text({ text: 'hud' });
        const canvas = new Canvas3D({ children: [new Box3D(), label] });

        // flowChildren drives every measure and layout pass.
        expect(canvas.flowChildren()).toEqual([label]);
        expect(canvas.flowChildren().every((c) => c instanceof Node2D)).toBe(true);
    });

    it('records only the 3D children into the scene', () => {
        const canvas = new Canvas3D({
            children: [new AmbientLight3D(), new Box3D(), new Text({ text: 'hud' })],
        });

        const scene = new Scene3D();
        for (const child of children3D(canvas)) child.render(scene);

        expect(scene.ops().filter((o) => o.kind === 'light')).toHaveLength(1);
        expect(scene.ops().filter((o) => o.kind === 'mesh')).toHaveLength(1);
    });

    it('a Canvas3D with no 3D children builds an empty scene, with no default camera or rig', () => {
        const canvas = new Canvas3D({ children: [new Text({ text: 'hud' })] });
        const scene = canvas._scene3D();
        expect(scene.isEmpty()).toBe(true);
        expect(scene.ops()).toEqual([]);
        expect(scene.cameraDescriptor()).toBeNull();
    });

    it('a Canvas3D with a 3D child still gets the default camera and rig', () => {
        const scene = new Canvas3D({ children: [new Box3D()] })._scene3D();
        expect(scene.isEmpty()).toBe(false);
        expect(scene.cameraDescriptor()).not.toBeNull();
        expect(scene.ops().filter((o) => o.kind === 'light')).toHaveLength(3);
    });

    it('a Canvas3D with no 3D children still draws its grid when asked to', () => {
        const scene = new Canvas3D({ showGrid: true })._scene3D();
        expect(scene.isEmpty()).toBe(false);
        expect(scene.cameraDescriptor()).not.toBeNull();
    });

    it('shares the whole node vocabulary across both trees', () => {
        const rig = new Group3D({ children: [new DirectionalLight3D({ intensity: 2 })] });

        // Same tree API, same props, same save/restore — inherited from `Node`.
        expect(rig.children).toHaveLength(1);
        expect(typeof rig.to).toBe('function');
        expect(typeof rig.save).toBe('function');
        rig.set({ position: [0, 5, 0] } as never);
        expect(rig.position).toMatchObject({ x: 0, y: 5, z: 0 });
    });
});
