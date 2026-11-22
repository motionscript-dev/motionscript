import { describe, it, expect } from 'vitest';
import { Parallax, parallaxSpeed } from "@/components/builtins/layout/parallax";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Registry } from "@/document/registry";
import { childPlanePointAt, pickNode } from "@/runtime/node-picking";
import { laidOut, recorded, RecordingContext } from '@/components/trees/tests/recording-context.fixtures';
import type { TileRect } from '@/render/render-context2d';

/** A backend that paints a tile repeated itself, as the renderer does: it records each tile and draws it once. */
class TilingContext extends RecordingContext {
    readonly tiles: { tile: TileRect; cover: TileRect }[] = [];

    override paintTiled(tile: TileRect, cover: TileRect, draw: () => void): boolean {
        this.tiles.push({ tile, cover });
        draw();
        return true;
    }
}

const BOX = { x: 0, y: 0, width: 400, height: 200 };
/** The parallax's own box, y down from its centre: what every tile is painted over. */
const BOX_COVER = { x: -200, y: -100, width: 400, height: 200 };

const layer = (id: string, props: Record<string, unknown> = {}) => new Rect({ id, width: 100, height: 50, ...props } as never);

const parallax = (props: Record<string, unknown>, children = [layer('a')]) =>
    laidOut(new Parallax({ id: 'p', children, ...props } as never), BOX);

/** Where each child was laid out, y down from the parallax's centre. */
const slots = (node: Parallax) => node.children.map((c) => ({ x: c.layoutBounds!.x, y: c.layoutBounds!.y }));

describe('parallaxSpeed', () => {
    it('ramps from the far speed on the first layer to the near speed on the last', () => {
        const s = { farSpeed: 0.2, nearSpeed: 1 };
        [0.2, 0.6, 1].forEach((speed, i) => expect(parallaxSpeed(s, i, 3)).toBeCloseTo(speed));
        expect(parallaxSpeed(s, 0, 1)).toBe(1);
    });
});

describe('Parallax layout', () => {
    it('slides each layer against the scroll by its own share, y up', () => {
        const node = parallax({ scroll: { x: 100, y: 40 }, farSpeed: 0, nearSpeed: 1 }, [layer('a'), layer('b'), layer('c')]);
        expect(slots(node)).toEqual([{ x: 0, y: 0 }, { x: -50, y: 20 }, { x: -100, y: 40 }]);
    });

    it('keeps a wrapped layer within half its width of where it was placed', () => {
        expect(slots(parallax({ scroll: { x: 260, y: 0 }, wrap: 'horizontal' }))[0].x).toBeCloseTo(40);
        // A layer drawn twice its size repeats at twice the distance.
        expect(slots(parallax({ scroll: { x: 260, y: 0 }, wrap: 'horizontal' }, [layer('a', { scale: 2 })]))[0].x).toBeCloseTo(-60);
        expect(slots(parallax({ scroll: { x: 260, y: 0 } }))[0].x).toBeCloseTo(-260);
    });

    it('is picked where a layer slid to', () => {
        const root = parallax({ scroll: { x: 100, y: 0 } });
        expect(pickNode(root, { x: -100, y: 0 })?.id).toBe('a');
        expect(pickNode(root, { x: 0, y: 0 })?.id).not.toBe('a');
    });

    it('puts a child not added yet under a drop, off the front layer\'s shift', () => {
        expect(childPlanePointAt(parallax({ scroll: { x: 100, y: -20 }, nearSpeed: 0.5 }), '', { x: -50, y: 10 })).toEqual({ x: 0, y: 0 });
        // With nothing shifted the children are in plain pixels.
        expect(childPlanePointAt(parallax({}), '', { x: 10, y: 0 })).toBeNull();
    });
});

describe('Parallax render', () => {
    it('hands a backend that repeats tiles one tile per layer, each drawn once', () => {
        const ctx = new TilingContext();
        parallax({ wrap: 'horizontal', scroll: { x: 30, y: 0 } }, [layer('a'), layer('b')]).render(ctx);
        expect(ctx.events.filter((e) => e === 'begin:a')).toHaveLength(1);
        expect(ctx.events.filter((e) => e === 'begin:b')).toHaveLength(1);
        expect(ctx.tiles.map((t) => t.cover)).toEqual([BOX_COVER, BOX_COVER]);
        // The far layer slid 3 px, the near one 30: each tile is its own box across, the parallax's down.
        expect(ctx.tiles.map((t) => t.tile)).toEqual([
            { x: -53, y: -100, width: 100, height: 200 },
            { x: -80, y: -100, width: 100, height: 200 },
        ]);
        const both = new TilingContext();
        parallax({ wrap: 'both' }).render(both);
        expect(both.tiles[0].tile).toEqual({ x: -50, y: -25, width: 100, height: 50 });
    });

    it('draws each layer once without wrap', () => {
        const ctx = recorded(parallax({ scroll: { x: 100, y: 0 } }));
        expect(ctx.events.filter((e) => e === 'begin:a')).toHaveLength(1);
        expect(ctx.transforms.filter((t) => t.matrix)).toHaveLength(0);
    });

    it('tiles a layer edge to edge until the copies cover its box', () => {
        const ctx = recorded(parallax({ wrap: 'horizontal' }));
        expect(ctx.events.filter((e) => e === 'begin:a')).toHaveLength(5);
        expect(ctx.transforms.filter((t) => t.matrix).map((t) => t.matrix!.e)).toEqual([-200, -100, 100, 200]);
        expect(recorded(parallax({ wrap: 'vertical' })).events.filter((e) => e === 'begin:a')).toHaveLength(5);
        expect(recorded(parallax({ wrap: 'both' })).events.filter((e) => e === 'begin:a')).toHaveLength(25);
    });

    it('draws all of one layer\'s copies before the next layer', () => {
        const ctx = recorded(parallax({ wrap: 'horizontal' }, [layer('a'), layer('b')]));
        expect(ctx.events.lastIndexOf('begin:a')).toBeLessThan(ctx.events.indexOf('begin:b'));
        expect(ctx.events.filter((e) => e === 'begin:b')).toHaveLength(5);
    });

    it('keeps its own box as its extent, however far the copies reach', () => {
        const node = parallax({ wrap: 'horizontal', scroll: { x: 30, y: 0 } });
        recorded(node);
        const b = node._localBounds();
        expect(b.width).toBeCloseTo(400);
        expect(b.height).toBeCloseTo(200);
    });
});

describe('Parallax', () => {
    it('fills its parent, back layer at a tenth of the scroll, with no wrap', () => {
        const node = parallax({});
        expect(node.width).toBe('fill');
        expect(node.height).toBe('fill');
        expect(node.scroll).toEqual({ x: 0, y: 0 });
        expect(node.farSpeed).toBe(0.1);
        expect(node.nearSpeed).toBe(1);
        expect(node.wrap).toBe('none');
    });

    it('is offered by the builtins with scrollTo', () => {
        expect(new Registry().commandKeys('parallax')).toContain('scrollTo');
    });
});
