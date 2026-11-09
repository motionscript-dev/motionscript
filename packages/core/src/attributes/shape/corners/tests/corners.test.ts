import { describe, it, expect } from 'vitest';
import { cornerRadiusOps, CornerRadiusResolved } from '@/attributes/shape/corners/corner-radius';
import { cornerStyleOps, lerpCornerScalarStyle, type CornerStyleResolved } from '@/attributes/shape/corners/corner-style';

const corners = (tl: number, tr: number, bl: number, br: number): CornerRadiusResolved => ({
    topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br,
});

describe('cornerRadiusOps.isUniformInput', () => {
    it('is true for a number', () => {
        expect(cornerRadiusOps.isUniformInput(8)).toBe(true);
    });

    it('is false for an object', () => {
        expect(cornerRadiusOps.isUniformInput({ topLeft: 8 })).toBe(false);
    });
});

describe('cornerRadiusOps.isUniform', () => {
    it('is true when every corner is equal', () => {
        expect(cornerRadiusOps.isUniform(corners(4, 4, 4, 4))).toBe(true);
    });

    it('is false when a corner differs', () => {
        expect(cornerRadiusOps.isUniform(corners(4, 4, 4, 5))).toBe(false);
    });
});

describe('cornerRadiusOps.isZero', () => {
    it('is true when every corner is 0', () => {
        expect(cornerRadiusOps.isZero(corners(0, 0, 0, 0))).toBe(true);
    });

    it('is false when any corner is non-zero', () => {
        expect(cornerRadiusOps.isZero(corners(0, 0, 0, 1))).toBe(false);
    });
});

describe('cornerRadiusOps.resolve', () => {
    it('expands a number to all four corners', () => {
        expect(cornerRadiusOps.resolve(10)).toEqual(corners(10, 10, 10, 10));
    });

    it('fills missing corners from previous, then 0', () => {
        const previous = corners(1, 2, 3, 4);
        expect(cornerRadiusOps.resolve({ topLeft: 99 }, previous)).toEqual(corners(99, 2, 3, 4));
    });

    it('defaults unspecified corners to 0 with no previous', () => {
        expect(cornerRadiusOps.resolve({ topRight: 5 })).toEqual(corners(0, 5, 0, 0));
    });

    // Axis shorthands — these mappings are part of the public contract, pinned here.
    it('{ top, bottom } sets the top pair and bottom pair', () => {
        expect(cornerRadiusOps.resolve({ top: 10, bottom: 20 })).toEqual(corners(10, 10, 20, 20));
    });

    it('{ top } alone sets only the top corners, rest fall back to 0', () => {
        expect(cornerRadiusOps.resolve({ top: 10 })).toEqual(corners(10, 10, 0, 0));
    });

    it('{ left, right } sets the left pair and right pair', () => {
        // corners(tl, tr, bl, br): left → tl + bl, right → tr + br
        expect(cornerRadiusOps.resolve({ left: 10, right: 20 })).toEqual(corners(10, 20, 10, 20));
    });

    it('per-corner keys take the whole branch when mixed with axis keys', () => {
        // The per-corner form wins outright: the `top` axis value is ignored, so
        // topRight is not set by it and falls back to 0.
        expect(cornerRadiusOps.resolve({ top: 10, topLeft: 99 } as never)).toEqual(corners(99, 0, 0, 0));
    });
});

describe('cornerRadiusOps.lerp', () => {
    it('interpolates each corner independently', () => {
        const from = corners(0, 0, 0, 0);
        const to = corners(10, 20, 30, 40);
        expect(cornerRadiusOps.lerp(from, to, 0.5)).toEqual(corners(5, 10, 15, 20));
    });

    it('returns endpoints at t=0 and t=1', () => {
        const from = corners(1, 2, 3, 4);
        const to = corners(5, 6, 7, 8);
        expect(cornerRadiusOps.lerp(from, to, 0)).toEqual(from);
        expect(cornerRadiusOps.lerp(from, to, 1)).toEqual(to);
    });
});

describe('cornerStyleOps.resolve', () => {
    it('expands a single style to all corners', () => {
        expect(cornerStyleOps.resolve('angled')).toEqual({
            topLeft: 'angled', topRight: 'angled', bottomLeft: 'angled', bottomRight: 'angled',
        });
    });

    it('defaults to rounded for unspecified corners', () => {
        expect(cornerStyleOps.resolve({ topLeft: 'angled' })).toEqual({
            topLeft: 'angled', topRight: 'rounded', bottomLeft: 'rounded', bottomRight: 'rounded',
        });
    });

    it('supports the { top, bottom } shorthand', () => {
        expect(cornerStyleOps.resolve({ top: 'angled' })).toEqual({
            topLeft: 'angled', topRight: 'angled', bottomLeft: 'rounded', bottomRight: 'rounded',
        });
    });
});

describe('cornerStyleOps.lerp', () => {
    it('snaps at the midpoint', () => {
        const from = cornerStyleOps.resolve('rounded');
        const to = cornerStyleOps.resolve('angled');
        expect(cornerStyleOps.lerp(from, to, 0.49).topLeft).toBe('rounded');
        expect(cornerStyleOps.lerp(from, to, 0.5).topLeft).toBe('angled');
    });
});

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const inner of Object.values(value)) deepFreeze(inner);
    }
    return value;
}

describe('cornerRadiusOps.resolve – the less usual inputs', () => {
    it('gives every corner the fallback for an empty object', () => {
        expect(cornerRadiusOps.resolve({})).toEqual(corners(0, 0, 0, 0));
    });

    it('gives every corner of previous for an empty object', () => {
        const previous = corners(1, 2, 3, 4);
        expect(cornerRadiusOps.resolve({}, previous)).toEqual(previous);
        expect(cornerRadiusOps.resolve({}, previous)).not.toBe(previous);
    });

    it('{ right } alone sets only the right pair', () => {
        expect(cornerRadiusOps.resolve({ right: 8 })).toEqual(corners(0, 8, 0, 8));
    });

    it('{ left } alone sets only the left pair', () => {
        expect(cornerRadiusOps.resolve({ left: 8 })).toEqual(corners(8, 0, 8, 0));
    });

    it('{ bottom } alone sets only the bottom pair', () => {
        expect(cornerRadiusOps.resolve({ bottom: 8 })).toEqual(corners(0, 0, 8, 8));
    });

    it('takes the unnamed pair from previous when an axis pair names only one side', () => {
        const previous = corners(1, 2, 3, 4);
        expect(cornerRadiusOps.resolve({ top: 10 }, previous)).toEqual(corners(10, 10, 3, 4));
        expect(cornerRadiusOps.resolve({ right: 10 }, previous)).toEqual(corners(1, 10, 3, 10));
    });

    it('lets an axis pair name both sides and ignore previous altogether', () => {
        expect(cornerRadiusOps.resolve({ top: 1, bottom: 2 }, corners(9, 9, 9, 9))).toEqual(corners(1, 1, 2, 2));
    });

    it('lets a number ignore previous', () => {
        expect(cornerRadiusOps.resolve(4, corners(9, 9, 9, 9))).toEqual(corners(4, 4, 4, 4));
    });

    it('keeps a 0 given on purpose, over previous', () => {
        expect(cornerRadiusOps.resolve({ topLeft: 0 }, corners(5, 5, 5, 5))).toEqual(corners(0, 5, 5, 5));
    });
});

describe('cornerRadiusOps – idempotence and purity', () => {
    it('resolves a resolved value to an equal one', () => {
        for (const input of [8, { top: 4, bottom: 0 }, { right: 3 }, {}] as const) {
            const once = cornerRadiusOps.resolve(input);
            expect(cornerRadiusOps.resolve(once)).toEqual(once);
        }
    });

    it('does not write to its input or to previous', () => {
        const input = deepFreeze({ top: 6 });
        const previous = deepFreeze(corners(1, 2, 3, 4));
        expect(() => cornerRadiusOps.resolve(input, previous)).not.toThrow();
        expect(() => cornerRadiusOps.lerp(previous, deepFreeze(corners(9, 9, 9, 9)), 0.5)).not.toThrow();
    });

    it('returns a fresh object from lerp', () => {
        const from = corners(1, 1, 1, 1);
        expect(cornerRadiusOps.lerp(from, from, 0.5)).not.toBe(from);
    });
});

describe('cornerRadiusOps.isUniform', () => {
    it('compares with Object.is, so 0 and -0 are not uniform', () => {
        expect(cornerRadiusOps.isUniform(corners(0, 0, 0, 0))).toBe(true);
        expect(cornerRadiusOps.isUniform(corners(0, -0, 0, 0))).toBe(false);
        expect(cornerRadiusOps.isUniform(corners(-0, -0, -0, -0))).toBe(true);
    });

    it('counts -0 as zero for isZero, which compares with ===', () => {
        expect(cornerRadiusOps.isZero(corners(0, -0, 0, -0))).toBe(true);
    });
});

describe('cornerStyleOps – the less usual inputs', () => {
    it('gives rounded everywhere for an empty object, and previous when there is one', () => {
        expect(cornerStyleOps.resolve({})).toEqual(cornerStyleOps.resolve('rounded'));
        const previous = cornerStyleOps.resolve('angled');
        expect(cornerStyleOps.resolve({}, previous)).toEqual(previous);
    });

    it('takes an unnamed side from previous', () => {
        const previous = cornerStyleOps.resolve('angled');
        expect(cornerStyleOps.resolve({ left: 'rounded' }, previous)).toEqual({
            topLeft: 'rounded', topRight: 'angled', bottomLeft: 'rounded', bottomRight: 'angled',
        });
    });

    it('resolves a resolved value to an equal one, without writing to it', () => {
        const once = deepFreeze(cornerStyleOps.resolve({ topLeft: 'angled', bottom: 'angled' }));
        expect(cornerStyleOps.resolve(once)).toEqual(once);
    });

    it('is uniform when every corner has the same style', () => {
        expect(cornerStyleOps.isUniform(cornerStyleOps.resolve('angled'))).toBe(true);
        expect(cornerStyleOps.isUniform(cornerStyleOps.resolve({ topLeft: 'angled' }))).toBe(false);
        expect(cornerStyleOps.isUniformInput('angled')).toBe(true);
        expect(cornerStyleOps.isUniformInput({ top: 'angled' } as never)).toBe(false);
    });

    it('snaps each corner on its own at the midpoint', () => {
        const from: CornerStyleResolved = cornerStyleOps.resolve({ topLeft: 'angled' });
        const to: CornerStyleResolved = cornerStyleOps.resolve({ bottomRight: 'angled' });
        const mid = cornerStyleOps.lerp(from, to, 0.5);
        expect(mid).toEqual({ topLeft: 'rounded', topRight: 'rounded', bottomLeft: 'rounded', bottomRight: 'angled' });
    });
});

describe('lerpCornerScalarStyle', () => {
    it('keeps the source until the midpoint and takes the destination from it', () => {
        expect(lerpCornerScalarStyle('rounded', 'angled', 0)).toBe('rounded');
        expect(lerpCornerScalarStyle('rounded', 'angled', 0.49)).toBe('rounded');
        expect(lerpCornerScalarStyle('rounded', 'angled', 0.5)).toBe('angled');
        expect(lerpCornerScalarStyle('rounded', 'angled', 1)).toBe('angled');
    });

    it('goes the other way just the same', () => {
        expect(lerpCornerScalarStyle('angled', 'rounded', 0.4)).toBe('angled');
        expect(lerpCornerScalarStyle('angled', 'rounded', 0.6)).toBe('rounded');
    });

    it('is a no-op between equal styles', () => {
        expect(lerpCornerScalarStyle('angled', 'angled', 0.5)).toBe('angled');
    });
});
