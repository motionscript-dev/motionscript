import { describe, expect, it } from 'vitest';
import { Scene3D, type Scene3DOp } from '@/render3d/scene3d';
import { Instances3D, Line3D, Model3D, ModelView3D, Points3D, Sprite3D } from "@/components/builtins/three/three";
import { Mat, Geo } from '@/render3d/builders';
import type { Node3D } from '@/components/trees/three/node3d';

/** Every op a node records, group scope included. */
function record(node: Node3D<never> | Node3D): readonly Scene3DOp[] {
    const scene = new Scene3D();
    node.render(scene);
    return scene.ops();
}

/** The ops between a node's own push and pop. */
const drawn = (node: Node3D<never> | Node3D) => record(node).filter((o) => o.kind !== 'push' && o.kind !== 'pop');

describe('Instances3D', () => {
    const placements = [{ position: [0, 0, 0] }, { position: [1, 0, 0] }, { position: [2, 0, 0] }] as const;

    it('draws one instances op whose length is the instance count', () => {
        const [op] = drawn(new Instances3D({ geometry: Geo.box(), instances: placements, fill: 'red' }));
        expect(op).toMatchObject({ kind: 'instances', geometry: { type: 'box' } });
        expect(op.kind === 'instances' && op.instances).toHaveLength(3);
        expect(op.kind === 'instances' && op.material).toMatchObject({ type: 'standard', color: 'red' });
    });

    it('carries the per-instance colours when given, and none when not', () => {
        const [tinted] = drawn(new Instances3D({
            geometry: Geo.box(), instances: placements, colors: ['red', 'green', 'blue'],
        }));
        expect(tinted.kind === 'instances' && tinted.colors).toEqual(['red', 'green', 'blue']);

        const [plain] = drawn(new Instances3D({ geometry: Geo.box(), instances: placements }));
        expect(plain.kind === 'instances' && plain.colors).toBeUndefined();
    });

    it('takes the first material when the shorthand resolves to several', () => {
        const first = Mat.standard({ color: 'red' });
        const [op] = drawn(new Instances3D({
            geometry: Geo.box(), instances: placements, material: [first, Mat.basic()],
        }));
        expect(op.kind === 'instances' && op.material).toBe(first);
    });

    it('draws nothing without a geometry or without instances', () => {
        expect(drawn(new Instances3D({ instances: placements }))).toEqual([]);
        expect(drawn(new Instances3D({ geometry: Geo.box() }))).toEqual([]);
        expect(drawn(new Instances3D({ geometry: Geo.box(), instances: [] }))).toEqual([]);
    });
});

describe('Points3D', () => {
    const material = (node: Points3D) => {
        const [op] = drawn(node);
        return op.kind === 'points' ? op.material : undefined;
    };

    it('draws a points op over its geometry with a bare points material', () => {
        const [op] = drawn(new Points3D({ geometry: Geo.sphere() }));
        expect(op).toMatchObject({ kind: 'points', geometry: { type: 'sphere' } });
        // `fill` defaults to white, which is a colour.
        expect(material(new Points3D({ geometry: Geo.sphere() }))).toEqual({ type: 'points', color: 'white' });
    });

    it('builds the material from fill, opacity, alphaMap, blend and vertexColors', () => {
        expect(material(new Points3D({
            geometry: Geo.sphere(), fill: 'red', opacity: 0.4, alphaMap: '/a.png', blend: 'additive', vertexColors: true,
        }))).toEqual({
            type: 'points', color: 'red', opacity: 0.4, alphaMap: '/a.png', blend: 'additive', vertexColors: true,
        });
    });

    it('takes the first material of an explicit array', () => {
        const first = Mat.points({ size: 3 });
        expect(material(new Points3D({ geometry: Geo.sphere(), material: [first, Mat.points()] }))).toBe(first);
    });

    it('draws nothing without a geometry', () => {
        expect(drawn(new Points3D())).toEqual([]);
    });
});

describe('Line3D', () => {
    it('draws a strip through its points, with the default lineBasic material', () => {
        const [op] = drawn(new Line3D({ points: [[0, 0, 0], [1, 1, 1]] }));
        expect(op).toMatchObject({
            kind: 'line',
            mode: 'strip',
            geometry: { type: 'buffer', position: new Float32Array([0, 0, 0, 1, 1, 1]) },
            material: { type: 'lineBasic' },
        });
    });

    it('maps closed and segments onto the recorded mode, segments first', () => {
        const mode = (props: Record<string, unknown>) => {
            const [op] = drawn(new Line3D({ points: [[0, 0, 0], [1, 0, 0]], ...props } as never));
            return op.kind === 'line' ? op.mode : undefined;
        };
        expect(mode({ closed: true })).toBe('loop');
        expect(mode({ segments: true })).toBe('segments');
        expect(mode({ closed: true, segments: true })).toBe('segments');
    });

    it('draws a dashed stroke and an opacity through the line material', () => {
        const [op] = drawn(new Line3D({
            points: [[0, 0, 0], [1, 0, 0]], stroke: { fill: 'white', dash: [0.2, 0.1] }, opacity: 0.5,
        }));
        expect(op.kind === 'line' && op.material).toMatchObject({
            type: 'lineDashed', color: 'white', dashSize: 0.2, gapSize: 0.1, opacity: 0.5,
        });
    });

    it('prefers a geometry over points', () => {
        const geometry = Geo.edges(Geo.box());
        const [op] = drawn(new Line3D({ geometry, points: [[0, 0, 0], [1, 1, 1]] }));
        expect(op.kind === 'line' && op.geometry).toBe(geometry);
    });

    it('keeps an explicit material', () => {
        const material = Mat.lineBasic({ color: 'red' });
        const [op] = drawn(new Line3D({ points: [[0, 0, 0], [1, 0, 0]], material }));
        expect(op.kind === 'line' && op.material).toBe(material);
    });

    it('draws nothing with neither points nor geometry', () => {
        expect(drawn(new Line3D())).toEqual([]);
        expect(drawn(new Line3D({ points: [] }))).toEqual([]);
    });
});

describe('Sprite3D', () => {
    it('draws a sprite op with a bare sprite material when nothing is set', () => {
        const [op] = drawn(new Sprite3D());
        expect(op).toMatchObject({ kind: 'sprite', material: { type: 'sprite' } });
    });

    it('carries a texture as map, a colour as color, and the opacity', () => {
        const [textured] = drawn(new Sprite3D({ fill: '/dot.png', opacity: 0.5 }));
        expect(textured.kind === 'sprite' && textured.material).toEqual({ type: 'sprite', map: '/dot.png', opacity: 0.5 });
        const [coloured] = drawn(new Sprite3D({ fill: 'tomato' }));
        expect(coloured.kind === 'sprite' && coloured.material).toEqual({ type: 'sprite', color: 'tomato' });
    });

    it('keeps an explicit material', () => {
        const material = Mat.sprite({ color: 'blue' });
        const [op] = drawn(new Sprite3D({ fill: '/dot.png', material }));
        expect(op.kind === 'sprite' && op.material).toBe(material);
    });
});

describe('Model3D', () => {
    it('draws nothing without a src', () => {
        expect(drawn(new Model3D())).toEqual([]);
        expect(drawn(new Model3D({ src: '' }))).toEqual([]);
    });

    it('draws a model op from src, animation and override', () => {
        const override = { body: Mat.standard({ color: 'red' }) };
        const [op] = drawn(new Model3D({
            src: '/robot.glb', animation: { clip: 'walk', time: 1.5 }, override,
        }));
        expect(op).toMatchObject({
            kind: 'model', src: '/robot.glb', animation: [{ clip: 'walk', time: 1.5 }],
        });
        expect(op.kind === 'model' && op.override).toBe(override);
    });

    it('records no animation key when none is set', () => {
        const [op] = drawn(new Model3D({ src: '/robot.glb' }));
        expect(op.kind === 'model' && op.animation).toBeUndefined();
    });
});

describe('ModelView3D', () => {
    const model = (props: Record<string, unknown>) => {
        const [op] = drawn(new ModelView3D(props as never));
        return op;
    };

    it('takes the entries of a Model3D, beside its own', () => {
        const view = new ModelView3D({ src: '/a.glb' });
        expect([view.src, view.animation, view.override]).toEqual(['/a.glb', undefined, undefined]);
    });

    it('defaults clip to empty and clipTime to 0', () => {
        const view = new ModelView3D();
        expect(view.clip).toBe('');
        expect(view.clipTime).toBe(0);
    });

    it('folds clip and clipTime into the model animation', () => {
        expect(model({ src: '/a.glb', clip: 'walk', clipTime: 2.5 })).toMatchObject({
            kind: 'model', animation: [{ clip: 'walk', time: 2.5 }],
        });
    });

    it('reads a numeric clip string as an index and anything else as a name', () => {
        const clip = (value: string) => {
            const op = model({ src: '/a.glb', clip: value });
            return op.kind === 'model' ? op.animation?.[0].clip : 'no model';
        };
        expect(clip('0')).toBe(0);
        expect(clip(' 3 ')).toBe(3);
        expect(clip('walk')).toBe('walk');
        // Not an index: a name that merely starts with digits, a fraction, a negative.
        expect(clip('2abc')).toBe('2abc');
        expect(clip('1.5')).toBe('1.5');
        expect(clip('-1')).toBe('-1');
    });

    it('leaves the clip undefined when the field is empty, so the first clip plays', () => {
        for (const clip of ['', '   ']) {
            const op = model({ src: '/a.glb', clip });
            expect(op.kind === 'model' && op.animation?.[0]).toEqual({ clip: undefined, time: 0 });
        }
    });

    it('ignores the base animation prop', () => {
        const op = model({ src: '/a.glb', animation: { clip: 'ignored', time: 9 }, clipTime: 1 });
        expect(op.kind === 'model' && op.animation).toEqual([{ clip: undefined, time: 1 }]);
    });

    it('passes the override through', () => {
        const override = { body: Mat.basic() };
        const op = model({ src: '/a.glb', override });
        expect(op.kind === 'model' && op.override).toBe(override);
    });

    it('draws a wireframe unit box while it has no src, so the node can still be found', () => {
        const op = model({});
        expect(op).toMatchObject({
            kind: 'mesh',
            geometry: { type: 'box', width: 1, height: 1, depth: 1 },
            material: { type: 'basic', wireframe: true, transparent: true, opacity: 0.7 },
        });
    });

    it('stops drawing the placeholder once a file is picked', () => {
        const kinds = drawn(new ModelView3D({ src: '/a.glb' } as never)).map((o) => o.kind);
        expect(kinds).toEqual(['model']);
    });
});
