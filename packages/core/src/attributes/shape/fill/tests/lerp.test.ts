import { describe, it, expect } from 'vitest';
import { colorOps, lerpColor } from '@/attributes/shape/fill/lerp';

describe('lerpColor', () => {
    it('returns the from color at t=0', () => {
        expect(lerpColor([0, 0, 0, 1], [1, 1, 1, 1], 0)).toEqual([0, 0, 0, 1]);
    });

    it('returns the to color at t=1', () => {
        expect(lerpColor([0, 0, 0, 1], [1, 1, 1, 1], 1)).toEqual([1, 1, 1, 1]);
    });

    it('interpolates every channel including alpha', () => {
        expect(lerpColor([0, 0, 0, 0], [1, 0.5, 0.2, 1], 0.5)).toEqual([0.5, 0.25, 0.1, 0.5]);
    });

    it('interpolates red→blue at the midpoint', () => {
        const mid = lerpColor([1, 0, 0, 1], [0, 0, 1, 1], 0.5);
        expect(mid).toEqual([0.5, 0, 0.5, 1]);
    });
});

describe('colorOps.hex', () => {
    it('writes an opaque colour as #rrggbb', () => {
        expect(colorOps.hex([1, 0, 0, 1])).toBe('#ff0000');
        expect(colorOps.hex([79 / 255, 157 / 255, 1, 1])).toBe('#4f9dff');
    });

    it('keeps alpha as a fourth byte when there is any', () => {
        expect(colorOps.hex([0, 0, 0, 0.5])).toBe('#00000080');
    });

    it('resolves a CSS string first', () => {
        expect(colorOps.hex('lime')).toBe('#00ff00');
        expect(colorOps.hex('#ABC')).toBe('#aabbcc');
        expect(colorOps.hex('white/10')).toBe('#ffffff1a');
    });

    it('clamps channels outside the 0–1 range', () => {
        expect(colorOps.hex([1.2, -0.1, 0.5, 1])).toBe('#ff0080');
    });

    it('round-trips through resolve', () => {
        const color = colorOps.resolve('#12345678');
        expect(colorOps.resolve(colorOps.hex(color))).toEqual(color);
    });
});

describe('colorOps.resolve', () => {
    it('passes an already-normalized tuple through by reference', () => {
        const tuple: [number, number, number, number] = [0.2, 0.4, 0.6, 0.8];
        expect(colorOps.resolve(tuple)).toBe(tuple);
    });

    it('does not clamp or copy a tuple, whatever it holds', () => {
        const odd: [number, number, number, number] = [2, -1, 0.5, 3];
        expect(colorOps.resolve(odd)).toBe(odd);
    });

    it('parses a CSS string', () => {
        expect(colorOps.resolve('red')).toEqual([1, 0, 0, 1]);
        expect(colorOps.resolve('#00000080')).toEqual([0, 0, 0, 128 / 255]);
        expect(colorOps.resolve('white/10')).toEqual([1, 1, 1, 0.1]);
    });

    it('takes a previous value and ignores it', () => {
        expect(colorOps.resolve('blue', [1, 0, 0, 1])).toEqual([0, 0, 1, 1]);
    });
});

describe('colorOps.lerp', () => {
    it('is lerpColor', () => {
        expect(colorOps.lerp).toBe(lerpColor);
        expect(colorOps.lerp([0, 0, 0, 1], [1, 1, 1, 0], 0.5)).toEqual([0.5, 0.5, 0.5, 0.5]);
    });

    it('does not clamp t, so an overshoot goes past the destination', () => {
        expect(colorOps.lerp([0, 0, 0, 1], [0.5, 0.5, 0.5, 1], 2)).toEqual([1, 1, 1, 1]);
    });

    it('returns a new tuple and leaves its inputs alone', () => {
        const from: [number, number, number, number] = [0, 0, 0, 1];
        const to: [number, number, number, number] = [1, 1, 1, 1];
        const out = colorOps.lerp(from, to, 0.5);
        expect(out).not.toBe(from);
        expect(out).not.toBe(to);
        expect(from).toEqual([0, 0, 0, 1]);
        expect(to).toEqual([1, 1, 1, 1]);
    });
});
