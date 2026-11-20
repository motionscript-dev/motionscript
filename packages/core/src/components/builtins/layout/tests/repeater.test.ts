import { describe, it, expect } from 'vitest';
import { Repeater, repeaterCopies, type RepeaterStep } from "@/components/builtins/layout/repeater";
import { Rect } from "@/components/builtins/geometry/geometry";
import { applyToPoint } from '@/attributes/layout/matrix2d';
import { laidOut, recorded } from '@/components/trees/tests/recording-context.fixtures';

const step = (over: Partial<RepeaterStep> = {}): RepeaterStep => ({
    copies: 3, offset: 0, composite: 'above',
    stepAnchor: { x: 0, y: 0 }, stepPosition: { x: 100, y: 0 }, stepScale: { x: 1, y: 1 }, stepRotation: 0,
    startOpacity: 1, endOpacity: 1,
    ...over,
});

/** Where a copy puts the point `p` (y down, from the repeater's centre). */
const at = (s: RepeaterStep, i: number, p = { x: 0, y: 0 }) => {
    const m = repeaterCopies(s)[i].matrix;
    const q = applyToPoint(m, p);
    return { x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 };
};

describe('repeaterCopies', () => {
    it('moves each copy one more step along the position, y up', () => {
        const s = step({ stepPosition: { x: 50, y: 20 } });
        expect([0, 1, 2].map((i) => at(s, i))).toEqual([{ x: 0, y: 0 }, { x: 50, y: -20 }, { x: 100, y: -40 }]);
    });

    it('turns and scales about the anchor, compounding per copy', () => {
        const s = step({ stepPosition: { x: 0, y: 0 }, stepAnchor: { x: 0, y: -50 }, stepRotation: 90, copies: 3 });
        // The origin swings around (0, 50) in y-down space: a quarter turn clockwise each copy.
        expect(at(s, 1)).toEqual({ x: 50, y: 50 });
        expect(at(s, 2)).toEqual({ x: 0, y: 100 });
        const scaled = step({ stepPosition: { x: 0, y: 0 }, stepScale: { x: 0.5, y: 0.5 } });
        expect(at(scaled, 2, { x: 100, y: 0 })).toEqual({ x: 25, y: 0 });
    });

    it('shifts every copy by the offset, fractional or backwards', () => {
        expect(at(step({ offset: 1 }), 0)).toEqual({ x: 100, y: 0 });
        expect(at(step({ offset: 0.5 }), 0)).toEqual({ x: 50, y: 0 });
        expect(at(step({ offset: -1 }), 0)).toEqual({ x: -100, y: 0 });
        expect(at(step({ offset: 1.5, stepScale: { x: 4, y: 4 }, stepPosition: { x: 0, y: 0 } }), 0, { x: 1, y: 0 })).toEqual({ x: 8, y: 0 });
    });

    it('ramps opacity from the first copy to the last', () => {
        const ops = repeaterCopies(step({ copies: 5, startOpacity: 0, endOpacity: 1 })).map((c) => c.opacity);
        expect(ops).toEqual([0, 0.25, 0.5, 0.75, 1]);
        expect(repeaterCopies(step({ copies: 1, startOpacity: 0.4, endOpacity: 1 }))[0].opacity).toBe(0.4);
    });

    it('fades the last copy in on a fractional count, and draws nothing at zero', () => {
        const copies = repeaterCopies(step({ copies: 2.25 }));
        expect(copies).toHaveLength(3);
        expect(copies[2].opacity).toBeCloseTo(0.25);
        expect(repeaterCopies(step({ copies: 0 }))).toEqual([]);
    });

    it('stacks below by drawing the first copy last', () => {
        const below = repeaterCopies(step({ composite: 'below' }));
        expect(below.map((c) => c.matrix.e)).toEqual([200, 100, 0]);
        expect(repeaterCopies(step()).map((c) => c.matrix.e)).toEqual([0, 100, 200]);
    });
});

describe('Repeater render', () => {
    const repeater = (props: Record<string, unknown>) => laidOut(new Repeater({
        id: 'r', width: 100, height: 100, children: [new Rect({ id: 'a', width: 20, height: 20 })], ...props,
    } as never));

    it('draws its children once per copy, each in a scope of its own', () => {
        const ctx = recorded(repeater({ copies: 4, composite: 'above' }));
        expect(ctx.events.filter((e) => e === 'begin:a')).toHaveLength(4);
        // Its own scope, then one per copy around each pass over the children.
        expect(ctx.events.filter((e) => e === 'begin:r')).toHaveLength(5);
    });

    it('hands each copy its matrix and opacity, isolating only faded copies', () => {
        const ctx = recorded(repeater({ copies: 3, startOpacity: 1, endOpacity: 0.5, composite: 'above' }));
        const copies = ctx.transforms.filter((t) => t.matrix);
        expect(copies.map((t) => t.matrix!.e)).toEqual([0, 100, 200]);
        expect(copies.map((t) => t.opacity)).toEqual([1, 0.75, 0.5]);
        expect(copies.map((t) => t.blend)).toEqual(['pass-through', 'normal', 'normal']);
    });

    it('skips a copy that is fully transparent', () => {
        const ctx = recorded(repeater({ copies: 3, startOpacity: 0, endOpacity: 1, composite: 'above' }));
        expect(ctx.events.filter((e) => e === 'begin:a')).toHaveLength(2);
    });

    it('bounds the ink of every copy', () => {
        const node = repeater({ copies: 3, stepPosition: { x: 100, y: 0 } });
        recorded(node);
        const b = node._localBounds();
        expect(b.width).toBeCloseTo(220);
        expect(b.x).toBeCloseTo(100);
        expect(b.height).toBeCloseTo(20);
    });

    it('defaults to three copies a hundred pixels apart, stacked below', () => {
        const node = repeater({});
        expect(node.copies).toBe(3);
        expect(node.stepPosition).toEqual({ x: 100, y: 0 });
        expect(node.composite).toBe('below');
    });
});
