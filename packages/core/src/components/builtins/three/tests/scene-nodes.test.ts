import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scene3D, type Scene3DOp } from '@/render3d/scene3d';
import { resetInertWarnings3D } from '@/render3d/inert';
import { Node3D } from '@/components/trees/three/node3d';
import { Group3D, Box3D } from "@/components/builtins/three/three";
import { SceneCamera, SceneEnvironment, SceneFog } from "@/components/builtins/three/tests/scene-wide.fixtures";
import type { AssetScope } from '@/assets/scope';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    resetInertWarnings3D();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => warn.mockRestore());

const sceneOf = (node: Node3D<never> | Node3D): Scene3D => {
    const scene = new Scene3D();
    node.render(scene);
    return scene;
};
const opsOf = (node: Node3D<never> | Node3D): readonly Scene3DOp[] => sceneOf(node).ops();

/** An AssetScope that records every declaration. */
function recordingScope() {
    const declared: string[] = [];
    const scope = {
        image: (src: string) => declared.push(`image:${src}`),
        subtree: () => declared.push('subtree'),
        loader: (key: string) => declared.push(`loader:${key}`),
    } as unknown as AssetScope;
    return { scope, declared };
}

describe("a component that sets the scene's camera, fog or environment", () => {
    const cameraOp = (camera: SceneCamera) => {
        const op = opsOf(camera).find((o) => o.kind === 'camera');
        if (op?.kind !== 'camera') throw new Error('no camera recorded');
        return op.camera;
    };

    it('records its placement on the camera descriptor and keeps its group at identity', () => {
        const camera = new SceneCamera({ position: [0, 0, 9], lookAt: [0, 1, 0] });
        const [push] = opsOf(camera);
        // Identity: nothing of the placement is on the group, or the shot would face backwards.
        expect(push).toEqual({ kind: 'push', transform: { key: camera.id } });
        expect(cameraOp(camera)).toMatchObject({
            position: { x: 0, y: 0, z: 9 },
            lookAt: { x: 0, y: 1, z: 0 },
        });
    });

    it('keeps the last camera when a tree declares several', () => {
        const scene = new Scene3D();
        new Group3D({ children: [new SceneCamera({ fov: 20 }), new SceneCamera({ fov: 80 })] }).render(scene);
        expect(scene.ops().filter((o) => o.kind === 'camera')).toHaveLength(2);
        expect(scene.cameraDescriptor()).toMatchObject({ fov: 80 });
    });

    it("is carried by a moving rig: its camera records inside the parent's scope", () => {
        const rig = new Group3D({ position: [0, 10, 0], children: [new SceneCamera({ fov: 30 })] });
        const kinds = opsOf(rig).map((o) => o.kind);
        expect(kinds).toEqual(['push', 'push', 'camera', 'pop', 'pop']);
    });

    it('takes the last fog in the tree', () => {
        const scene = new Scene3D();
        new Group3D({ children: [new SceneFog({ near: 1, far: 2 }), new SceneFog({ near: 3, far: 4 })] }).render(scene);
        expect(scene.fogDescriptor()).toEqual({ near: 3, far: 4 });
    });

    it('clears an environment an earlier node set, when it sets null', () => {
        const scene = new Scene3D();
        new Group3D({ children: [new SceneEnvironment({ preset: 'studio' }), new SceneEnvironment()] }).render(scene);
        expect(scene.environmentDescriptor()).toBeNull();
    });

    it('declares nothing for a preset environment', () => {
        const { scope, declared } = recordingScope();
        (new SceneEnvironment({ preset: 'studio' }) as Node3D).declareAssets(scope);
        expect(declared).toEqual([]);
    });

    it("declares its environment's src and faces as loaders once a backend has registered one", async () => {
        vi.resetModules();
        const resources = await import('@/render3d/resources');
        const { SceneEnvironment: Fresh } = await import('@/components/builtins/three/tests/scene-wide.fixtures');
        resources.registerCanvas3DResourceLoader(async () => () => { });
        const { scope, declared } = recordingScope();
        (new Fresh({ src: '/sky.hdr', faces: ['/px.exr'] }) as Node3D).declareAssets(scope);
        // A scope keeps one declaration per key, however often it is told.
        expect([...new Set(declared)]).toEqual(['loader:three:hdr:/sky.hdr', 'loader:three:exr:/px.exr']);
    });
});

describe('Node3D rendering', () => {
    it('opens an empty invisible scope for a hidden node and records neither itself nor its children', () => {
        class Marker extends Node3D {
            rendered = 0;
            protected override renderSelf(): void { this.rendered++; }
        }
        const child = new Marker();
        const hidden = new Marker({ position: [1, 2, 3], children: [child] } as never);
        hidden._setEditorState(true, false);

        const ops = opsOf(hidden);
        expect(ops.map((o) => o.kind)).toEqual(['push', 'pop']);
        expect(ops[0]).toMatchObject({
            kind: 'push',
            transform: { visible: false, position: { x: 1, y: 2, z: 3 }, key: hidden.id },
        });
        expect(hidden.rendered).toBe(0);
        expect(child.rendered).toBe(0);
    });

    it('still records everything for a node that is visible: false, unlike a hidden one', () => {
        const box = new Box3D({ visible: false });
        expect(opsOf(box).map((o) => o.kind)).toEqual(['push', 'mesh', 'pop']);
    });

    it('omits the quaternion from the group transform while it is the identity, so rotation applies', () => {
        const [push] = opsOf(new Group3D({ rotation: [0, 45, 0] }));
        expect(push).toMatchObject({ transform: { rotation: { y: 45 } } });
        expect(push.kind === 'push' && push.transform?.quaternion).toBeUndefined();
    });

    it('includes the quaternion once it moves off the identity', () => {
        const q = { x: 0, y: 1, z: 0, w: 0 };
        const [push] = opsOf(new Group3D({ quaternion: q }));
        expect(push.kind === 'push' && push.transform?.quaternion).toEqual(q);
    });

    it('reports lookAt as undefined until it is set', () => {
        expect(opsOf(new Group3D())[0]).toMatchObject({ transform: { lookAt: undefined } });
        expect(opsOf(new Group3D({ lookAt: [0, 0, 0] }))[0]).toMatchObject({ transform: { lookAt: { x: 0, y: 0, z: 0 } } });
    });
});

describe('Node3D declareAssets', () => {
    it('declares nothing when renderSelf is not overridden', () => {
        const { scope, declared } = recordingScope();
        new Group3D({ position: [1, 1, 1] }).declareAssets(scope);
        expect(declared).toEqual([]);
    });

    it('records renderSelf, not render, so a node declares what it draws regardless of its placement', () => {
        const at = (position: [number, number, number]) => {
            const { scope, declared } = recordingScope();
            new Box3D({ fill: '/wood.png', position }).declareAssets(scope);
            return declared;
        };
        expect(at([0, 0, 0])).toEqual(['image:/wood.png']);
        expect(at([9, 9, 9])).toEqual(at([0, 0, 0]));
    });

    it('does not declare the children, which declare themselves', () => {
        const { scope, declared } = recordingScope();
        new Group3D({ children: [new Box3D({ fill: '/wood.png' })] }).declareAssets(scope);
        expect(declared).toEqual([]);
    });
});
