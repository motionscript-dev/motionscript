import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graphics3D } from '@/render3d/graphics3d';
import { Scene3D } from '@/render3d/scene3d';
import { Mat } from '@/render3d/builders';
import { resetInertWarnings3D } from '@/render3d/inert';
import { Environment3D, Model3D, Points3D, Box3D } from "@/components/builtins/three/three";
import { Canvas3D } from "@/components/builtins/three/canvas3d";

/**
 * Inputs that are recorded and that no renderer acts on say so, once, in
 * development, and change nothing about what is recorded.
 */
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    resetInertWarnings3D();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
});

afterEach(() => {
    warn.mockRestore();
});

const messages = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));

describe('inert 3D inputs', () => {
    it('warns once for a post chain, however many frames record it', () => {
        for (let frame = 0; frame < 3; frame++) {
            new Scene3D().post([{ type: 'bloom', strength: 1 }, { type: 'ssao' }]);
        }
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toContain('"bloom", "ssao"');
        expect(messages()[0]).toContain('no backend applies a pass');
    });

    it('still records the chain it warned about', () => {
        const scene = new Scene3D().post({ type: 'bloom' });
        expect(scene.postEffects()).toEqual([{ type: 'bloom' }]);
    });

    it('stays quiet for an empty chain and an unset post prop', () => {
        new Scene3D().post([]);
        new Canvas3D({ children: [new Box3D()] });
        expect(messages()).toEqual([]);
    });

    it('warns for environment src and faces, but not for a preset', () => {
        new Scene3D().environment({ preset: 'studio', background: true });
        expect(messages()).toEqual([]);

        new Scene3D().environment({ src: '/sky.hdr', background: true });
        new Scene3D().environment({ faces: ['a', 'b', 'c', 'd', 'e', 'f'] });
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toContain('`src` and `faces`');

        const scene = new Scene3D();
        new Environment3D({ src: '/sky.exr' }).render(scene);
        expect(scene.environmentDescriptor()).toMatchObject({ src: '/sky.exr' });
    });

    it('warns for params on an environment', () => {
        new Scene3D().environment({ preset: 'studio', params: { x: 1 } });
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toContain('`params` on an environment');
    });

    it('warns once per geometry type for params, however the geometry is built', () => {
        new Graphics3D().box({ params: { name: 'x' } });
        new Graphics3D().box({ params: { name: 'y' } });
        new Graphics3D().mesh({ type: 'sphere', params: { name: 'z' } });
        new Graphics3D().box({ width: 2 });
        new Graphics3D().box({ params: {} });
        const found = messages();
        expect(found).toHaveLength(2);
        expect(found[0]).toContain('"box"');
        expect(found[1]).toContain('"sphere"');
    });

    it('does not warn for params on a material, where they are applied', () => {
        new Graphics3D().box({ material: Mat.standard({ params: { name: 'x' } }) });
        expect(messages()).toEqual([]);
    });

    it('warns for a shader material that extends a built-in model', () => {
        new Graphics3D().box({ material: { type: 'shader', vertex: '', fragment: '', extends: 'standard' } });
        new Graphics3D().box({ material: { type: 'shader', vertex: '', fragment: '', extends: null } });
        new Graphics3D().box({ material: { type: 'shader', vertex: '', fragment: '' } });
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toContain('extends: "standard"');
    });

    it('warns for an OBJ model, and not for glTF or GLB', () => {
        new Graphics3D().model({ src: '/crate.glb' });
        new Graphics3D().model({ src: '/crate.gltf?v=2' });
        expect(messages()).toEqual([]);

        new Graphics3D().model({ src: '/crate.OBJ' });
        new Model3D({ src: 'https://cdn.example/crate.obj?token=1' }).render(new Scene3D());
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toContain('OBJ');
    });

    it('stays silent outside development', () => {
        const env = process.env.NODE_ENV;
        vi.resetModules();
        process.env.NODE_ENV = 'production';
        return import('@/render3d/inert').then((inert) => {
            inert.warnInert3D('x', 'never printed');
            process.env.NODE_ENV = env;
            expect(messages()).toEqual([]);
        });
    });
});

describe('Points3D', () => {
    const material = (points: Points3D) => {
        const scene = new Scene3D();
        points.render(scene);
        const op = scene.ops().find((o) => o.kind === 'points');
        return op?.kind === 'points' ? op.material : undefined;
    };

    it('builds the points material from the shorthand', () => {
        const built = material(new Points3D({ geometry: { type: 'sphere' }, fill: 'red', opacity: 0.5 }));
        expect(built).toMatchObject({ type: 'points', opacity: 0.5 });
        expect(built).toHaveProperty('color');
        expect(built).not.toHaveProperty('roughness');
    });

    it('carries a texture fill as the dot map, and ignores the surface keys', () => {
        const built = material(new Points3D({
            geometry: { type: 'sphere' }, fill: '/dot.png', roughness: 0.2, metalness: 1, unlit: true,
        }));
        expect(built).toMatchObject({ type: 'points', map: expect.anything() });
        expect(built).not.toHaveProperty('roughness');
        expect(built).not.toHaveProperty('metalness');
    });

    it('lets an explicit material win', () => {
        const explicit = Mat.points({ size: 0.2 });
        expect(material(new Points3D({ geometry: { type: 'sphere' }, fill: 'red', material: explicit }))).toBe(explicit);
    });
});
