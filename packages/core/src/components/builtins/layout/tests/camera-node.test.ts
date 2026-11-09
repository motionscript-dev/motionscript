import { describe, it, expect } from 'vitest';
import { Camera } from "@/components/builtins/layout/layout";
import { Node2D } from '@/components/trees/2d/node2d';
import { Rect } from "@/components/builtins/geometry/geometry";
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import { attached } from '@/components/trees/node/node.fixtures';
import { laidOut, recorded } from '@/components/trees/tests/recording-context.fixtures';
import { BoxBounds } from '@/layout/bounds';
import { SizeInput } from '@/attributes/layout/size';

/**
 * A fixed-size leaf that also exposes the box its parent laid it into — the
 * `layoutBounds` is protected on Node2D, so a test subclass is the supported seam
 * for reading a child's resolved position. Mirrors the one in rect-node.test.ts.
 */
class Tile extends Node2D {
    constructor(width: SizeInput, height: SizeInput) {
        super({ width, height });
    }
    get rect(): BoxBounds {
        return this.layoutBounds;
    }
}

describe('Camera – stack-style hug measure', () => {
    const scope = new FakeMeasureContext();

    it('a populated Camera hugs to its largest child (basic stack), not to 0', () => {
        // Regression: a hugging Camera used to collapse to 0×0 and render
        // nothing. The base Node2D.measure now hugs children stack-style (see
        // stack-hug.test.ts), which the Camera inherits, so a bare <Camera>
        // sizes itself to its world like a stack Rect.
        const camera = new Camera({ children: [new Tile(400, 300)] });
        // Base "populated → hug" default is back (no forced "fill").
        expect((camera as any).width).toBe('hug');
        expect((camera as any).height).toBe('hug');

        const size = camera.measure({ maxWidth: 1920, maxHeight: 1080 }, scope);
        expect(size.width).toBe(400);
        expect(size.height).toBe(300);
    });

    it('hug takes the max child extent per axis (children overlap, do not sum)', () => {
        const camera = new Camera({
            children: [new Tile(400, 200), new Tile(250, 500)],
        });
        const size = camera.measure({ maxWidth: 1920, maxHeight: 1080 }, scope);
        expect(size.width).toBe(400); // max width, not 400+250
        expect(size.height).toBe(500); // max height, not 200+500
    });

    it('padding expands the hug size on both axes', () => {
        const camera = new Camera({ padding: 40, children: [new Tile(400, 300)] });
        const size = camera.measure({ maxWidth: 1920, maxHeight: 1080 }, scope);
        expect(size.width).toBe(480); // 400 + 40*2
        expect(size.height).toBe(380); // 300 + 40*2
    });

    it('an empty Camera fills its parent (base default for a childless node)', () => {
        const camera = new Camera({});
        expect((camera as any).width).toBe('fill');
        expect((camera as any).height).toBe('fill');

        const size = camera.measure({ maxWidth: 1920, maxHeight: 1080 }, scope);
        expect(size.width).toBe(1920);
        expect(size.height).toBe(1080);
    });

    it('an explicit width/height still wins over the hug default', () => {
        const camera = new Camera({ width: 800, height: 600, children: [new Tile(400, 400)] });
        expect((camera as any).width).toBe(800);
        expect((camera as any).height).toBe(600);

        const size = camera.measure({ maxWidth: 1920, maxHeight: 1080 }, scope);
        expect(size.width).toBe(800);
        expect(size.height).toBe(600);
    });

    it('a mixed axis: hug width + fixed height resolves each independently', () => {
        const camera = new Camera({ height: 720, children: [new Tile(500, 300)] });
        expect((camera as any).width).toBe('hug');
        expect((camera as any).height).toBe(720);

        const size = camera.measure({ maxWidth: 1920, maxHeight: 1080 }, scope);
        expect(size.width).toBe(500); // hugged to child
        expect(size.height).toBe(720); // fixed
    });

    it('layout centers the world inside the hugged box (stack convention)', () => {
        const child = new Tile(400, 300);
        const camera = new Camera({ children: [child] });
        const size = camera.measure({ maxWidth: 1920, maxHeight: 1080 }, scope);
        camera.layout({ x: 0, y: 0, width: size.width ?? 0, height: size.height ?? 0 }, scope);
        // Stack-laid-out: centered at the container origin.
        expect(child.rect).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
    });
});

describe('Camera – rendering through beginCamera', () => {
    const world = (id: string) => new Rect({ id, width: 40, height: 40 });
    const camera = (props: Record<string, unknown> = {}, ...children: Rect[]) =>
        laidOut(new Camera({ id: 'cam', width: 300, height: 200, ...props, children } as never), { x: 0, y: 0, width: 300, height: 200 });

    it('draws its card, then its world through the camera, then its stroke', () => {
        const ctx = recorded(camera({ fill: 'red', stroke: { weight: 2, fill: 'blue' } }, world('w')));
        expect(ctx.events).toEqual([
            'begin:cam', 'transform', 'draw:rect+shadow+fill',
            'beginCamera', 'begin:w', 'transform', 'draw:rect+shadow+fill', 'end', 'endCamera',
            'draw:rect+stroke', 'end',
        ]);
    });

    it('opens its camera even at rest, unlike the stage, which skips an identity camera', () => {
        const node = camera({}, world('w'));
        expect(node.zoom).toBe(1);
        expect(node.heading).toBe(0);
        expect(node.lookAt).toEqual({ x: 0, y: 0 });
        expect(recorded(node).events).toContain('beginCamera');
        expect(node._cameraScope()).toEqual({ lookAt: { x: 0, y: 0 }, zoom: 1, heading: 0 });
    });

    it('hands the camera its viewport, lookAt, zoom and heading', () => {
        const ctx = recorded(camera({ zoom: 2, heading: 30, lookAt: { x: 40, y: -20 } }, world('w')));
        expect(ctx.cameras).toEqual([{
            viewport: { x: 0, y: -0, width: 300, height: 200 },
            lookAt: { x: 40, y: -20 },
            zoom: 2,
            heading: 30,
        }]);
    });

    it('puts the viewport at its laid-out position, y flipped', () => {
        const node = laidOut(new Camera({ id: 'cam', children: [world('w')] } as never), { x: 15, y: 30, width: 300, height: 200 });
        expect(recorded(node).cameras[0].viewport).toEqual({ x: 15, y: -30, width: 300, height: 200 });
    });

    it('renders every world child inside the one camera, in order, and ends it', () => {
        const ctx = recorded(camera({}, world('a'), world('b'), world('c')));
        const inside = ctx.between('beginCamera', 'endCamera').filter((e) => e.startsWith('begin:'));
        expect(inside).toEqual(['begin:a', 'begin:b', 'begin:c']);
        expect(ctx.events.filter((e) => e === 'beginCamera')).toHaveLength(1);
        expect(ctx.unbalanced).toEqual({});
    });

    it('opens its camera with no world at all, and still ends it', () => {
        const ctx = recorded(camera({}));
        expect(ctx.events).toContain('beginCamera');
        expect(ctx.events).toContain('endCamera');
        expect(ctx.unbalanced).toEqual({});
    });

    it('keeps the card outside the camera: its fill is drawn before it opens', () => {
        const events = recorded(camera({ fill: 'red' }, world('w'))).events;
        expect(events.indexOf('draw:rect+shadow+fill')).toBeLessThan(events.indexOf('beginCamera'));
    });

    it('paints its overlay after the world has left the camera, under the stroke', () => {
        const events = recorded(camera({ overlay: 'blue', stroke: { weight: 1, fill: 'red' } }, world('w'))).events;
        const end = events.indexOf('endCamera');
        expect(events.slice(end + 1)).toEqual(['draw:rect+fill', 'draw:rect+stroke', 'end']);
    });

    it('also clips its card outline around the camera when `clip` is on', () => {
        const ctx = recorded(camera({ clip: true }, world('w')));
        const events = ctx.events;
        expect(events.indexOf('beginClip')).toBeLessThan(events.indexOf('beginCamera'));
        expect(events.indexOf('endClip')).toBeGreaterThan(events.indexOf('endCamera'));
        expect(ctx.unbalanced).toEqual({});
    });

    it('opens no clip of its own unless asked: the renderer\'s camera scope clips to the viewport itself', () => {
        expect(recorded(camera({}, world('w'))).events).not.toContain('beginClip');
    });

    it('keeps its world flat inside a space, whatever space the card sits in', () => {
        expect(camera({})._rendersChildrenInSpace()).toBe(false);
    });
});

describe('Camera – viewport commands', () => {
    const live = (props: Record<string, unknown> = {}) => attached(new Camera({ width: 300, height: 200, ...props } as never));

    it('zoomTo animates zoom', () => {
        const node = live();
        const command = node.zoomTo({ data: { zoom: 3 }, duration: 2 });
        command.at(0);
        expect(node.zoom).toBe(1);
        command.at(0.5);
        expect(node.zoom).toBe(2);
        command.at(1);
        expect(node.zoom).toBe(3);
    });

    it('panTo animates lookAt, both axes', () => {
        const node = live();
        const command = node.panTo({ data: { lookAt: { x: 100, y: -60 } }, duration: 1 });
        command.at(0.5);
        expect(node.lookAt).toEqual({ x: 50, y: -30 });
        command.at(1);
        expect(node.lookAt).toEqual({ x: 100, y: -60 });
    });

    it('headingTo animates heading', () => {
        const node = live({ heading: 20 });
        const command = node.headingTo({ data: { heading: 60 }, duration: 1 });
        command.at(0.5);
        expect(node.heading).toBe(40);
    });

    it('is a function of t, so a seek back lands on the same value', () => {
        const node = live();
        const command = node.zoomTo({ data: { zoom: 5 }, duration: 1 });
        command.at(1);
        command.at(0.25);
        expect(node.zoom).toBe(2);
    });

    it('carries the command\'s duration, and writes nothing while the node is not in a scene', () => {
        const node = new Camera({ width: 300, height: 200 } as never);
        const command = node.zoomTo({ data: { zoom: 3 }, duration: 2 });
        expect(command.duration).toBe(2);
        command.at(1);
        expect(node.zoom).toBe(1);
    });

    it('moves the camera the next render hands the renderer', () => {
        const node = laidOut(new Camera({ id: 'cam', width: 300, height: 200 } as never), { x: 0, y: 0, width: 300, height: 200 });
        node.zoomTo({ data: { zoom: 4 }, duration: 1 }).at(1);
        node.panTo({ data: { lookAt: { x: 9, y: 8 } }, duration: 1 }).at(1);
        node.headingTo({ data: { heading: 90 }, duration: 1 }).at(1);
        expect(recorded(node).cameras[0]).toMatchObject({ zoom: 4, lookAt: { x: 9, y: 8 }, heading: 90 });
    });
});

describe('Camera – following a node', () => {
    const view = (props: Record<string, unknown>, ...children: Node2D[]) =>
        laidOut(new Camera({ id: 'cam', width: 300, height: 200, ...props, children } as never), { x: 0, y: 0, width: 300, height: 200 });
    const dot = (id: string, x: number, y: number) => new Rect({ id, width: 10, height: 10, x, y } as never) as unknown as Node2D;

    it('aims at the node it follows, wherever that is in its world', () => {
        const nested = new Rect({ id: 'group', width: 100, height: 100, x: 50, y: 0, flow: 'freeform', children: [dot('d', 20, 30)] } as never);
        const ctx = recorded(view({ follow: 'd' }, nested as unknown as Node2D));
        expect(ctx.cameras[0].lookAt).toEqual({ x: 70, y: 30 });
    });

    it('reads lookAt as an offset from it', () => {
        const ctx = recorded(view({ follow: 'd', lookAt: { x: -5, y: 8 } }, dot('d', 40, -10)));
        expect(ctx.cameras[0].lookAt).toEqual({ x: 35, y: -2 });
    });

    it('goes with the node as it moves, and is not moved by its own view', () => {
        const target = dot('d', 10, 0);
        const camera = view({ follow: 'd', zoom: 3, heading: 40 }, target);
        expect(recorded(camera).cameras[0].lookAt).toEqual({ x: 10, y: 0 });
        (target as unknown as { set(props: object): void }).set({ x: 90 });
        laidOut(camera, { x: 0, y: 0, width: 300, height: 200 });
        expect(recorded(camera).cameras[0].lookAt).toEqual({ x: 90, y: 0 });
    });

    it('falls back to lookAt for a node that is not in its world', () => {
        const ctx = recorded(view({ follow: 'elsewhere', lookAt: { x: 4, y: 2 } }, dot('d', 40, -10)));
        expect(ctx.cameras[0].lookAt).toEqual({ x: 4, y: 2 });
    });
});

