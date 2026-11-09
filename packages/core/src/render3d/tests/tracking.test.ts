import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetScope } from '@/assets/scope';
import type { LoaderFn } from '@/assets/record';
import { Graphics2D } from '@/render/graphics2d';
import { Rect } from "@/components/builtins/geometry/geometry";
import { Graphics3D } from '@/render3d/graphics3d';
import { Scene3D } from '@/render3d/scene3d';
import { declare3DResources as declareStatic } from '@/render3d/tracking';
import { Geo, Mat, Tex } from '@/render3d/builders';
import {
    canvas3DResourceKey, parseCanvas3DResourceKey,
    type Canvas3DResourceKind,
} from '@/render3d/resources';

/** What a recording scope was asked to declare, in call order. */
interface Recorded {
    images: string[];
    subtrees: unknown[];
    loaders: { key: string; load: LoaderFn }[];
}

function recordingScope(): { scope: AssetScope; recorded: Recorded } {
    const recorded: Recorded = { images: [], subtrees: [], loaders: [] };
    const scope = {
        image: (src: string) => { recorded.images.push(src); },
        subtree: (node: unknown) => { recorded.subtrees.push(node); },
        loader: (key: string, load: LoaderFn) => { recorded.loaders.push({ key, load }); },
    } as unknown as AssetScope;
    return { scope, recorded };
}

// `declareStatic` is the statically imported `declare3DResources`, used by the cases
// that need no backend loader; the loader cases below take a fresh module set.

/**
 * Each test gets a fresh `resources` module, because the backend loader is
 * module state that cannot be unregistered.
 */
async function fresh() {
    vi.resetModules();
    const tracking = await import('@/render3d/tracking');
    const resources = await import('@/render3d/resources');
    const scene3d = await import('@/render3d/scene3d');
    const graphics3d = await import('@/render3d/graphics3d');
    return { ...tracking, ...resources, Scene3D: scene3d.Scene3D, Graphics3D: graphics3d.Graphics3D };
}

describe('declare3DResources: surface textures', () => {
    it('declares a Node2D surface source as a subtree of the declaring node', () => {
        const source = new Rect({ width: 20, height: 20 });
        const { scope, recorded } = recordingScope();
        const g3 = new Graphics3D().plane({ fill: Tex.surface(source, { width: 8, height: 8 }) });

        declareStatic(g3, scope);

        expect(recorded.subtrees).toEqual([source]);
        expect(recorded.images).toEqual([]);
    });

    it('declares nothing for a Graphics2D surface source', () => {
        const { scope, recorded } = recordingScope();
        const g3 = new Graphics3D().plane({ fill: Tex.surface(new Graphics2D(), { width: 8, height: 8 }) });

        declareStatic(g3, scope);

        expect(recorded).toEqual({ images: [], subtrees: [], loaders: [] });
    });

    it('declares both a surface node and an image map on the same mesh', () => {
        const source = new Rect({ width: 20, height: 20 });
        const { scope, recorded } = recordingScope();
        const g3 = new Graphics3D().plane({
            material: Mat.standard({
                map: Tex.surface(source, { width: 8, height: 8 }),
                normalMap: '/normal.png',
            }),
        });

        declareStatic(g3, scope);

        expect(recorded.subtrees).toEqual([source]);
        expect(recorded.images).toEqual(['/normal.png']);
    });

    it('declares nothing for a data texture', () => {
        const { scope, recorded } = recordingScope();
        const g3 = new Graphics3D().plane({
            material: Mat.standard({ map: { data: new Uint8Array(4), width: 1, height: 1 } }),
        });

        declareStatic(g3, scope);

        expect(recorded).toEqual({ images: [], subtrees: [], loaders: [] });
    });

    it('reaches a surface node on a scene, not only on a drawable list', () => {
        const source = new Rect({ width: 20, height: 20 });
        const { scope, recorded } = recordingScope();
        const scene = new Scene3D().draw(
            new Graphics3D().plane({ fill: Tex.surface(source, { width: 8, height: 8 }) }),
        );

        declareStatic(scene, scope);

        expect(recorded.subtrees).toEqual([source]);
    });
});

describe('declare3DResources: loaders', () => {
    beforeEach(() => vi.resetModules());

    it('declares no loader while no backend has registered one', async () => {
        const { declare3DResources, Graphics3D } = await fresh();
        const { scope, recorded } = recordingScope();

        declare3DResources(new Graphics3D().model({ src: '/crate.glb' }), scope);

        expect(recorded.loaders).toEqual([]);
    });

    it('declares a model op as a gltf loader keyed by the shared key', async () => {
        const { declare3DResources, registerCanvas3DResourceLoader, Graphics3D } = await fresh();
        const load = vi.fn(async () => () => { });
        registerCanvas3DResourceLoader(load);
        const { scope, recorded } = recordingScope();

        declare3DResources(new Graphics3D().model({ src: '/crate.glb' }), scope);

        expect(recorded.loaders.map((l) => l.key)).toEqual(['three:gltf:/crate.glb']);
        // The declared function drives the backend loader with the kind and src.
        void recorded.loaders[0].load();
        expect(load).toHaveBeenCalledWith('gltf', '/crate.glb');
    });

    it('declares a modelGeometry on a mesh, a line, points and instances', async () => {
        const { declare3DResources, registerCanvas3DResourceLoader, Graphics3D } = await fresh();
        registerCanvas3DResourceLoader(async () => () => { });
        const { scope, recorded } = recordingScope();
        const geometry = (src: string) => ({ type: 'modelGeometry' as const, src });

        declare3DResources(
            new Graphics3D()
                .mesh(geometry('/a.glb'), Mat.standard())
                .line({ geometry: geometry('/b.glb') })
                .points(geometry('/c.glb'))
                .instances(geometry('/d.glb'), Mat.standard(), [{ position: [0, 0, 0] }]),
            scope,
        );

        expect(recorded.loaders.map((l) => l.key)).toEqual([
            'three:gltf:/a.glb', 'three:gltf:/b.glb', 'three:gltf:/c.glb', 'three:gltf:/d.glb',
        ]);
    });

    it('looks through edges and wireframe to the model geometry they derive from', async () => {
        const { declare3DResources, registerCanvas3DResourceLoader, Graphics3D } = await fresh();
        registerCanvas3DResourceLoader(async () => () => { });
        const { scope, recorded } = recordingScope();

        declare3DResources(
            new Graphics3D()
                .mesh(Geo.edges(Geo.model('/a.glb')), Mat.standard())
                .mesh(Geo.wireframe(Geo.wireframe(Geo.model('/b.glb'))), Mat.standard())
                .mesh(Geo.edges(Geo.box()), Mat.standard()),
            scope,
        );

        // A plain box under an edges wrapper needs nothing.
        expect(recorded.loaders.map((l) => l.key)).toEqual(['three:gltf:/a.glb', 'three:gltf:/b.glb']);
    });

    it('hands the scope the same function each time a key is declared, so the conflicting-loader check stays quiet', async () => {
        const { declare3DResources, registerCanvas3DResourceLoader, Graphics3D } = await fresh();
        registerCanvas3DResourceLoader(async () => () => { });
        const { scope, recorded } = recordingScope();

        declare3DResources(new Graphics3D().model({ src: '/crate.glb' }).model({ src: '/crate.glb' }), scope);
        declare3DResources(new Graphics3D().model({ src: '/crate.glb' }), scope);

        expect(recorded.loaders).toHaveLength(3);
        expect(new Set(recorded.loaders.map((l) => l.load)).size).toBe(1);
    });

    it('declares a scene environment src as hdr, a .EXR as exr, and each cube face by extension', async () => {
        const { declare3DResources, registerCanvas3DResourceLoader, Scene3D } = await fresh();
        registerCanvas3DResourceLoader(async () => () => { });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        try {
            const keys = (environment: Parameters<InstanceType<typeof Scene3D>['environment']>[0]) => {
                const { scope, recorded } = recordingScope();
                declare3DResources(new Scene3D().environment(environment), scope);
                return recorded.loaders.map((l) => l.key);
            };

            expect(keys({ src: '/sky.hdr' })).toEqual(['three:hdr:/sky.hdr']);
            expect(keys({ src: '/sky.EXR' })).toEqual(['three:exr:/sky.EXR']);
            expect(keys({ faces: ['/px.exr', '/nx.hdr', '/py.png', '/ny.png', '/pz.png', '/nz.png'] })).toEqual([
                'three:exr:/px.exr', 'three:hdr:/nx.hdr', 'three:hdr:/py.png',
                'three:hdr:/ny.png', 'three:hdr:/pz.png', 'three:hdr:/nz.png',
            ]);
        } finally {
            warn.mockRestore();
        }
    });

    it('declares nothing for a preset environment or a scene without one', async () => {
        const { declare3DResources, registerCanvas3DResourceLoader, Scene3D } = await fresh();
        registerCanvas3DResourceLoader(async () => () => { });
        const { scope, recorded } = recordingScope();

        declare3DResources(new Scene3D().environment({ preset: 'studio' }), scope);
        declare3DResources(new Scene3D(), scope);

        expect(recorded.loaders).toEqual([]);
    });

    it('does not read an environment off a bare drawable list', async () => {
        const { declare3DResources, registerCanvas3DResourceLoader, Graphics3D } = await fresh();
        registerCanvas3DResourceLoader(async () => () => { });
        const { scope, recorded } = recordingScope();

        declare3DResources(new Graphics3D().box(), scope);

        expect(recorded.loaders).toEqual([]);
    });
});

describe('declareEnvironment', () => {
    it('does nothing for a null environment', async () => {
        const { declareEnvironment, registerCanvas3DResourceLoader } = await fresh();
        registerCanvas3DResourceLoader(async () => () => { });
        const { scope, recorded } = recordingScope();

        declareEnvironment(null, scope);

        expect(recorded.loaders).toEqual([]);
    });

    it('declares a src and every face when both are present', async () => {
        const { declareEnvironment, registerCanvas3DResourceLoader } = await fresh();
        registerCanvas3DResourceLoader(async () => () => { });
        const { scope, recorded } = recordingScope();

        declareEnvironment({ src: '/a.hdr', faces: ['/b.exr'] }, scope);

        expect(recorded.loaders.map((l) => l.key)).toEqual(['three:hdr:/a.hdr', 'three:exr:/b.exr']);
    });
});

describe('canvas3DResourceKey / parseCanvas3DResourceKey', () => {
    it('builds three:<kind>:<src>', () => {
        expect(canvas3DResourceKey('gltf', '/crate.glb')).toBe('three:gltf:/crate.glb');
    });

    it('inverts the key for every kind', () => {
        const kinds: Canvas3DResourceKind[] = ['hdr', 'exr', 'gltf', 'obj', 'cubemap'];
        for (const kind of kinds) {
            expect(parseCanvas3DResourceKey(canvas3DResourceKey(kind, '/x/y.bin'))).toEqual({ kind, src: '/x/y.bin' });
        }
    });

    it('keeps the colons of a URL src whole by splitting on the first two separators only', () => {
        const src = 'https://cdn.example:8080/m.glb?a=b:c';
        expect(parseCanvas3DResourceKey(canvas3DResourceKey('gltf', src))).toEqual({ kind: 'gltf', src });
    });

    it('returns null for a string that is not a resource key', () => {
        expect(parseCanvas3DResourceKey('three:runtime')).toBeNull();
        expect(parseCanvas3DResourceKey('three::/a.glb')).toBeNull();
        expect(parseCanvas3DResourceKey('image:/a.png')).toBeNull();
        expect(parseCanvas3DResourceKey('')).toBeNull();
    });
});
