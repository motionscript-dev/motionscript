import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scene3D, type Scene3DOp } from '@/render3d/scene3d';
import { resetInertWarnings3D } from '@/render3d/inert';
import { Node3D } from '@/components/trees/three/node3d';
import { Group3D, Box3D, AmbientLight3D, AreaLight3D, DirectionalLight3D, HemisphereLight3D, PointLight3D, SpotLight3D, Camera3D, Environment3D, Fog3D } from "@/components/builtins/three/three";
import { shadowCasts, resolveShadowOptions3D } from '@/render3d/transform';
import { parseColor } from '@/attributes/shape/fill/color/parser';
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
const lightOf = (node: Node3D<never> | Node3D) => {
    const op = opsOf(node).find((o) => o.kind === 'light');
    if (op?.kind !== 'light') throw new Error('no light recorded');
    return op;
};

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

describe('light nodes', () => {
    it('each records exactly one light op, nested in its own group', () => {
        for (const node of [
            new AmbientLight3D(), new HemisphereLight3D(), new DirectionalLight3D(),
            new PointLight3D(), new SpotLight3D(), new AreaLight3D(),
        ]) {
            expect(opsOf(node).map((o) => o.kind), node.constructor.name).toEqual(['push', 'light', 'pop']);
        }
    });

    it('records only the fields that are set, under the matching type', () => {
        expect(lightOf(new AmbientLight3D()).light).toEqual({ type: 'ambient' });
        expect(lightOf(new AmbientLight3D({ intensity: 0.4, color: '#ff0000' })).light)
            .toEqual({ type: 'ambient', intensity: 0.4, color: parseColor('#ff0000') });
        expect(lightOf(new AreaLight3D({ width: 4, height: 2, intensity: 5 })).light)
            .toEqual({ type: 'area', width: 4, height: 2, intensity: 5 });
    });

    it('uses sky and ground for the hemisphere light', () => {
        expect(lightOf(new HemisphereLight3D({ sky: '#ffffff', ground: '#000000', intensity: 1 })).light).toEqual({
            type: 'hemisphere', sky: parseColor('#ffffff'), ground: parseColor('#000000'), intensity: 1,
        });
    });

    it('records the aim and reach of directional, point and spot lights', () => {
        expect(lightOf(new DirectionalLight3D({ target: [0, 1, 0], intensity: 2 })).light)
            .toMatchObject({ type: 'directional', intensity: 2, target: { x: 0, y: 1, z: 0 } });
        expect(lightOf(new PointLight3D({ distance: 10, decay: 2 })).light)
            .toMatchObject({ type: 'point', distance: 10, decay: 2 });
        expect(lightOf(new SpotLight3D({ angle: 30, penumbra: 0.5, target: [1, 0, 0] })).light)
            .toMatchObject({ type: 'spot', angle: 30, penumbra: 0.5, target: { x: 1, y: 0, z: 0 } });
    });

    it('defaults the shadow of directional, point and spot lights to off, unlike every other Node3D', () => {
        expect(new Box3D().shadow).toBe(true);
        for (const node of [new DirectionalLight3D(), new PointLight3D(), new SpotLight3D()]) {
            expect(node.shadow, node.constructor.name).toBe(false);
            const { light } = lightOf(node);
            expect('shadow' in light && light.shadow).toBe(false);
            expect(resolveShadowOptions3D('shadow' in light ? light.shadow : undefined)).toBeNull();
        }
    });

    it('keeps a shadow the author states, true, an object or an explicit false', () => {
        const shadowOf = (node: DirectionalLight3D) => {
            const { light } = lightOf(node);
            return 'shadow' in light ? light.shadow : undefined;
        };
        expect(shadowOf(new DirectionalLight3D({ shadow: true }))).toBe(true);
        expect(shadowOf(new DirectionalLight3D({ shadow: false }))).toBe(false);
        const tuned = { softness: 0.8, extent: 12 };
        expect(shadowOf(new DirectionalLight3D({ shadow: tuned }))).toBe(tuned);
        expect(shadowCasts(shadowOf(new DirectionalLight3D({ shadow: tuned })))).toBe(true);
    });

    it('gives ambient, hemisphere and area lights no shadow field at all', () => {
        for (const node of [new AmbientLight3D(), new HemisphereLight3D(), new AreaLight3D()]) {
            expect('shadow' in lightOf(node).light, node.constructor.name).toBe(false);
        }
    });

    it('carries the light node\'s placement on its group scope', () => {
        const [push] = opsOf(new PointLight3D({ position: [1, 2, 3] }));
        expect(push).toMatchObject({ kind: 'push', transform: { position: { x: 1, y: 2, z: 3 } } });
    });

    it('declares no assets', () => {
        for (const node of [new AmbientLight3D(), new PointLight3D({ position: [1, 1, 1] }), new AreaLight3D()]) {
            const { scope, declared } = recordingScope();
            (node as Node3D).declareAssets(scope);
            expect(declared).toEqual([]);
        }
    });
});

describe('Camera3D', () => {
    const cameraOp = (camera: Camera3D) => {
        const op = opsOf(camera).find((o) => o.kind === 'camera');
        if (op?.kind !== 'camera') throw new Error('no camera recorded');
        return op.camera;
    };

    it('defaults to a perspective camera and records only the fields that are set', () => {
        expect(new Camera3D().type).toBe('perspective');
        const camera = cameraOp(new Camera3D({ fov: 42, orbit: -18, elevation: 12, distance: 13 }));
        expect(camera).toMatchObject({ type: 'perspective', fov: 42, orbit: -18, elevation: 12, distance: 13 });
        expect(camera).not.toHaveProperty('near');
        expect(camera).not.toHaveProperty('far');
        expect(camera).not.toHaveProperty('frustumHeight');
        expect(camera).not.toHaveProperty('zoom');
    });

    it('switches projection with the type prop', () => {
        expect(cameraOp(new Camera3D({ type: 'orthographic', frustumHeight: 6 })))
            .toMatchObject({ type: 'orthographic', frustumHeight: 6 });
    });

    it('records its placement on the camera descriptor and keeps its group at identity', () => {
        const camera = new Camera3D({ position: [0, 0, 9], lookAt: [0, 1, 0] });
        const [push] = opsOf(camera);
        // Identity: nothing of the placement is on the group, or the shot would face backwards.
        expect(push).toEqual({ kind: 'push', transform: { key: camera.id } });
        expect(cameraOp(camera)).toMatchObject({
            position: { x: 0, y: 0, z: 9 },
            lookAt: { x: 0, y: 1, z: 0 },
        });
    });

    it('records a target and tweens an unset one from the origin', () => {
        expect(cameraOp(new Camera3D({ target: [1, 2, 3] }))).toMatchObject({ target: { x: 1, y: 2, z: 3 } });
        expect(cameraOp(new Camera3D())).not.toHaveProperty('target');
    });

    it('keeps the last camera when a tree declares several', () => {
        const scene = new Scene3D();
        new Group3D({ children: [new Camera3D({ fov: 20 }), new Camera3D({ fov: 80 })] }).render(scene);
        expect(scene.ops().filter((o) => o.kind === 'camera')).toHaveLength(2);
        expect(scene.cameraDescriptor()).toMatchObject({ fov: 80 });
    });

    it('is carried by a moving rig: it records inside the parent\'s scope', () => {
        const rig = new Group3D({ position: [0, 10, 0], children: [new Camera3D({ fov: 30 })] });
        const kinds = opsOf(rig).map((o) => o.kind);
        expect(kinds).toEqual(['push', 'push', 'camera', 'pop', 'pop']);
    });

    it('declares no assets', () => {
        const { scope, declared } = recordingScope();
        new Camera3D({ orbit: 10 }).declareAssets(scope);
        expect(declared).toEqual([]);
    });
});

describe('Fog3D', () => {
    const fogOf = (fog: Fog3D) => sceneOf(fog).fogDescriptor();

    it('records nothing but an empty descriptor when no field is set', () => {
        expect(fogOf(new Fog3D())).toEqual({});
    });

    it('records linear fog from near and far', () => {
        expect(fogOf(new Fog3D({ near: 5, far: 30 }))).toEqual({ near: 5, far: 30 });
    });

    it('records the colour when set, normalized', () => {
        expect(fogOf(new Fog3D({ color: '#0b0d12', near: 1, far: 9 })))
            .toEqual({ color: parseColor('#0b0d12'), near: 1, far: 9 });
    });

    it('lets density win, dropping near and far, because the two kinds exclude each other', () => {
        expect(fogOf(new Fog3D({ density: 0.05, near: 5, far: 30 }))).toEqual({ density: 0.05 });
    });

    it('keeps a density of zero rather than falling back to linear fog', () => {
        expect(fogOf(new Fog3D({ density: 0, near: 5, far: 30 }))).toEqual({ density: 0 });
    });

    it('takes the last fog in the tree', () => {
        const scene = new Scene3D();
        new Group3D({ children: [new Fog3D({ near: 1, far: 2 }), new Fog3D({ near: 3, far: 4 })] }).render(scene);
        expect(scene.fogDescriptor()).toEqual({ near: 3, far: 4 });
    });

    it('declares no assets', () => {
        const { scope, declared } = recordingScope();
        new Fog3D({ color: '#fff' }).declareAssets(scope);
        expect(declared).toEqual([]);
    });
});

describe('Environment3D', () => {
    const environmentOf = (node: Environment3D) => sceneOf(node).environmentDescriptor();

    it('records null when it names no source, which clears the scene\'s environment', () => {
        expect(environmentOf(new Environment3D())).toBeNull();
        // Fields beside the source are not enough on their own.
        expect(environmentOf(new Environment3D({ intensity: 2, background: true, blur: 0.5 }))).toBeNull();
    });

    it('clears an environment an earlier node set, when it names nothing', () => {
        const scene = new Scene3D();
        new Group3D({ children: [new Environment3D({ preset: 'studio' }), new Environment3D()] }).render(scene);
        expect(scene.environmentDescriptor()).toBeNull();
    });

    it('records a preset, a src or faces, with the optional fields only when set', () => {
        expect(environmentOf(new Environment3D({ preset: 'studio' }))).toEqual({ preset: 'studio' });
        expect(environmentOf(new Environment3D({ src: '/sky.hdr', intensity: 0.8, background: true, blur: 0.4 })))
            .toEqual({ src: '/sky.hdr', intensity: 0.8, background: true, blur: 0.4 });
        const faces = ['a', 'b', 'c', 'd', 'e', 'f'];
        expect(environmentOf(new Environment3D({ faces }))).toEqual({ faces });
    });

    it('keeps a background of false rather than omitting it', () => {
        expect(environmentOf(new Environment3D({ preset: 'studio', background: false })))
            .toEqual({ preset: 'studio', background: false });
    });

    it('orients the panorama by the node\'s rotation, only when one axis is non-zero', () => {
        expect(environmentOf(new Environment3D({ preset: 'studio' }))).not.toHaveProperty('rotation');
        expect(environmentOf(new Environment3D({ preset: 'studio', rotation: [0, 90, 0] })))
            .toMatchObject({ rotation: [0, 90, 0] });
        expect(environmentOf(new Environment3D({ preset: 'studio', rotationZ: 15 })))
            .toMatchObject({ rotation: [0, 0, 15] });
    });

    it('reads no position: moving it changes nothing it records', () => {
        const at = (position: [number, number, number]) =>
            environmentOf(new Environment3D({ preset: 'studio', position }));
        expect(at([5, 5, 5])).toEqual(at([0, 0, 0]));
    });

    it('declares from src and faces only: a preset, a rotation and an intensity declare nothing', () => {
        const { scope, declared } = recordingScope();
        new Environment3D({ preset: 'studio', rotationY: 45, intensity: 3 }).declareAssets(scope);
        expect(declared).toEqual([]);
    });

    it('declares its src and faces as loaders once a backend has registered one', async () => {
        vi.resetModules();
        const resources = await import('@/render3d/resources');
        const { Environment3D: Fresh } = await import('@/components/builtins/three/three');
        resources.registerCanvas3DResourceLoader(async () => () => { });
        const { scope, declared } = recordingScope();
        new Fresh({ src: '/sky.hdr', faces: ['/px.exr'] }).declareAssets(scope);
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
