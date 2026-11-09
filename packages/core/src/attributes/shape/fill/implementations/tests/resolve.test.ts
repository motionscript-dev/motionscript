import { describe, it, expect } from 'vitest';
import { resolveFill } from '@/attributes/shape/fill/registry';
import { MINOR_WIDTH_RATIO } from '@/attributes/shape/fill/implementations/grid';
import type { FillProp } from '@/attributes/shape/fill/union';
import type { NormalizedColor } from '@/attributes/shape/fill/color/parser';

const RED: NormalizedColor = [1, 0, 0, 1];
const GREEN: NormalizedColor = [0, 1, 0, 1];
const BLUE: NormalizedColor = [0, 0, 1, 1];
const BLACK: NormalizedColor = [0, 0, 0, 1];
const WHITE: NormalizedColor = [1, 1, 1, 1];

/** `resolveFill` for the kinds whose props the test spells out loosely. */
const resolve = (prop: Record<string, unknown>) => resolveFill(prop as unknown as FillProp) as unknown as Record<string, unknown> & { type: string };

describe('solid', () => {
    it('parses a CSS colour and passes a tuple through by reference', () => {
        expect(resolve({ type: 'solid', color: 'red' }).color).toEqual(RED);
        expect(resolve({ type: 'solid', color: BLUE }).color).toBe(BLUE);
    });
});

describe('gradient defaults', () => {
    it('spaces the stops of a linear gradient evenly from 0 to 1', () => {
        expect(resolve({ type: 'linear-gradient', colors: ['red', 'lime', 'blue'] }).stops).toEqual([0, 0.5, 1]);
        expect(resolve({ type: 'linear-gradient', colors: ['red', 'lime', 'blue', 'white', 'black'] }).stops)
            .toEqual([0, 0.25, 0.5, 0.75, 1]);
    });

    it('puts a one-colour gradient\'s only stop at 0', () => {
        expect(resolve({ type: 'linear-gradient', colors: ['red'] }).stops).toEqual([0]);
    });

    it('keeps the stops it is given, without checking them against the colours', () => {
        expect(resolve({ type: 'linear-gradient', colors: ['red', 'blue'], stops: [0.2, 0.9] }).stops).toEqual([0.2, 0.9]);
    });

    it('runs a linear gradient corner to corner by default, top-left to bottom-right in y-up space', () => {
        const linear = resolve({ type: 'linear-gradient', colors: ['red', 'blue'] });
        expect(linear.start).toEqual({ x: -1, y: 1 });
        expect(linear.end).toEqual({ x: 1, y: -1 });
        expect(linear.colors).toEqual([RED, BLUE]);
    });

    it('takes a linear gradient\'s start and end as given', () => {
        const linear = resolve({ type: 'linear-gradient', colors: ['red', 'blue'], start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
        expect([linear.start, linear.end]).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    });

    it('centres a radial gradient and gives it a radius of 100', () => {
        const radial = resolve({ type: 'radial-gradient', colors: ['red', 'blue'] });
        expect(radial.center).toEqual({ x: 0, y: 0 });
        expect(radial.radius).toBe(100);
        expect(radial.stops).toEqual([0, 1]);
    });

    it('takes a radial gradient\'s centre and radius as given, a radius of 0 included', () => {
        const radial = resolve({ type: 'radial-gradient', colors: ['red', 'blue'], center: { x: 0.5, y: -0.5 }, radius: 0 });
        expect(radial.center).toEqual({ x: 0.5, y: -0.5 });
        expect(radial.radius).toBe(0);
    });

    it('centres a conic gradient and leaves its start angle unset', () => {
        const conic = resolve({ type: 'conic-gradient', colors: ['red', 'lime', 'blue'] });
        expect(conic.center).toEqual({ x: 0, y: 0 });
        expect(conic.startAngle).toBeUndefined();
        expect(conic.stops).toEqual([0, 0.5, 1]);
        expect(conic.colors).toEqual([RED, GREEN, BLUE]);
    });

    it('takes a conic gradient\'s start angle as given', () => {
        expect(resolve({ type: 'conic-gradient', colors: ['red', 'blue'], startAngle: 90 }).startAngle).toBe(90);
    });

    it('accepts tuples as colours', () => {
        expect(resolve({ type: 'radial-gradient', colors: [RED, BLUE] }).colors).toEqual([RED, BLUE]);
    });
});

describe('noise defaults', () => {
    it('is black speckle at full density with a seed of 0', () => {
        const noise = resolve({ type: 'noise' });
        expect(noise.size).toEqual({ x: 1, y: 1 });
        expect(noise.density).toBe(1);
        expect(noise.color).toEqual(BLACK);
        expect(noise.seed).toBe(0);
    });

    it('takes size, density, colour and seed as given, a density or seed of 0 included', () => {
        const noise = resolve({ type: 'noise', size: { x: 2, y: 3 }, density: 0, color: 'red', seed: 0 });
        expect(noise).toMatchObject({ size: { x: 2, y: 3 }, density: 0, color: RED, seed: 0 });
    });
});

describe('fractalNoise defaults', () => {
    const base = resolve({ type: 'fractalNoise' });

    it('is four octaves of simplex noise over a black-to-white ramp', () => {
        expect(base).toMatchObject({
            basis: 'simplex', octaves: 4, lacunarity: 2, gain: 0.5, seed: 0, angle: 0, contrast: 1,
            colors: [BLACK, WHITE], stops: [0, 1],
        });
        expect(base.offset).toEqual({ x: 0, y: 0 });
    });

    it('is three cycles across on both axes', () => {
        expect(base.frequency).toEqual({ x: 3, y: 3 });
    });

    it('takes a scalar frequency for both axes', () => {
        expect(resolve({ type: 'fractalNoise', frequency: 6 }).frequency).toEqual({ x: 6, y: 6 });
        expect(resolve({ type: 'fractalNoise', frequency: 0 }).frequency).toEqual({ x: 0, y: 0 });
    });

    it('takes a per-axis frequency as given', () => {
        const frequency = { x: 2, y: 8 };
        expect(resolve({ type: 'fractalNoise', frequency }).frequency).toBe(frequency);
    });

    it('clamps the octave count to 1..8', () => {
        const octaves = (value: number) => resolve({ type: 'fractalNoise', octaves: value }).octaves;
        expect(octaves(0)).toBe(1);
        expect(octaves(-5)).toBe(1);
        expect(octaves(1)).toBe(1);
        expect(octaves(8)).toBe(8);
        expect(octaves(20)).toBe(8);
    });

    it('rounds a fractional octave count', () => {
        const octaves = (value: number) => resolve({ type: 'fractalNoise', octaves: value }).octaves;
        expect(octaves(2.4)).toBe(2);
        expect(octaves(2.6)).toBe(3);
        expect(octaves(7.7)).toBe(8);
    });

    it('spaces the stops of its own colours evenly', () => {
        const noise = resolve({ type: 'fractalNoise', colors: ['red', 'lime', 'blue'] });
        expect(noise.colors).toEqual([RED, GREEN, BLUE]);
        expect(noise.stops).toEqual([0, 0.5, 1]);
    });

    it('falls back to black-to-white for an empty colour list', () => {
        expect(resolve({ type: 'fractalNoise', colors: [] }).colors).toEqual([BLACK, WHITE]);
        expect(resolve({ type: 'fractalNoise', colors: [] }).stops).toEqual([0, 1]);
    });

    it('takes basis, lacunarity, gain, seed, angle and contrast as given, zeros included', () => {
        const noise = resolve({
            type: 'fractalNoise', basis: 'worley', lacunarity: 3, gain: 0, seed: 7, angle: 45, contrast: 0,
            offset: { x: 1, y: 2 },
        });
        expect(noise).toMatchObject({
            basis: 'worley', lacunarity: 3, gain: 0, seed: 7, angle: 45, contrast: 0, offset: { x: 1, y: 2 },
        });
    });
});

describe('dotGrid defaults', () => {
    it('is a 2px black dot every 16px, unshifted', () => {
        const dots = resolve({ type: 'dotGrid' });
        expect(dots).toMatchObject({ radius: 2, spacing: 16, offset: { x: 0, y: 0 }, color: BLACK });
    });

    it('takes radius, spacing, offset and colour as given, a radius of 0 included', () => {
        const dots = resolve({ type: 'dotGrid', radius: 0, spacing: 4, offset: { x: 3, y: 5 }, color: 'blue' });
        expect(dots).toMatchObject({ radius: 0, spacing: 4, offset: { x: 3, y: 5 }, color: BLUE });
    });
});

describe('grid defaults', () => {
    it('is four hairline divisions with no minor ruling', () => {
        const grid = resolve({ type: 'grid' });
        expect(grid).toMatchObject({
            divisions: 4, subdivisions: 1, offset: { x: 0, y: 0 }, strokeWidth: 1, color: BLACK,
        });
    });

    it('draws a subdivision line at half the division line\'s width', () => {
        expect(MINOR_WIDTH_RATIO).toBe(0.5);
        expect(resolve({ type: 'grid' }).subdivisionWidth).toBe(0.5);
    });

    it('derives the subdivision width from the stroke width actually in force', () => {
        expect(resolve({ type: 'grid', strokeWidth: 4 }).subdivisionWidth).toBe(2);
        expect(resolve({ type: 'grid', strokeWidth: 10 }).subdivisionWidth).toBe(5);
    });

    it('derives a subdivision width of 0 from a stroke width of 0', () => {
        const grid = resolve({ type: 'grid', strokeWidth: 0 });
        expect(grid.strokeWidth).toBe(0);
        expect(grid.subdivisionWidth).toBe(0);
    });

    it('lets a stated subdivision width win, zero included', () => {
        expect(resolve({ type: 'grid', strokeWidth: 4, subdivisionWidth: 3 }).subdivisionWidth).toBe(3);
        expect(resolve({ type: 'grid', strokeWidth: 4, subdivisionWidth: 0 }).subdivisionWidth).toBe(0);
    });

    it('takes divisions, subdivisions, offset and colour as given', () => {
        const grid = resolve({ type: 'grid', divisions: 8, subdivisions: 5, offset: { x: 1, y: 2 }, color: 'red' });
        expect(grid).toMatchObject({ divisions: 8, subdivisions: 5, offset: { x: 1, y: 2 }, color: RED });
    });
});

describe('stripe defaults', () => {
    it('applies none at resolve: gap, stroke width, angle and colour stay unset', () => {
        const stripe = resolve({ type: 'stripe' });
        expect(stripe.gap).toBeUndefined();
        expect(stripe.strokeWidth).toBeUndefined();
        expect(stripe.angle).toBeUndefined();
        expect(stripe.color).toBeUndefined();
    });

    it('takes gap, stroke width, angle and colour as given, zeros included', () => {
        const stripe = resolve({ type: 'stripe', gap: 12, strokeWidth: 0, angle: 0, color: 'lime' });
        expect(stripe).toMatchObject({ gap: 12, strokeWidth: 0, angle: 0, color: GREEN });
    });

    it('passes a colour tuple through by reference', () => {
        expect(resolve({ type: 'stripe', color: BLUE }).color).toBe(BLUE);
    });
});

describe('every kind', () => {
    const KINDS: Array<Record<string, unknown>> = [
        { type: 'solid', color: 'red' },
        { type: 'linear-gradient', colors: ['red', 'blue'] },
        { type: 'radial-gradient', colors: ['red', 'blue'] },
        { type: 'conic-gradient', colors: ['red', 'blue'] },
        { type: 'noise' },
        { type: 'fractalNoise' },
        { type: 'stripe' },
        { type: 'dotGrid' },
        { type: 'grid' },
    ];

    it.each(KINDS)('carries its type, opacity and blend through resolve (%j)', (prop) => {
        const resolved = resolve({ ...prop, opacity: 0.3, blend: 'multiply' });
        expect(resolved).toMatchObject({ type: prop.type, opacity: 0.3, blend: 'multiply' });
    });

    it.each(KINDS)('leaves opacity and blend unset when none is given (%j)', (prop) => {
        const resolved = resolve(prop);
        expect(resolved.opacity).toBeUndefined();
        expect(resolved.blend).toBeUndefined();
    });
});
