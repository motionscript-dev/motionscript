import { describe, it, expect } from 'vitest';
import { alignmentOps } from '@/attributes/layout/alignment';

describe('alignmentOps.resolve', () => {
    it('maps named positions to per-axis pivots (y-up: +1 top, -1 bottom)', () => {
        expect(alignmentOps.resolve('center')).toEqual({ x: 0, y: 0 });
        expect(alignmentOps.resolve('topLeft')).toEqual({ x: -1, y: 1 });
        expect(alignmentOps.resolve('topRight')).toEqual({ x: 1, y: 1 });
        expect(alignmentOps.resolve('bottomLeft')).toEqual({ x: -1, y: -1 });
        expect(alignmentOps.resolve('bottomRight')).toEqual({ x: 1, y: -1 });
        expect(alignmentOps.resolve('topCenter')).toEqual({ x: 0, y: 1 });
        expect(alignmentOps.resolve('bottomCenter')).toEqual({ x: 0, y: -1 });
        expect(alignmentOps.resolve('centerLeft')).toEqual({ x: -1, y: 0 });
        expect(alignmentOps.resolve('centerRight')).toEqual({ x: 1, y: 0 });
    });

    it('passes an explicit Vector2 through unchanged', () => {
        expect(alignmentOps.resolve({ x: -1, y: 0.5 })).toEqual({ x: -1, y: 0.5 });
    });

    it('returns a fresh object for both forms (no shared/mutable references)', () => {
        const named = alignmentOps.resolve('center');
        named.x = 99;
        expect(alignmentOps.resolve('center')).toEqual({ x: 0, y: 0 });

        const input = { x: 1, y: 1 };
        const out = alignmentOps.resolve(input);
        expect(out).not.toBe(input);
    });

    it('throws on an unknown named position', () => {
        // @ts-expect-error – not an AlignmentKey
        expect(() => alignmentOps.resolve('middle')).toThrow(/Unknown alignment value/);
    });
});

describe('alignmentOps.keys / isKey', () => {
    it('lists the nine keys in reading order, top-left to bottom-right', () => {
        expect(alignmentOps.keys).toEqual([
            'topLeft', 'topCenter', 'topRight',
            'centerLeft', 'center', 'centerRight',
            'bottomLeft', 'bottomCenter', 'bottomRight',
        ]);
    });

    it('rejects the names Object.prototype carries, as isKey does', () => {
        for (const name of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
            expect(alignmentOps.isKey(name)).toBe(false);
            expect(() => alignmentOps.resolve(name as never)).toThrow(/Unknown alignment value/);
        }
    });

    it('accepts exactly the strings resolve accepts', () => {
        for (const key of alignmentOps.keys) {
            expect(alignmentOps.isKey(key)).toBe(true);
            expect(() => alignmentOps.resolve(key)).not.toThrow();
        }
        for (const value of ['middle', 'toString', '', null, undefined, 3, { x: 0, y: 0 }]) {
            expect(alignmentOps.isKey(value)).toBe(false);
        }
    });
});

describe('alignmentOps.validateProps', () => {
    it('accepts props with no alignment at all', () => {
        expect(() => alignmentOps.validateProps({})).not.toThrow();
        expect(() => alignmentOps.validateProps({ x: 1, width: 100 })).not.toThrow();
    });

    it('accepts one alignment prop', () => {
        for (const key of alignmentOps.keys) {
            expect(() => alignmentOps.validateProps({ [key]: { x: 0, y: 0 } })).not.toThrow();
        }
    });

    it('accepts a pivot on its own', () => {
        expect(() => alignmentOps.validateProps({ pivot: 'center' })).not.toThrow();
    });

    it('throws for two alignment props, naming them in reading order whatever order they were given', () => {
        expect(() => alignmentOps.validateProps({ center: 1, topLeft: 2 }))
            .toThrow('Cannot set multiple alignment props at once: topLeft, center');
        expect(() => alignmentOps.validateProps({ bottomRight: 1, topCenter: 1, centerLeft: 1 }))
            .toThrow('Cannot set multiple alignment props at once: topCenter, centerLeft, bottomRight');
    });

    it('throws for an alignment prop beside a pivot, naming the alignment', () => {
        expect(() => alignmentOps.validateProps({ topRight: { x: 0, y: 0 }, pivot: 'center' }))
            .toThrow("Cannot set both alignment prop 'topRight' and 'pivot' at the same time");
    });

    it('reports the several-alignments error before the pivot one', () => {
        expect(() => alignmentOps.validateProps({ center: 1, topLeft: 2, pivot: 'center' }))
            .toThrow(/multiple alignment props/);
    });

    it('takes an alignment prop given as undefined as absent', () => {
        expect(() => alignmentOps.validateProps({ topLeft: undefined, center: { x: 0, y: 0 } })).not.toThrow();
        expect(() => alignmentOps.validateProps({ topLeft: undefined, pivot: 'center' })).not.toThrow();
        expect(() => alignmentOps.validateProps({ center: { x: 0, y: 0 }, pivot: undefined })).not.toThrow();
    });

    it('takes an alignment prop given as null as present', () => {
        expect(() => alignmentOps.validateProps({ topLeft: null, center: null })).toThrow(/multiple alignment props/);
        expect(() => alignmentOps.validateProps({ topLeft: null, pivot: 'center' })).toThrow(/and 'pivot'/);
    });

    it('does not write to the props it checks', () => {
        const props = Object.freeze({ topLeft: { x: 1, y: 1 }, x: 4 });
        expect(() => alignmentOps.validateProps(props)).not.toThrow();
    });
});

describe('alignmentOps.findKey', () => {
    it('finds the alignment prop that is present', () => {
        for (const key of alignmentOps.keys) {
            expect(alignmentOps.findKey({ x: 1, [key]: { x: 0, y: 0 } })).toBe(key);
        }
    });

    it('finds nothing when there is none', () => {
        expect(alignmentOps.findKey({})).toBeUndefined();
        expect(alignmentOps.findKey({ x: 1, pivot: 'center', align: 'center' })).toBeUndefined();
    });

    it('takes the first in reading order when several are present, not the first given', () => {
        expect(alignmentOps.findKey({ center: 1, topLeft: 2 })).toBe('topLeft');
        expect(alignmentOps.findKey({ bottomRight: 1, centerLeft: 2 })).toBe('centerLeft');
    });

    it('reads in the same order as alignmentOps.keys', () => {
        const everything = Object.fromEntries([...alignmentOps.keys].reverse().map((key) => [key, 1]));
        const order: string[] = [];
        const remaining: Record<string, number> = { ...everything };
        for (let i = 0; i < alignmentOps.keys.length; i++) {
            const key = alignmentOps.findKey(remaining)!;
            order.push(key);
            delete remaining[key];
        }
        expect(order).toEqual([...alignmentOps.keys]);
    });

    it('skips a key given as undefined, but not one given as null or 0', () => {
        expect(alignmentOps.findKey({ topLeft: undefined, center: 1 })).toBe('center');
        expect(alignmentOps.findKey({ topLeft: null })).toBe('topLeft');
        expect(alignmentOps.findKey({ bottomRight: 0 })).toBe('bottomRight');
    });
});

describe('alignmentOps.resolveTargetOnce', () => {
    const rect = { x: 500, y: -300, width: 100, height: 40 };

    it('puts the node\'s centre on the target for a centre alignment', () => {
        expect(alignmentOps.resolveTargetOnce('center', rect, { x: 70, y: 30 })).toEqual({
            pivot: { x: 0, y: 0 }, x: 70, y: 30,
        });
    });

    it('returns the pivot the alignment names', () => {
        for (const key of alignmentOps.keys) {
            expect(alignmentOps.resolveTargetOnce(key, rect, { x: 0, y: 0 }).pivot).toEqual(alignmentOps.resolve(key));
        }
    });

    it('moves the centre away from the target by the alignment\'s share of half the size', () => {
        // The node's top-right corner lands on the target: its centre is half a width left and half a height below it.
        expect(alignmentOps.resolveTargetOnce('topRight', rect, { x: 200, y: 100 })).toMatchObject({ x: 150, y: 80 });
        expect(alignmentOps.resolveTargetOnce('bottomLeft', rect, { x: 200, y: 100 })).toMatchObject({ x: 250, y: 120 });
        expect(alignmentOps.resolveTargetOnce('topCenter', rect, { x: 200, y: 100 })).toMatchObject({ x: 200, y: 80 });
        expect(alignmentOps.resolveTargetOnce('centerRight', rect, { x: 200, y: 100 })).toMatchObject({ x: 150, y: 100 });
    });

    it('reads only the size of the rect, not where it sits', () => {
        const here = alignmentOps.resolveTargetOnce('topRight', rect, { x: 10, y: 10 });
        const there = alignmentOps.resolveTargetOnce('topRight', { ...rect, x: -9000, y: 9000 }, { x: 10, y: 10 });
        expect(there).toEqual(here);
    });

    it('is a plain translation for a rect of no size', () => {
        expect(alignmentOps.resolveTargetOnce('bottomRight', { x: 0, y: 0, width: 0, height: 0 }, { x: 5, y: 6 }))
            .toMatchObject({ x: 5, y: 6 });
    });

    it('hands back a pivot of its own, so a caller cannot corrupt the table', () => {
        const result = alignmentOps.resolveTargetOnce('topLeft', rect, { x: 0, y: 0 });
        result.pivot.x = 99;
        expect(alignmentOps.resolveTargetOnce('topLeft', rect, { x: 0, y: 0 }).pivot).toEqual({ x: -1, y: 1 });
    });

    it('does not write to the target or the rect', () => {
        const target = Object.freeze({ x: 3, y: 4 });
        const frozen = Object.freeze({ ...rect });
        expect(() => alignmentOps.resolveTargetOnce('center', frozen, target)).not.toThrow();
    });

    it('throws for a key that is not one of the nine', () => {
        expect(() => alignmentOps.resolveTargetOnce('middle' as never, rect, { x: 0, y: 0 })).toThrow(/Unknown alignment value/);
    });
});

describe('alignmentOps.bindTarget', () => {
    it('returns the pivot and a pair of callbacks that agree with the one-shot form', () => {
        const rect = { x: 0, y: 0, width: 100, height: 40 };
        const target = { x: 200, y: 100 };
        const bound = alignmentOps.bindTarget('topRight', () => target, () => rect);
        const once = alignmentOps.resolveTargetOnce('topRight', rect, target);
        expect(bound.pivot).toEqual(once.pivot);
        expect(bound.x()).toBe(once.x);
        expect(bound.y()).toBe(once.y);
    });

    it('re-reads the target on every call, so the node follows a target that moves', () => {
        let target = { x: 0, y: 0 };
        const bound = alignmentOps.bindTarget('center', () => target, () => ({ x: 0, y: 0, width: 10, height: 10 }));
        expect([bound.x(), bound.y()]).toEqual([0, 0]);
        target = { x: 40, y: -20 };
        expect([bound.x(), bound.y()]).toEqual([40, -20]);
    });

    it('re-reads the rect on every call, so the offset follows a node that resizes', () => {
        let rect = { x: 0, y: 0, width: 100, height: 40 };
        const bound = alignmentOps.bindTarget('topRight', () => ({ x: 0, y: 0 }), () => rect);
        expect([bound.x(), bound.y()]).toEqual([-50, -20]);
        rect = { x: 0, y: 0, width: 200, height: 80 };
        expect([bound.x(), bound.y()]).toEqual([-100, -40]);
    });

    it('resolves the alignment once, not on each call', () => {
        const bound = alignmentOps.bindTarget('bottomLeft', () => ({ x: 0, y: 0 }), () => ({ x: 0, y: 0, width: 10, height: 10 }));
        expect(bound.pivot).toEqual({ x: -1, y: -1 });
        expect(bound.pivot).toBe(bound.pivot);
    });

    it('reads neither callback until it is asked for a coordinate', () => {
        let reads = 0;
        const bound = alignmentOps.bindTarget('center', () => { reads++; return { x: 0, y: 0 }; }, () => { reads++; return { x: 0, y: 0, width: 0, height: 0 }; });
        expect(reads).toBe(0);
        bound.x();
        expect(reads).toBe(2);
    });

    it('throws at once for a key that is not one of the nine', () => {
        expect(() => alignmentOps.bindTarget('middle' as never, () => ({ x: 0, y: 0 }), () => ({ x: 0, y: 0, width: 0, height: 0 })))
            .toThrow(/Unknown alignment value/);
    });
});
