import { describe, it, expect } from 'vitest';
import { insetsOps, InsetsResolved } from '@/attributes/layout/insets';

describe('resolveInsets', () => {
    it('expands a single number to all four sides', () => {
        expect(insetsOps.resolve(8)).toEqual({ left: 8, right: 8, top: 8, bottom: 8 });
    });

    it('uses explicit per-side values', () => {
        expect(insetsOps.resolve({ left: 1, right: 2, top: 3, bottom: 4 })).toEqual({
            left: 1, right: 2, top: 3, bottom: 4,
        });
    });

    it('applies symmetric horizontal/vertical shorthands', () => {
        expect(insetsOps.resolve({ horizontal: 10, vertical: 20 })).toEqual({
            left: 10, right: 10, top: 20, bottom: 20,
        });
    });

    it('prefers an explicit side over the symmetric shorthand', () => {
        expect(insetsOps.resolve({ horizontal: 10, left: 99 })).toEqual({
            left: 99, right: 10, top: 0, bottom: 0,
        });
    });

    it('falls back to previous values when a side is unspecified', () => {
        const previous: InsetsResolved = { left: 5, right: 6, top: 7, bottom: 8 };
        expect(insetsOps.resolve({ left: 1 }, previous)).toEqual({
            left: 1, right: 6, top: 7, bottom: 8,
        });
    });

    it('defaults to 0 when neither side, shorthand, nor previous is given', () => {
        expect(insetsOps.resolve({})).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    });
});

describe('lerpInsets', () => {
    const a: InsetsResolved = { left: 0, right: 0, top: 0, bottom: 0 };
    const b: InsetsResolved = { left: 10, right: 20, top: 30, bottom: 40 };

    it('interpolates each side independently', () => {
        expect(insetsOps.lerp(a, b, 0.5)).toEqual({ left: 5, right: 10, top: 15, bottom: 20 });
    });

    it('returns the endpoints at t=0 and t=1', () => {
        expect(insetsOps.lerp(a, b, 0)).toEqual(a);
        expect(insetsOps.lerp(a, b, 1)).toEqual(b);
    });
});

const pad = (l: number, r: number, t: number, b: number): InsetsResolved => ({
    left: l, right: r, top: t, bottom: b,
});

describe('insetsOps.insetBounds', () => {
    it('subtracts horizontal and vertical padding from the outer size', () => {
        const area = insetsOps.insetBounds(100, 80, pad(10, 10, 5, 5));
        expect(area.width).toBe(80);
        expect(area.height).toBe(70);
    });

    it('clamps negative inner sizes to 0', () => {
        const area = insetsOps.insetBounds(10, 10, pad(20, 20, 20, 20));
        expect(area.width).toBe(0);
        expect(area.height).toBe(0);
    });

    it('reports a zero center offset for symmetric padding', () => {
        const area = insetsOps.insetBounds(100, 100, pad(10, 10, 10, 10));
        expect(area.x).toBe(0);
        expect(area.y).toBe(0);
    });

    it('shifts the center toward the smaller-padded side', () => {
        const area = insetsOps.insetBounds(100, 100, pad(20, 0, 0, 10));
        expect(area.x).toBe(10); // (20 - 0) / 2
        expect(area.y).toBe(-5); // (0 - 10) / 2
    });
});

describe('insetsOps.outsetSize', () => {
    it('adds padding back to recover the outer size', () => {
        expect(insetsOps.outsetSize(80, 70, pad(10, 10, 5, 5))).toEqual({ width: 100, height: 80 });
    });

    it('round-trips with insetBounds for non-clamped sizes', () => {
        const p = pad(7, 3, 4, 6);
        const inner = insetsOps.insetBounds(200, 150, p);
        const outer = insetsOps.outsetSize(inner.width, inner.height, p);
        expect(outer).toEqual({ width: 200, height: 150 });
    });
});
