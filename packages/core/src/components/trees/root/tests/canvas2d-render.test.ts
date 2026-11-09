import { describe, it, expect } from 'vitest';
import { Canvas2D } from '@/components/trees/root/canvas2d-node';
import { Rect } from "@/components/builtins/geometry/geometry";
import { Node2D } from '@/components/trees/2d/node2d';
import { AudioBus, SoundNode } from "@/components/builtins/audio/audio";
import { Fills } from '@/attributes/shape/fill/chain';
import { laidOut, recorded, RecordingContext } from '@/components/trees/tests/recording-context.fixtures';
import { attached } from '@/components/trees/node/node.fixtures';
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import { ManifestAssetCatalog } from '@/assets/catalog';
import { AssetDeclaration } from '@/assets/scope';
import { declareNode } from '@/components/trees/node/node-walk';
import type { FillResolved } from '@/attributes/shape/fill/union';

const scope = new FakeMeasureContext();
const CATALOG = new ManifestAssetCatalog({
    image: { 'bg.png': { src: 'bg.png', width: 8, height: 8, sizeBytes: 0 } },
    video: { 'grain.mp4': { src: 'grain.mp4', width: 8, height: 8, duration: 2, sizeBytes: 0 } },
    audio: {},
    font: {},
});
const child = (id: string, extra: Record<string, unknown> = {}) => new Rect({ id, width: 50, height: 50, ...extra });

function stage(props: Record<string, unknown> = {}, ...children: Node2D[]): Canvas2D {
    return laidOut(
        new Canvas2D({ id: 'stage', width: 800, height: 600, ...props, children } as never),
        { x: 0, y: 0, width: 800, height: 600 },
    );
}

/** The colour of each `fill` op in a recorded drawing, as a readable list. */
function fillColours(ctx: RecordingContext): Array<number[] | undefined> {
    return ctx.graphics.map((g) => {
        const fill = g.ops().find((op) => op.kind === 'fill') as { fills: FillResolved[] } | undefined;
        const first = fill?.fills[0] as { color?: number[] } | undefined;
        return first?.color;
    });
}

describe('Canvas2D painting — fill, children, overlay', () => {
    it('paints its fill first, then its children, then its overlay', () => {
        const ctx = recorded(stage({ fill: 'red', overlay: 'blue' }, child('a'), child('b')));
        const events = ctx.events;
        // The stage's own drawings are the plain `rect+fill`; a child's carries its shadow op too.
        const own = events.map((e, i) => (e === 'draw:rect+fill' ? i : -1)).filter((i) => i >= 0);
        expect(own).toHaveLength(2);
        expect(own[0]).toBeLessThan(events.indexOf('begin:a'));
        expect(events.indexOf('begin:a')).toBeLessThan(events.indexOf('begin:b'));
        // The overlay comes after the last child has closed its scope.
        const lastChildEnd = events.indexOf('end', events.indexOf('begin:b'));
        expect(own[1]).toBeGreaterThan(lastChildEnd);
        expect(fillColours(ctx).filter(Boolean)[0]).toEqual([1, 0, 0, 1]);
        expect(fillColours(ctx).filter(Boolean).pop()).toEqual([0, 0, 1, 1]);
    });

    it('draws the fill as a rect the size of the viewport', () => {
        const ctx = recorded(stage({ fill: 'red' }));
        const rect = ctx.graphics[0].ops().find((op) => op.kind === 'rect') as { state: { width: number; height: number } };
        expect(rect.state).toMatchObject({ width: 800, height: 600 });
    });

    it('draws the overlay as a rect the size of the viewport, after the last child has ended', () => {
        const ctx = recorded(stage({ overlay: 'blue' }, child('a')));
        const events = ctx.events;
        const overlay = events.lastIndexOf('draw:rect+fill');
        expect(overlay).toBeGreaterThan(events.indexOf('begin:a'));
        // Its scope has ended by then: the rect child's own `end` came first.
        expect(events.slice(events.indexOf('begin:a'), overlay)).toContain('end');
        const rect = ctx.graphics[ctx.graphics.length - 1].ops().find((op) => op.kind === 'rect') as { state: { width: number } };
        expect(rect.state.width).toBe(800);
    });

    it('paints nothing of its own with neither a fill nor an overlay', () => {
        const ctx = recorded(stage({}, child('a')));
        // Only the child draws; the stage itself contributes no drawing between its scope and the child's.
        expect(ctx.events.slice(0, 3)).toEqual(['begin:stage', 'transform', 'begin:a']);
    });

    it('draws a fill and an overlay of several layers as one drawing each', () => {
        const ctx = recorded(stage({ fill: ['red', 'blue'], overlay: ['white/10', 'black/10'] }));
        expect(ctx.events.filter((e) => e === 'draw:rect+fill')).toHaveLength(2);
    });

    it('draws no stroke and no shadow of its own: it is not a shape', () => {
        const ctx = recorded(stage({ fill: 'red', overlay: 'blue' }));
        expect(ctx.events).toEqual(['begin:stage', 'transform', 'draw:rect+fill', 'draw:rect+fill', 'end']);
    });

    it('declares both layers as assets, and nothing else', () => {
        const root = stage({ fill: Fills.image('bg.png'), overlay: Fills.video('grain.mp4') });
        const declared = new AssetDeclaration(CATALOG);
        declareNode(root, declared);
        expect([...declared.declarations.values()].map((d) => `${d.type}:${(d as { src: string }).src}`).sort())
            .toEqual(['image:bg.png', 'video:grain.mp4']);
    });

    it('declares nothing without paint', () => {
        const declared = new AssetDeclaration(CATALOG);
        declareNode(stage({}, child('a')), declared);
        expect(declared.declarations.size).toBe(0);
    });

    it('draws nothing at zero opacity', () => {
        expect(recorded(stage({ fill: 'red', opacity: 0 }, child('a'))).events).toEqual([]);
    });
});

describe('Canvas2D camera — the at-rest fast path', () => {
    it('pushes no camera at zoom 1, heading 0 and lookAt at the origin', () => {
        const root = stage({}, child('a'));
        const ctx = recorded(root);
        expect(ctx.events.some((e) => e.includes('Camera'))).toBe(false);
        expect(ctx.events).toContain('begin:a');
        expect(root._cameraScope()).toBeNull();
    });

    it.each([
        ['zoom', { zoom: 2 }],
        ['heading', { heading: 15 }],
        ['lookAt x', { lookAt: { x: 10, y: 0 } }],
        ['lookAt y', { lookAt: { x: 0, y: -10 } }],
    ])('pushes a camera as soon as %s moves off rest', (_name, props) => {
        const root = stage(props, child('a'));
        const ctx = recorded(root);
        expect(ctx.events.filter((e) => e === 'beginCamera')).toHaveLength(1);
        expect(ctx.events.filter((e) => e === 'endCamera')).toHaveLength(1);
        expect(root._cameraScope()).not.toBeNull();
    });

    it('wraps the children, and only the children, in the camera', () => {
        const ctx = recorded(stage({ zoom: 2, fill: 'red', overlay: 'blue' }, child('a'), child('b')));
        const events = ctx.events;
        const begin = events.indexOf('beginCamera');
        const end = events.indexOf('endCamera');
        // The background is painted before the camera, the overlay after it.
        expect(events.indexOf('draw:rect+fill')).toBeLessThan(begin);
        expect(events.lastIndexOf('draw:rect+fill')).toBeGreaterThan(end);
        expect(events.slice(begin + 1, end).filter((e) => e.startsWith('begin:'))).toEqual(['begin:a', 'begin:b']);
        expect(ctx.unbalanced).toEqual({});
    });

    it('hands the camera its viewport, lookAt, zoom and heading', () => {
        const ctx = recorded(stage({ zoom: 1.5, heading: 20, lookAt: { x: 30, y: -40 } }, child('a')));
        expect(ctx.cameras).toEqual([{
            viewport: { x: 0, y: -0, width: 800, height: 600 },
            lookAt: { x: 30, y: -40 },
            zoom: 1.5,
            heading: 20,
        }]);
    });

    it('puts the viewport at the stage\'s laid-out position, y flipped', () => {
        const root = laidOut(
            new Canvas2D({ id: 'stage', zoom: 2, children: [child('a')] } as never),
            { x: 10, y: 25, width: 400, height: 300 },
        );
        expect(recorded(root).cameras[0].viewport).toEqual({ x: 10, y: -25, width: 400, height: 300 });
    });

    it('reports the camera the renderer pushed, for picking to push the same', () => {
        const root = stage({ zoom: 2, heading: 10, lookAt: { x: 5, y: 6 } });
        expect(root._cameraScope()).toEqual({ lookAt: { x: 5, y: 6 }, zoom: 2, heading: 10 });
    });

    it('opens no flat camera in a 3D space, and renders its children in the space instead', () => {
        const root = stage({ space3D: true, perspective: 800, zoom: 2, orbit: 20 }, child('a'), child('b', { depth: 50 }));
        const ctx = recorded(root);
        expect(ctx.events.some((e) => e.includes('Camera'))).toBe(false);
        expect(root._cameraScope()).toBeNull();
        expect(root._spaceCamera()).toMatchObject({ perspective: 800, orbit: 20, zoom: 2 });
        // Each child is drawn under the matrix its frame in the space gave it.
        const transforms = ctx.transforms.slice(1);
        expect(transforms).toHaveLength(2);
        for (const t of transforms) expect(t.matrix).toBeDefined();
    });

    it('has no space camera outside a space', () => {
        expect(stage({ zoom: 2 })._spaceCamera()).toBeNull();
    });

    it('draws its children far to near in a space, whatever their order in the tree', () => {
        const root = stage(
            { space3D: true, perspective: 800 },
            child('near', { depth: 200 }), child('far', { depth: -200 }),
        );
        const ctx = recorded(root);
        const drawn = ctx.events.filter((e) => e.startsWith('begin:') && e !== 'begin:stage');
        expect(drawn).toEqual(['begin:far', 'begin:near']);
    });
});

describe('Canvas2D camera commands', () => {
    const live = (props: Record<string, unknown> = {}) => attached(new Canvas2D({ width: 800, height: 600, ...props } as never));

    it('zoomTo animates zoom', () => {
        const root = live();
        const command = root.zoomTo({ data: { zoom: 3 }, duration: 2 });
        command.at(0);
        expect(root.zoom).toBe(1);
        command.at(0.5);
        expect(root.zoom).toBe(2);
        command.at(1);
        expect(root.zoom).toBe(3);
    });

    it('panTo animates lookAt, in depth too when asked', () => {
        const root = live();
        const command = root.panTo({ data: { lookAt: { x: 100, y: -50, z: 20 } }, duration: 1 });
        command.at(0.5);
        expect(root.lookAt).toEqual({ x: 50, y: -25, z: 10 });
        command.at(1);
        expect(root.lookAt).toEqual({ x: 100, y: -50, z: 20 });
    });

    it('panTo leaves lookAt flat when neither end has a depth', () => {
        const root = live();
        root.panTo({ data: { lookAt: { x: 10, y: 10 } }, duration: 1 }).at(1);
        expect(root.lookAt).toEqual({ x: 10, y: 10 });
        expect('z' in root.lookAt).toBe(false);
    });

    it('headingTo animates heading', () => {
        const root = live({ heading: 10 });
        const command = root.headingTo({ data: { heading: 50 }, duration: 1 });
        command.at(0.5);
        expect(root.heading).toBe(30);
    });

    it('orbitTo animates orbit and elevation together', () => {
        const root = live();
        const command = root.orbitTo({ data: { orbit: 40, elevation: 20 }, duration: 1 });
        command.at(0.5);
        expect([root.orbit, root.elevation]).toEqual([20, 10]);
    });

    it('dollyTo animates dolly', () => {
        const root = live();
        root.dollyTo({ data: { dolly: 100 }, duration: 1 }).at(0.25);
        expect(root.dolly).toBe(25);
    });

    it('is a function of t: seeking back and forth lands on the same value', () => {
        const root = live();
        const command = root.zoomTo({ data: { zoom: 3 }, duration: 1 });
        command.at(0.75);
        command.at(0.25);
        expect(root.zoom).toBe(1.5);
        command.at(0.75);
        expect(root.zoom).toBe(2.5);
    });

    it('fillTo and overlayTo tween the paint through the fill attribute', () => {
        const root = live({ fill: 'black', overlay: 'black' });
        root.fillTo({ data: 'white', duration: 1 }).at(0.5);
        root.overlayTo({ data: 'white', duration: 1 }).at(1);
        expect((root.fill as FillResolved[])[0]).toMatchObject({ type: 'solid', color: [0.5, 0.5, 0.5, 1] });
        expect((root.overlay as FillResolved[])[0]).toMatchObject({ type: 'solid', color: [1, 1, 1, 1] });
    });

    it('runs its duration and writes nothing while it is not in a scene', () => {
        const root = new Canvas2D({ width: 800, height: 600 } as never);
        const command = root.zoomTo({ data: { zoom: 3 }, duration: 2 });
        expect(command.duration).toBe(2);
        command.at(1);
        expect(root.zoom).toBe(1);
    });
});

describe('Canvas2D with audio children', () => {
    function withAudio() {
        const a = child('a');
        const bus = new AudioBus({ id: 'bus', children: [new SoundNode({ id: 'snd', src: 'x.mp3' })] } as never);
        const root = new Canvas2D({ id: 'stage', width: 800, height: 600, children: [a, bus] } as never);
        return { root, a, bus };
    }

    it('accepts an audio child where a 2D node would throw on a 3D one', () => {
        expect(() => withAudio()).not.toThrow();
    });

    it('lists the audio children, and only them, in childrenAudio', () => {
        const { root, bus } = withAudio();
        expect(root.childrenAudio).toEqual([bus]);
    });

    it('keeps an audio child out of the 2D children, so layout and picking do not see it', () => {
        const { root, a, bus } = withAudio();
        expect(root.children).toEqual([a]);
        expect(root.flowChildren()).toEqual([a]);
        expect(root._allChildren).toEqual([a, bus]);
    });

    it('does not lay an audio child out or draw it', () => {
        const { root, a } = withAudio();
        laidOut(root, { x: 0, y: 0, width: 800, height: 600 });
        const ctx = recorded(root);
        expect(ctx.events.filter((e) => e.startsWith('begin:'))).toEqual(['begin:stage', 'begin:a']);
        expect(root.measure({ maxWidth: 800, maxHeight: 600 }, scope)).toMatchObject({ width: 800, height: 600 });
        expect(a.measuredWidth).toBe(50);
    });

    it('mounts the audio subtree with the rest of the tree', () => {
        const { root, bus } = withAudio();
        attached(root);
        expect(bus.mounted).toBe(true);
    });

    it('is the only 2D node that takes one: a Rect throws', () => {
        const bus = new AudioBus({} as never);
        expect(() => new Rect({ children: [bus] } as never)).toThrow(/cannot hold/);
    });
});
