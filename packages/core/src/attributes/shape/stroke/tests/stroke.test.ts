import { describe, it, expect } from 'vitest';
import {
    resolveStroke, resolveStrokeAlign, resolveStrokeCap, resolveStrokeJoin, strokeOps,
    type StrokeJoin, type StrokeProp,
} from '@/attributes/shape/stroke/stroke';
import { fillOps } from '@/attributes/shape/fill/registry';

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const inner of Object.values(value)) deepFreeze(inner);
    }
    return value;
}

describe('resolveStroke – defaults', () => {
    const stroke = resolveStroke({});

    it('is a 1px stroke of nothing, so a bare `stroke: {}` paints nothing', () => {
        expect(stroke.weight).toBe(1);
        expect(stroke.fill).toEqual(fillOps.resolve('transparent'));
        expect(stroke.fill[0]).toMatchObject({ type: 'solid', color: [0, 0, 0, 0] });
    });

    it('sits inside the shape, butt-capped and mitered', () => {
        expect(stroke.align).toBe(-1);
        expect(stroke.cap).toBe('butt');
        expect(stroke.join).toBe('miter');
        expect(stroke.miterLimit).toBe(4);
    });

    it('has no dash, no dash offset and no end caps of its own', () => {
        expect(stroke.dash).toBeUndefined();
        expect(stroke.dashOffset).toBe(0);
        expect(stroke.startCap).toBeUndefined();
        expect(stroke.endCap).toBeUndefined();
    });

    it('resolves a fill given as a colour string', () => {
        expect(resolveStroke({ fill: 'red' }).fill).toEqual(fillOps.resolve('red'));
    });

    it('resolves a fill given as a chain-style array of layers', () => {
        expect(resolveStroke({ fill: ['red', 'blue'] }).fill).toHaveLength(2);
    });
});

describe('stroke align', () => {
    it('maps the names to -1, 0 and 1', () => {
        expect(resolveStroke({ align: 'inside' }).align).toBe(-1);
        expect(resolveStroke({ align: 'center' }).align).toBe(0);
        expect(resolveStroke({ align: 'outside' }).align).toBe(1);
    });

    it('keeps a number in between as it is', () => {
        expect(resolveStroke({ align: 0.25 }).align).toBe(0.25);
        expect(resolveStroke({ align: -0.5 }).align).toBe(-0.5);
    });

    it('clamps a number to [-1, 1]', () => {
        expect(resolveStroke({ align: 7 }).align).toBe(1);
        expect(resolveStroke({ align: -3 }).align).toBe(-1);
    });

    it('falls back to previous, then to inside, for an unknown name', () => {
        const unknown = 'sideways' as unknown as StrokeProp['align'];
        expect(resolveStroke({ align: unknown }).align).toBe(-1);
        expect(resolveStroke({ align: unknown }, resolveStroke({ align: 0.5 })).align).toBe(0.5);
    });

    it('treats null like unset', () => {
        expect(resolveStrokeAlign(null as unknown as undefined, 0.3)).toBe(0.3);
        expect(resolveStrokeAlign(undefined, 0.3)).toBe(0.3);
    });
});

describe('stroke dash', () => {
    it('turns a single number into an even pair', () => {
        expect(resolveStroke({ dash: 6 }).dash).toEqual([6, 6]);
    });

    it('turns a one-entry array into an even pair, too', () => {
        expect(resolveStroke({ dash: [4] }).dash).toEqual([4, 4]);
    });

    it('keeps a pair, and a longer or odd pattern, as written', () => {
        expect(resolveStroke({ dash: [4, 2] }).dash).toEqual([4, 2]);
        expect(resolveStroke({ dash: [4, 2, 1] }).dash).toEqual([4, 2, 1]);
        expect(resolveStroke({ dash: [4, 2, 1, 3] }).dash).toEqual([4, 2, 1, 3]);
    });

    it('keeps an empty array as an empty pattern, not as no dash', () => {
        expect(resolveStroke({ dash: [] }).dash).toEqual([]);
    });

    it('reads a dash offset, and defaults it to 0', () => {
        expect(resolveStroke({ dash: 4, dashOffset: 3 }).dashOffset).toBe(3);
        expect(resolveStroke({ dash: 4 }).dashOffset).toBe(0);
    });
});

describe('stroke cap and join', () => {
    it('accepts the three caps and the three joins', () => {
        for (const cap of ['butt', 'round', 'square'] as const) expect(resolveStroke({ cap }).cap).toBe(cap);
        for (const join of ['miter', 'round', 'bevel'] as const) expect(resolveStroke({ join }).join).toBe(join);
    });

    it('falls back for an unknown cap, to previous and then to butt', () => {
        const cap = 'pointy' as unknown as StrokeProp['cap'];
        expect(resolveStroke({ cap }).cap).toBe('butt');
        expect(resolveStroke({ cap }, resolveStroke({ cap: 'round' })).cap).toBe('round');
        expect(resolveStrokeCap(cap, 'square')).toBe('square');
    });

    it('falls back for an unknown join, to previous and then to miter', () => {
        const join = 'jagged' as unknown as StrokeJoin;
        expect(resolveStroke({ join }).join).toBe('miter');
        expect(resolveStroke({ join }, resolveStroke({ join: 'bevel' })).join).toBe('bevel');
        expect(resolveStrokeJoin(join, 'round')).toBe('round');
    });

    it('lets an unknown end cap follow the stroke\'s own cap', () => {
        const startCap = 'pointy' as unknown as StrokeProp['startCap'];
        expect(resolveStroke({ cap: 'round', startCap }).startCap).toBe('round');
    });

    it('reads a miter limit, and defaults it to 4', () => {
        expect(resolveStroke({ miterLimit: 10 }).miterLimit).toBe(10);
        expect(resolveStroke({}).miterLimit).toBe(4);
    });
});

describe('strokeOps.resolve – array handling', () => {
    it('resolves one prop to one layer', () => {
        expect(strokeOps.resolve({ weight: 3 })).toHaveLength(1);
    });

    it('resolves an array to one layer per entry, in order', () => {
        const layers = strokeOps.resolve([{ weight: 2 }, { weight: 5 }, { weight: 9 }]);
        expect(layers.map((l) => l.weight)).toEqual([2, 5, 9]);
    });

    it('gives nothing for null or undefined, and for an empty array', () => {
        expect(strokeOps.resolve(null as never)).toEqual([]);
        expect(strokeOps.resolve(undefined as never)).toEqual([]);
        expect(strokeOps.resolve([])).toEqual([]);
    });

    it('takes each layer\'s previous from the same index', () => {
        const previous = strokeOps.resolve([{ weight: 2, join: 'round' }, { weight: 5, join: 'bevel' }]);
        const next = strokeOps.resolve([{ weight: 7 }, {}], previous);
        expect(next.map((l) => [l.weight, l.join])).toEqual([[7, 'round'], [5, 'bevel']]);
    });

    it('starts a layer past the end of previous from the defaults', () => {
        const previous = strokeOps.resolve([{ weight: 2, join: 'round' }]);
        const [, second] = strokeOps.resolve([{}, {}], previous);
        expect(second.weight).toBe(1);
        expect(second.join).toBe('miter');
    });
});

describe('strokeOps.resolve – inheritance from previous', () => {
    const previous = resolveStroke({
        weight: 6, dash: [8, 3], dashOffset: 2, fill: 'red', align: 'outside',
        cap: 'round', startCap: 'square', endCap: 'butt', join: 'bevel', miterLimit: 9,
    });

    it('keeps every field a prop leaves out', () => {
        expect(resolveStroke({}, previous)).toEqual(previous);
    });

    it('carries the weight', () => {
        expect(resolveStroke({ dash: 4 }, previous).weight).toBe(6);
    });

    it('carries the dash and its offset', () => {
        const next = resolveStroke({ weight: 1 }, previous);
        expect(next.dash).toEqual([8, 3]);
        expect(next.dashOffset).toBe(2);
    });

    it('carries the fill', () => {
        expect(resolveStroke({ weight: 1 }, previous).fill).toBe(previous.fill);
    });

    it('carries the join and the miter limit', () => {
        const next = resolveStroke({ weight: 1 }, previous);
        expect(next.join).toBe('bevel');
        expect(next.miterLimit).toBe(9);
    });

    it('carries the align and the caps', () => {
        const next = resolveStroke({ weight: 1 }, previous);
        expect(next.align).toBe(1);
        expect([next.cap, next.startCap, next.endCap]).toEqual(['round', 'square', 'butt']);
    });

    it('lets a prop override each field it names', () => {
        const next = resolveStroke({ weight: 2, dash: 5, fill: 'blue', join: 'round' }, previous);
        expect(next.weight).toBe(2);
        expect(next.dash).toEqual([5, 5]);
        expect(next.join).toBe('round');
        expect(next.fill).toEqual(fillOps.resolve('blue'));
    });
});

describe('strokeOps – idempotence and purity', () => {
    const prop: StrokeProp = {
        weight: 3, dash: [4], dashOffset: 1, fill: ['red', 'blue'], align: 'center',
        cap: 'round', endCap: 'square', join: 'bevel', miterLimit: 2,
    };

    it('resolves an already-resolved stroke to an equal one', () => {
        const [once] = strokeOps.resolve(prop);
        const [twice] = strokeOps.resolve(once);
        expect(twice).toEqual(once);
    });

    it('is stable from the second resolve on, through arrays', () => {
        const once = strokeOps.resolve([prop, { weight: 8 }]);
        expect(strokeOps.resolve(once)).toEqual(once);
    });

    it('does not write to the prop or to previous', () => {
        const frozenProp = deepFreeze({ ...prop, dash: [4, 2], fill: ['red', 'blue'] });
        const previous = deepFreeze(strokeOps.resolve({ weight: 2, dash: [1, 1] }));
        expect(() => strokeOps.resolve(frozenProp, previous)).not.toThrow();
        expect(() => resolveStroke(frozenProp, previous[0])).not.toThrow();
    });

    it('does not write to the strokes it interpolates', () => {
        const from = deepFreeze(strokeOps.resolve({ weight: 2, dash: [4, 4], fill: 'red' }));
        const to = deepFreeze(strokeOps.resolve({ weight: 10, dash: [8, 2, 1], fill: 'blue' }));
        expect(() => strokeOps.lerp(from, to, 0.5)).not.toThrow();
    });

    it('returns a new array and new layers rather than aliasing its inputs', () => {
        const from = strokeOps.resolve({ weight: 2 });
        const to = strokeOps.resolve({ weight: 4 });
        const mid = strokeOps.lerp(from, to, 0.5);
        expect(mid).not.toBe(from);
        expect(mid[0]).not.toBe(from[0]);
        expect(mid[0]).not.toBe(to[0]);
    });
});

describe('strokeOps.lerp', () => {
    const at = (a: StrokeProp, b: StrokeProp, t: number) => strokeOps.lerp(strokeOps.resolve(a), strokeOps.resolve(b), t)[0];

    it('tweens the weight', () => {
        expect(at({ weight: 2 }, { weight: 10 }, 0.5).weight).toBe(6);
        expect(at({ weight: 2 }, { weight: 10 }, 0).weight).toBe(2);
        expect(at({ weight: 2 }, { weight: 10 }, 1).weight).toBe(10);
    });

    it('tweens the dash offset, the align and the miter limit', () => {
        const mid = at(
            { dashOffset: 0, align: 'inside', miterLimit: 2 },
            { dashOffset: 10, align: 'outside', miterLimit: 6 },
            0.5,
        );
        expect(mid.dashOffset).toBe(5);
        expect(mid.align).toBe(0);
        expect(mid.miterLimit).toBe(4);
    });

    it('tweens a dash entry by entry, padding the shorter side with 0', () => {
        expect(at({ dash: [4, 4] }, { dash: [8, 8, 8] }, 0.5).dash).toEqual([6, 6, 4]);
        expect(at({ dash: [4, 4] }, { dash: [8, 8, 8] }, 1).dash).toEqual([8, 8, 8]);
    });

    it('grows a dash from nothing by padding with 0', () => {
        expect(at({}, { dash: [8, 8] }, 0.5).dash).toEqual([4, 4]);
    });

    it('leaves the dash unset when neither side has one', () => {
        expect(at({ weight: 1 }, { weight: 2 }, 0.5).dash).toBeUndefined();
    });

    it('tweens the fill through the fill attribute', () => {
        const mid = at({ fill: 'black' }, { fill: 'white' }, 0.5);
        expect(mid.fill).toEqual(fillOps.lerp(fillOps.resolve('black'), fillOps.resolve('white'), 0.5));
    });

    it('snaps cap, end caps and join at the midpoint', () => {
        const a: StrokeProp = { cap: 'butt', startCap: 'round', join: 'miter' };
        const b: StrokeProp = { cap: 'square', startCap: 'butt', join: 'bevel' };
        expect([at(a, b, 0.49).cap, at(a, b, 0.49).startCap, at(a, b, 0.49).join]).toEqual(['butt', 'round', 'miter']);
        expect([at(a, b, 0.5).cap, at(a, b, 0.5).startCap, at(a, b, 0.5).join]).toEqual(['square', 'butt', 'bevel']);
    });

    it('returns the very same array when from is to', () => {
        const same = strokeOps.resolve({ weight: 3 });
        expect(strokeOps.lerp(same, same, 0.5)).toBe(same);
    });

    it('carries a layer the other side lacks, unchanged and un-faded', () => {
        const one = strokeOps.resolve({ weight: 3 });
        const two = strokeOps.resolve([{ weight: 5 }, { weight: 7 }]);
        const grown = strokeOps.lerp(one, two, 0.25);
        expect(grown).toHaveLength(2);
        expect(grown[1]).toBe(two[1]);
        const shrunk = strokeOps.lerp(two, one, 0.25);
        expect(shrunk).toHaveLength(2);
        expect(shrunk[1]).toBe(two[1]);
    });

    it('tweens an empty array to a layer by taking the layer as it is', () => {
        const to = strokeOps.resolve({ weight: 4 });
        expect(strokeOps.lerp([], to, 0.5)[0]).toBe(to[0]);
    });
});
