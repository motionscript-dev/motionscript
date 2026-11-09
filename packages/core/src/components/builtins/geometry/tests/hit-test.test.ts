import { describe, it, expect } from 'vitest';
import { Node2D } from '@/components/trees/2d/node2d';
import { Rect, Ellipse, Polygram, Path } from "@/components/builtins/geometry/geometry";
import { Text } from "@/components/builtins/text/text";
import { Canvas2D } from '@/components/trees/root/canvas2d-node';
import { Fills } from '@/attributes/shape/fill/chain';
import { BoxBounds } from '@/layout/bounds';
import { Vector2 } from '@/attributes/layout/vector2';
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import { pickNode } from '@/runtime/node-picking';

/**
 * `Node2D.hitTestSelf` is the seam that decides what "clicking a node" means. The
 * default is the layout box, and a shape component narrows it to the outline it
 * already declares for clipping.
 *
 * Assertions go through `pickNode` rather than poking the protected method, so
 * they pin the behaviour a host actually observes.
 */

const scope = new FakeMeasureContext();

function place(node: Node2D, rect: BoxBounds): void {
    node.layout(rect, scope);
}

/** Put `node` alone under a scene root and hand back a point-tester. */
function laidOut(node: Node2D, size: BoxBounds): (p: Vector2, tolerance?: number) => boolean {
    const root = new Canvas2D({});
    root.add(node);
    place(root, { x: 0, y: 0, width: 800, height: 600 });
    place(node, size);
    return (p, tolerance) => pickNode(root, p, tolerance)?.id === node.id;
}

describe('hitTestSelf – nodes with no declared outline keep the box', () => {
    it('Text hits anywhere in its block box, corners included', () => {
        // Testing glyph outlines would make the trailing whitespace of a short
        // line unclickable; the block box is the selection target.
        const text = new Text({ text: 'hello', width: 200, height: 60 });
        const hits = laidOut(text, { x: 0, y: 0, width: 200, height: 60 });
        expect(hits({ x: 0, y: 0 })).toBe(true);
        expect(hits({ x: 99, y: 29 })).toBe(true);   // box corner
        expect(hits({ x: 101, y: 0 })).toBe(false);
    });

    it('Path falls back to its box — no Bézier winding test is carried', () => {
        const path = new Path({ width: 100, height: 100 });
        const hits = laidOut(path, { x: 0, y: 0, width: 100, height: 100 });
        expect(hits({ x: 49, y: 49 })).toBe(true);
        expect(hits({ x: 51, y: 0 })).toBe(false);
    });
});

describe('hitTestSelf – shapes hit their declared outline', () => {
    it('Ellipse misses at its box corner but hits at its centre', () => {
        // The proof that a shape's clipSelf-derived override is actually
        // reached, rather than shadowed by the base box test.
        const ellipse = new Ellipse({ width: 200, height: 200 });
        const hits = laidOut(ellipse, { x: 0, y: 0, width: 200, height: 200 });
        expect(hits({ x: 0, y: 0 })).toBe(true);
        expect(hits({ x: 95, y: 0 })).toBe(true);
        expect(hits({ x: 95, y: 95 })).toBe(false);   // inside the box, outside the ellipse
    });

    it('Polygram misses in a notch a same-sized Rect would catch', () => {
        const star = new Polygram({ width: 200, height: 200, sides: 6, ratio: 0.4 });
        const hitsStar = laidOut(star, { x: 0, y: 0, width: 200, height: 200 });
        const box = new Rect({ width: 200, height: 200 });
        const hitsBox = laidOut(box, { x: 0, y: 0, width: 200, height: 200 });

        // 60° — straight through a notch — at radius 70, past the notch's own 40.
        const notch = { x: 70 * Math.cos(Math.PI / 3), y: 70 * Math.sin(Math.PI / 3) };
        expect(hitsStar(notch)).toBe(false);
        expect(hitsBox(notch)).toBe(true);
        // The spike above it is still grabbable.
        expect(hitsStar({ x: 0, y: 90 })).toBe(true);
    });

    it('Rect honours its own corner radius', () => {
        const card = new Rect({ width: 200, height: 200, cornerRadius: 60 });
        const hits = laidOut(card, { x: 0, y: 0, width: 200, height: 200 });
        expect(hits({ x: 0, y: 0 })).toBe(true);
        expect(hits({ x: 99, y: 99 })).toBe(false);   // rounded away
        expect(hits({ x: 99, y: 0 })).toBe(true);     // straight edge
    });

    it('an image fill does not narrow the outline: the box is the silhouette', () => {
        // A picture is painted into the rect's fill slot, so what a media node is
        // grabbed by stays the rect. There is no Image node any more; this is the
        // same claim its own test used to make.
        const img = new Rect({ fill: Fills.image('x.png'), width: 100, height: 100 });
        const hits = laidOut(img, { x: 0, y: 0, width: 100, height: 100 });
        expect(hits({ x: 49, y: 49 })).toBe(true);
        expect(hits({ x: 51, y: 0 })).toBe(false);
    });
});
