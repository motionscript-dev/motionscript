import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as component from '@/component';
import { Registry } from '@/document/registry';
import { Canvas3D } from '@/components/builtins/three/canvas3d';

/**
 * The 3D surface as each entry point exposes it: what is there, and what is
 * absent on purpose. A name moving between barrels changes what an author can
 * import, so each side of the line is pinned.
 *
 * The two barrels are loaded by a dynamic import with a non-literal specifier,
 * for the reason `sdk-parity.test.ts` gives: the lint rules forbid importing a
 * barrel from a non-barrel file, and what is under test here *is* the barrel.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rootUrl = pathToFileURL(resolve(here, '../index.ts')).href;
const sdkUrl = pathToFileURL(resolve(here, '../sdk/index.ts')).href;

let rootExports: Record<string, unknown>;
let sdkExports: Record<string, unknown>;
const componentExports = component as Record<string, unknown>;

beforeAll(async () => {
    rootExports = (await import(/* @vite-ignore */ rootUrl)) as Record<string, unknown>;
    sdkExports = (await import(/* @vite-ignore */ sdkUrl)) as Record<string, unknown>;
}, 60_000);

/** The curated subset `@motionscript/core/sdk` carries. */
const SDK_3D_VALUES = [
    'Canvas3D', 'Group3D', 'Mesh3D',
    'Box3D', 'Sphere3D', 'Plane3D', 'Cylinder3D', 'Cone3D', 'Torus3D', 'TorusKnot3D',
    'Circle3D', 'Ring3D', 'Capsule3D', 'Polyhedron3D', 'Extrude3D', 'Lathe3D', 'Tube3D',
    'Instances3D', 'Points3D', 'Line3D', 'Sprite3D', 'Model3D',
    'AmbientLight3D', 'HemisphereLight3D', 'DirectionalLight3D', 'PointLight3D', 'SpotLight3D', 'AreaLight3D',
    'Camera3D', 'Fog3D', 'Environment3D',
    'Graphics3D', 'Scene3D', 'RenderContext3D', 'Geo', 'Mat', 'Tex',
    'lerpVector3', 'lerpEuler3', 'slerpQuaternion', 'quaternionFromEuler', 'normalizeQuaternion',
    'resolveVector3', 'evaluateParametric', 'evaluateRoundedBox', 'resolveSurfaceSource',
    'resolveFill3D', 'segmentsOf', 'resolveCameraPlacement', 'resolveShadows3D',
    'shadowCasts', 'shadowReceives',
] as const;

/** Root-only: the sdk leaves these out. */
const ROOT_ONLY_VALUES = [
    'ModelView3D', 'vector3Ops', 'euler3Ops', 'quaternionOps', 'geometryBounds3D', 'isOrbitCamera3D',
] as const;

/** Exported from no barrel at all. */
const NO_BARREL_VALUES = [
    'lerpFill3D', 'declare3DResources', 'declareEnvironment',
    'quaternionProperty',
] as const;

/** The orbit-camera helpers and lerps: component entry point only. */
const COMPONENT_ONLY_VALUES = [
    'resolveColor3D', 'lerpColor3D', 'lerpFinite', 'lerpCount',
    'snapValue', 'snapFlag', 'cameraOrbit', 'orbitPosition', 'orbitProps',
] as const;

describe('3D names across the entry points', () => {
    it('the root resolves every name the sdk carries, as the same value', () => {
        for (const name of SDK_3D_VALUES) {
            expect(rootExports[name], `root.${name}`).toBeDefined();
            expect(sdkExports[name], `sdk.${name}`).toBe(rootExports[name]);
        }
    });

    it('the root has the names the sdk leaves out, and the sdk really lacks them', () => {
        for (const name of ROOT_ONLY_VALUES) {
            expect(rootExports[name], `root.${name}`).toBeDefined();
            expect(sdkExports[name], `sdk.${name}`).toBeUndefined();
        }
    });

    it('exports no barrel carries the names kept internal on purpose', () => {
        for (const name of NO_BARREL_VALUES) {
            expect(rootExports[name], `root.${name}`).toBeUndefined();
            expect(sdkExports[name], `sdk.${name}`).toBeUndefined();
            expect(componentExports[name], `component.${name}`).toBeUndefined();
        }
    });

    it('the orbit helpers are reachable from the component entry point and from neither main barrel', () => {
        for (const name of COMPONENT_ONLY_VALUES) {
            expect(componentExports[name], `component.${name}`).toBeDefined();
            expect(rootExports[name], `root.${name}`).toBeUndefined();
            expect(sdkExports[name], `sdk.${name}`).toBeUndefined();
        }
    });

    it('Canvas3D is the same class everywhere', () => {
        expect(rootExports.Canvas3D).toBe(Canvas3D);
        expect(sdkExports.Canvas3D).toBe(Canvas3D);
    });
});

describe('the built-in registry and the 3D classes', () => {
    /** Document key -> the class it must build. */
    const KEYS: Record<string, string> = {
        canvas3d: 'Canvas3D', group3d: 'Group3D', mesh3d: 'Mesh3D',
        box3d: 'Box3D', sphere3d: 'Sphere3D', plane3d: 'Plane3D', circle3d: 'Circle3D',
        cylinder3d: 'Cylinder3D', cone3d: 'Cone3D', capsule3d: 'Capsule3D', torus3d: 'Torus3D',
        'torus-knot3d': 'TorusKnot3D', tube3d: 'Tube3D', lathe3d: 'Lathe3D', extrude3d: 'Extrude3D',
        ring3d: 'Ring3D', polyhedron3d: 'Polyhedron3D', points3d: 'Points3D', line3d: 'Line3D',
        sprite3d: 'Sprite3D', instances3d: 'Instances3D', model3d: 'Model3D', camera3d: 'Camera3D',
        'ambient-light3d': 'AmbientLight3D', 'directional-light3d': 'DirectionalLight3D',
        'point-light3d': 'PointLight3D', 'spot-light3d': 'SpotLight3D',
        'hemisphere-light3d': 'HemisphereLight3D', 'area-light3d': 'AreaLight3D',
        fog3d: 'Fog3D', environment3d: 'Environment3D',
    };

    it('registers exactly the 31 documented 3D keys', () => {
        const registry = new Registry();
        const found = registry.nodeKeys().filter((key) => /3d$/.test(key));
        expect(Object.keys(KEYS)).toHaveLength(31);
        expect(found.sort()).toEqual(Object.keys(KEYS).sort());
    });

    it('builds a node of the named class, in the 3D dimension, for every key', () => {
        const registry = new Registry();
        for (const [key, className] of Object.entries(KEYS)) {
            const node = registry.instantiate({ id: `n-${key}`, type: key, parentId: null, layerOrder: 0, props: {} });
            const exported = rootExports[className] as { node?: unknown };
            // A component builds its generated class; `instanceof` the component holds too.
            expect(node.constructor, key).toBe(exported.node ?? exported);
            expect(node instanceof (exported as new () => unknown), key).toBe(true);
            // The viewport is the one 3D key that lives in the 2D tree.
            expect(node.dimension, key).toBe(key === 'canvas3d' ? '2d' : '3d');
        }
    });

    it('does not register ModelView3D, which is not document API', () => {
        const registry = new Registry();
        expect(registry.hasNode('model-view3d')).toBe(false);
        expect(registry.hasNode('modelview3d')).toBe(false);
        for (const key of registry.nodeKeys()) {
            expect(registry.node(key)?.ctor.name, key).not.toBe('ModelView3D');
        }
    });
});
