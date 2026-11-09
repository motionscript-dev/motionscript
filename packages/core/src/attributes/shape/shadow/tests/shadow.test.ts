import { describe, it, expect } from 'vitest';
import { resolveShadow, shadowOps, type ShadowProp } from '@/attributes/shape/shadow/shadow';
import { fillOps } from '@/attributes/shape/fill/registry';

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const inner of Object.values(value)) deepFreeze(inner);
    }
    return value;
}

describe('resolveShadow – defaults', () => {
    const shadow = resolveShadow({});

    it('is a sharp, unshifted, outer shadow of nothing', () => {
        expect(shadow.blur).toBe(0);
        expect(shadow.spread).toBe(0);
        expect(shadow.inner).toBe(false);
        expect(shadow.fill).toEqual(fillOps.resolve('transparent'));
    });

    it('leaves the offset unset rather than resolving it to the origin', () => {
        expect(shadow.offset).toBeUndefined();
        expect('offset' in shadow).toBe(true);
    });

    it('reads blur, offset and inner as given', () => {
        const resolved = resolveShadow({ blur: 12, offset: { x: 3, y: -4 }, inner: true });
        expect(resolved).toMatchObject({ blur: 12, offset: { x: 3, y: -4 }, inner: true });
    });
});

describe('shadow offset', () => {
    it('carries from previous when unspecified', () => {
        const previous = resolveShadow({ offset: { x: 5, y: 7 } });
        expect(resolveShadow({ blur: 4 }, previous).offset).toEqual({ x: 5, y: 7 });
    });

    it('is replaced by one given', () => {
        const previous = resolveShadow({ offset: { x: 5, y: 7 } });
        expect(resolveShadow({ offset: { x: 1, y: 2 } }, previous).offset).toEqual({ x: 1, y: 2 });
    });

    it('tweens componentwise', () => {
        const from = shadowOps.resolve({ offset: { x: 0, y: 0 } });
        const to = shadowOps.resolve({ offset: { x: 20, y: -10 } });
        expect(shadowOps.lerp(from, to, 0.5)[0].offset).toEqual({ x: 10, y: -5 });
    });

    it('tweens from an unset offset as if it were the origin', () => {
        const from = shadowOps.resolve({ blur: 2 });
        const to = shadowOps.resolve({ offset: { x: 20, y: 10 } });
        expect(shadowOps.lerp(from, to, 0.5)[0].offset).toEqual({ x: 10, y: 5 });
        expect(shadowOps.lerp(to, from, 0.5)[0].offset).toEqual({ x: 10, y: 5 });
    });

    it('settles on an explicit origin when neither side has an offset', () => {
        const mid = shadowOps.lerp(shadowOps.resolve({ blur: 2 }), shadowOps.resolve({ blur: 6 }), 0.5)[0];
        expect(mid.offset).toEqual({ x: 0, y: 0 });
    });
});

describe('shadow blur', () => {
    it('carries from previous when unspecified', () => {
        expect(resolveShadow({}, resolveShadow({ blur: 9 })).blur).toBe(9);
    });

    it('tweens linearly', () => {
        const from = shadowOps.resolve({ blur: 0 });
        const to = shadowOps.resolve({ blur: 24 });
        expect(shadowOps.lerp(from, to, 0.25)[0].blur).toBe(6);
        expect(shadowOps.lerp(from, to, 1)[0].blur).toBe(24);
    });
});

describe('shadow fill', () => {
    it('resolves a colour string', () => {
        const shadow = resolveShadow({ fill: 'black/40' });
        expect(shadow.fill).toEqual(fillOps.resolve('black/40'));
        expect(shadow.fill[0]).toMatchObject({ type: 'solid', color: [0, 0, 0, 0.4] });
    });

    it('resolves an object fill and keeps its opacity on the fill, not on the shadow', () => {
        const shadow = resolveShadow({ fill: { type: 'solid', color: 'red', opacity: 0.5 } });
        expect(shadow.fill[0]).toMatchObject({ type: 'solid', opacity: 0.5 });
    });

    it('resolves several layers, painted bottom to top', () => {
        const shadow = resolveShadow({ fill: ['red', 'blue'] });
        expect(shadow.fill).toHaveLength(2);
        expect(shadow.fill[1]).toEqual(fillOps.resolve('blue')[0]);
    });

    it('carries from previous when unspecified', () => {
        const previous = resolveShadow({ fill: 'red' });
        expect(resolveShadow({ blur: 3 }, previous).fill).toBe(previous.fill);
    });

    it('tweens through the fill attribute', () => {
        const from = shadowOps.resolve({ fill: 'black' });
        const to = shadowOps.resolve({ fill: 'white' });
        expect(shadowOps.lerp(from, to, 0.5)[0].fill).toEqual(fillOps.lerp(from[0].fill, to[0].fill, 0.5));
    });
});

describe('shadow opacity', () => {
    it('is not a shadow prop: it is ignored, not folded into the fill', () => {
        const withOpacity = resolveShadow({ blur: 4, fill: 'red', opacity: 0.25 } as ShadowProp & { opacity: number });
        const without = resolveShadow({ blur: 4, fill: 'red' });
        expect(withOpacity).toEqual(without);
        expect('opacity' in withOpacity).toBe(false);
    });
});

describe('shadowOps – array handling', () => {
    it('resolves one prop to one layer', () => {
        expect(shadowOps.resolve({ blur: 3 })).toHaveLength(1);
    });

    it('resolves an array to one layer per entry, in order', () => {
        expect(shadowOps.resolve([{ blur: 1 }, { blur: 2 }, { blur: 3 }]).map((s) => s.blur)).toEqual([1, 2, 3]);
    });

    it('gives nothing for null, undefined or an empty array', () => {
        expect(shadowOps.resolve(null as never)).toEqual([]);
        expect(shadowOps.resolve(undefined as never)).toEqual([]);
        expect(shadowOps.resolve([])).toEqual([]);
    });

    it('takes each layer\'s previous from the same index', () => {
        const previous = shadowOps.resolve([{ blur: 4, spread: 2 }, { blur: 8, inner: true }]);
        const next = shadowOps.resolve([{}, { blur: 1 }], previous);
        expect(next.map((s) => [s.blur, s.spread, s.inner])).toEqual([[4, 2, false], [1, 0, true]]);
    });
});

describe('shadowOps – idempotence and purity', () => {
    const prop: ShadowProp = { blur: 8, offset: { x: 2, y: 3 }, fill: ['black/40', 'red'], inner: true, spread: 5 };

    it('resolves an already-resolved shadow to an equal one', () => {
        const [once] = shadowOps.resolve(prop);
        expect(shadowOps.resolve(once)[0]).toEqual(once);
    });

    it('is stable from the second resolve on, through arrays', () => {
        const once = shadowOps.resolve([prop, { blur: 1 }]);
        expect(shadowOps.resolve(once)).toEqual(once);
    });

    it('does not write to the prop or to previous', () => {
        const frozen = deepFreeze({ ...prop, offset: { x: 2, y: 3 }, fill: ['black/40', 'red'] });
        const previous = deepFreeze(shadowOps.resolve({ blur: 2, offset: { x: 1, y: 1 } }));
        expect(() => shadowOps.resolve(frozen, previous)).not.toThrow();
    });

    it('does not write to the shadows it interpolates', () => {
        const from = deepFreeze(shadowOps.resolve({ blur: 2, offset: { x: 1, y: 1 }, fill: 'red' }));
        const to = deepFreeze(shadowOps.resolve({ blur: 9, offset: { x: 4, y: 4 }, fill: 'blue' }));
        expect(() => shadowOps.lerp(from, to, 0.5)).not.toThrow();
    });

    it('returns the very same array when from is to', () => {
        const same = shadowOps.resolve({ blur: 3 });
        expect(shadowOps.lerp(same, same, 0.5)).toBe(same);
    });
});

describe('shadowOps.lerp – inner and one-sided layers', () => {
    it('keeps the start\'s inner/outer kind until the tween completes', () => {
        const from = shadowOps.resolve({ inner: false });
        const to = shadowOps.resolve({ inner: true });
        expect(shadowOps.lerp(from, to, 0.5)[0].inner).toBe(false);
        expect(shadowOps.lerp(from, to, 0.99)[0].inner).toBe(false);
        expect(shadowOps.lerp(from, to, 1)[0].inner).toBe(true);
    });

    it('carries a layer the other side lacks, unchanged', () => {
        const one = shadowOps.resolve({ blur: 3 });
        const two = shadowOps.resolve([{ blur: 5 }, { blur: 7 }]);
        const grown = shadowOps.lerp(one, two, 0.25);
        expect(grown).toHaveLength(2);
        expect(grown[1]).toBe(two[1]);
        const shrunk = shadowOps.lerp(two, one, 0.25);
        expect(shrunk).toHaveLength(2);
        expect(shrunk[1]).toBe(two[1]);
    });

    it('takes a layer as it is when the other side is empty', () => {
        const to = shadowOps.resolve({ blur: 4 });
        expect(shadowOps.lerp([], to, 0.5)[0]).toBe(to[0]);
        expect(shadowOps.lerp(to, [], 0.5)[0]).toBe(to[0]);
    });
});
