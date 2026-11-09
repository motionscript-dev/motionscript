import { describe, expect, it } from 'vitest';
import { Scene3D, type Scene3DOp } from '@/render3d/scene3d';
import { Mesh3D, Box3D, Capsule3D, Circle3D, Cone3D, Cylinder3D, Extrude3D, Lathe3D, Plane3D, Polyhedron3D, Ring3D, Sphere3D, Torus3D, TorusKnot3D, Tube3D } from "@/components/builtins/three/three";
import { Geo } from '@/render3d/builders';
import type { Node3D } from '@/components/trees/three/node3d';
import { Fills } from '@/attributes/shape/fill/chain';

/** The one mesh op a node records. */
function meshOf(node: Node3D): Extract<Scene3DOp, { kind: 'mesh' }> {
    const scene = new Scene3D();
    node.render(scene);
    const op = scene.ops().find((o) => o.kind === 'mesh');
    if (op?.kind !== 'mesh') throw new Error('no mesh recorded');
    return op;
}

describe('Mesh3D', () => {
    it('draws nothing without a geometry', () => {
        const scene = new Scene3D();
        new Mesh3D().render(scene);
        expect(scene.ops().map((o) => o.kind)).toEqual(['push', 'pop']);
        expect(scene.isEmpty()).toBe(true);
    });

    it('draws the geometry prop through a standard material, white by default, with no other keys', () => {
        const geometry = Geo.torusKnot({ radius: 2 });
        const op = meshOf(new Mesh3D({ geometry }));
        expect(op.geometry).toBe(geometry);
        // `fill` defaults to white; every shorthand key stays absent so the
        // renderer's own defaults apply.
        expect(op.material).toEqual({ type: 'standard', color: 'white' });
    });

    it('defaults fill to white, unlit to false, and leaves every other material key unset', () => {
        const mesh = new Mesh3D();
        expect(mesh.fill).toBe('white');
        expect(mesh.unlit).toBe(false);
        for (const key of [
            'material', 'opacity', 'roughness', 'metalness', 'emission', 'emissionStrength',
            'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'envMapIntensity',
            'wireframe', 'shading', 'faces', 'vertexColors', 'blend',
        ]) {
            expect((mesh as unknown as Record<string, unknown>)[key], key).toBeUndefined();
        }
    });

    it('copies the shorthand keys that are set onto the material, and only those', () => {
        const op = meshOf(new Mesh3D({
            geometry: Geo.box(), fill: 'tomato', roughness: 0.3, metalness: 1, wireframe: true,
            shading: 'flat', faces: 'both', blend: 'additive', opacity: 0.5,
        }));
        expect(op.material).toMatchObject({
            type: 'standard', roughness: 0.3, metalness: 1, wireframe: true,
            shading: 'flat', faces: 'both', blend: 'additive', opacity: 0.5,
        });
        expect(op.material).not.toHaveProperty('vertexColors');
        expect(op.material).not.toHaveProperty('emissionStrength');
    });

    it('selects an unlit basic material when unlit is set', () => {
        expect(meshOf(new Mesh3D({ geometry: Geo.box(), unlit: true })).material).toMatchObject({ type: 'basic' });
    });

    it('lets an explicit material win over the shorthand', () => {
        const material = { type: 'phong' as const, shininess: 20 };
        const op = meshOf(new Mesh3D({ geometry: Geo.box(), material, fill: 'red', roughness: 1 }));
        expect(op.material).toBe(material);
    });

    it('writes a texture fill to map and a colour fill to color', () => {
        expect(meshOf(new Mesh3D({ geometry: Geo.box(), fill: '/wood.png' })).material)
            .toMatchObject({ map: '/wood.png' });
        const colour = meshOf(new Mesh3D({ geometry: Geo.box(), fill: 'red' })).material as unknown as Record<string, unknown>;
        expect(colour.color).toBe('red');
        expect(colour).not.toHaveProperty('map');
    });

    it('resolves a rich fill to a surface map rather than a colour', () => {
        const op = meshOf(new Mesh3D({ geometry: Geo.box(), fill: Fills.linearGradient(['red', 'blue']) as never }));
        const material = op.material as unknown as { color?: unknown; map?: { static?: boolean } };
        expect(material.color).toBeUndefined();
        expect(material.map?.static).toBe(true);
    });
});

describe('the geometry nodes', () => {
    // [node, the discriminant it records, what a bare node records beyond it]
    const cases: [string, () => Mesh3D, Record<string, unknown>][] = [
        ['Box3D', () => new Box3D(), { type: 'box' }],
        ['Sphere3D', () => new Sphere3D(), { type: 'sphere' }],
        ['Plane3D', () => new Plane3D(), { type: 'plane' }],
        ['Cylinder3D', () => new Cylinder3D(), { type: 'cylinder' }],
        ['Cone3D', () => new Cone3D(), { type: 'cone' }],
        ['Torus3D', () => new Torus3D(), { type: 'torus' }],
        ['TorusKnot3D', () => new TorusKnot3D(), { type: 'torusKnot' }],
        ['Circle3D', () => new Circle3D(), { type: 'circle' }],
        ['Ring3D', () => new Ring3D(), { type: 'ring' }],
        ['Capsule3D', () => new Capsule3D(), { type: 'capsule' }],
        // The one node whose parameter has a default of its own.
        ['Polyhedron3D', () => new Polyhedron3D(), { type: 'polyhedron', shape: 'icosahedron' }],
        ['Extrude3D', () => new Extrude3D(), { type: 'extrude' }],
        ['Lathe3D', () => new Lathe3D(), { type: 'lathe' }],
        ['Tube3D', () => new Tube3D(), { type: 'tube' }],
    ];

    it.each(cases)('%s records only its discriminant when no parameter is set', (_name, make, expected) => {
        expect(meshOf(make()).geometry).toEqual(expected);
    });

    it('covers all 14 geometry nodes', () => {
        expect(cases).toHaveLength(14);
    });

    // [node, props set, the geometry that must be recorded]
    const parameters: [string, () => Mesh3D, Record<string, unknown>][] = [
        ['Box3D', () => new Box3D({ width: 2, height: 3, depth: 4, cornerRadius: 0.2, segments: [2, 2, 2] }),
            { type: 'box', width: 2, height: 3, depth: 4, cornerRadius: 0.2, segments: [2, 2, 2] }],
        ['Sphere3D', () => new Sphere3D({ radius: 2, segments: [16, 8], startAngle: 10, sweep: 200, startLatitude: 20, latitudeSweep: 90 }),
            { type: 'sphere', radius: 2, segments: [16, 8], startAngle: 10, sweep: 200, startLatitude: 20, latitudeSweep: 90 }],
        ['Plane3D', () => new Plane3D({ width: 5, height: 6, segments: 4 }),
            { type: 'plane', width: 5, height: 6, segments: 4 }],
        ['Cylinder3D', () => new Cylinder3D({ radius: [0.5, 1], height: 3, segments: [8, 2], capped: false, startAngle: 5, sweep: 90 }),
            { type: 'cylinder', radius: [0.5, 1], height: 3, segments: [8, 2], capped: false, startAngle: 5, sweep: 90 }],
        ['Cone3D', () => new Cone3D({ radius: 2, height: 4, segments: [12, 3], capped: false, startAngle: 0, sweep: 180 }),
            { type: 'cone', radius: 2, height: 4, segments: [12, 3], capped: false, startAngle: 0, sweep: 180 }],
        ['Torus3D', () => new Torus3D({ radius: 3, thickness: 0.5, segments: [8, 24], startAngle: 0, sweep: 270 }),
            { type: 'torus', radius: 3, thickness: 0.5, segments: [8, 24], startAngle: 0, sweep: 270 }],
        ['TorusKnot3D', () => new TorusKnot3D({ radius: 2, thickness: 0.2, segments: [32, 6], windings: [3, 5] }),
            { type: 'torusKnot', radius: 2, thickness: 0.2, segments: [32, 6], windings: [3, 5] }],
        ['Circle3D', () => new Circle3D({ radius: 2, segments: 12, startAngle: 30, sweep: 120 }),
            { type: 'circle', radius: 2, segments: 12, startAngle: 30, sweep: 120 }],
        ['Ring3D', () => new Ring3D({ radius: 2, innerRadius: 1, segments: [16, 2], startAngle: 0, sweep: 90 }),
            { type: 'ring', radius: 2, innerRadius: 1, segments: [16, 2], startAngle: 0, sweep: 90 }],
        ['Capsule3D', () => new Capsule3D({ radius: 0.4, height: 2, segments: [8, 4] }),
            { type: 'capsule', radius: 0.4, height: 2, segments: [8, 4] }],
        ['Polyhedron3D', () => new Polyhedron3D({ shape: 'dodecahedron', radius: 2, segments: 1 }),
            { type: 'polyhedron', shape: 'dodecahedron', radius: 2, segments: 1 }],
        ['Extrude3D', () => new Extrude3D({ path: 'M0 0 L1 0 L1 1 Z', depth: 2, segments: 6, bevel: { size: 0.2 } }),
            { type: 'extrude', path: 'M0 0 L1 0 L1 1 Z', depth: 2, segments: 6, bevel: { size: 0.2 } }],
        ['Lathe3D', () => new Lathe3D({ points: [[1, 0, 0], [1, 1, 0]], segments: 20, startAngle: 0, sweep: 180 }),
            { type: 'lathe', points: [[1, 0, 0], [1, 1, 0]], segments: 20, startAngle: 0, sweep: 180 }],
        ['Tube3D', () => new Tube3D({ points: [[0, 0, 0], [1, 1, 1]], radius: 0.1, segments: [10, 4], closed: true }),
            { type: 'tube', points: [[0, 0, 0], [1, 1, 1]], radius: 0.1, segments: [10, 4], closed: true }],
    ];

    it.each(parameters)('%s gathers every parameter it declares into the descriptor', (_name, make, expected) => {
        expect(meshOf(make()).geometry).toEqual(expected);
    });

    it('rebuilds the geometry when a parameter changes: every parameter is a live prop', () => {
        const sphere = new Sphere3D({ radius: 1 });
        expect(meshOf(sphere).geometry).toEqual({ type: 'sphere', radius: 1 });
        sphere.set({ radius: 3 } as never);
        expect(meshOf(sphere).geometry).toEqual({ type: 'sphere', radius: 3 });
    });

    it('keeps the geometry parameters and the material shorthand apart', () => {
        const op = meshOf(new Cylinder3D({ radius: 2, fill: 'tomato', roughness: 0.2 }));
        expect(op.geometry).toEqual({ type: 'cylinder', radius: 2 });
        expect(op.material).toMatchObject({ type: 'standard', roughness: 0.2, color: 'tomato' });
        expect(op.material).not.toHaveProperty('radius');
    });
});
