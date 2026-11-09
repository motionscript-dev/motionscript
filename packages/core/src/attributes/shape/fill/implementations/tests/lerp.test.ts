import { describe, it, expect } from 'vitest';
import { resolveFill, lerpFill } from '@/attributes/shape/fill/registry';
import type { FillProp, FillResolved } from '@/attributes/shape/fill/union';
import type { NormalizedColor } from '@/attributes/shape/fill/color/parser';

const RED: NormalizedColor = [1, 0, 0, 1];
const BLUE: NormalizedColor = [0, 0, 1, 1];
const LIME: NormalizedColor = [0, 1, 0, 1];

type Fields = Record<string, unknown>;
const fill = (prop: Fields): FillResolved => resolveFill(prop as unknown as FillProp);
const at = (a: FillResolved, b: FillResolved, t: number) => lerpFill(a, b, t) as FillResolved & Fields;

describe('conic gradient lerp', () => {
    const a = fill({ type: 'conic-gradient', colors: [RED, BLUE], center: { x: 0, y: 0 }, startAngle: 0, opacity: 0 });
    const b = fill({ type: 'conic-gradient', colors: [BLUE, RED], center: { x: 1, y: -1 }, startAngle: 90, opacity: 1 });

    it('interpolates the centre, the start angle and the opacity', () => {
        const mid = at(a, b, 0.5);
        expect(mid.center).toEqual({ x: 0.5, y: -0.5 });
        expect(mid.startAngle).toBe(45);
        expect(mid.opacity).toBe(0.5);
    });

    it('blends the colour ramp stop by stop', () => {
        expect(at(a, b, 0.5).colors).toEqual([[0.5, 0, 0.5, 1], [0.5, 0, 0.5, 1]]);
    });

    it('treats an unset start angle as 0', () => {
        const unset = fill({ type: 'conic-gradient', colors: [RED, BLUE] });
        expect(at(unset, b, 0.5).startAngle).toBe(45);
        expect(at(b, unset, 0.5).startAngle).toBe(45);
    });

    it('is the source at t = 0 and the destination at t = 1', () => {
        expect(at(a, b, 0)).toMatchObject({ center: { x: 0, y: 0 }, startAngle: 0, opacity: 0, colors: [RED, BLUE] });
        expect(at(a, b, 1)).toMatchObject({ center: { x: 1, y: -1 }, startAngle: 90, opacity: 1, colors: [BLUE, RED] });
    });

    it('keeps its type', () => {
        expect(at(a, b, 0.5).type).toBe('conic-gradient');
    });
});

describe('noise lerp', () => {
    const a = fill({ type: 'noise', size: { x: 1, y: 2 }, density: 0, seed: 0, color: BLUE, opacity: 0 });
    const b = fill({ type: 'noise', size: { x: 3, y: 6 }, density: 1, seed: 10, color: RED, opacity: 1 });

    it('interpolates size, density, seed, colour and opacity', () => {
        const mid = at(a, b, 0.5);
        expect(mid.size).toEqual({ x: 2, y: 4 });
        expect(mid.density).toBe(0.5);
        expect(mid.seed).toBe(5);
        expect(mid.color).toEqual([0.5, 0, 0.5, 1]);
        expect(mid.opacity).toBe(0.5);
    });

    it('is the source at t = 0 and the destination at t = 1', () => {
        expect(at(a, b, 0)).toMatchObject({ size: { x: 1, y: 2 }, density: 0, seed: 0, color: BLUE });
        expect(at(a, b, 1)).toMatchObject({ size: { x: 3, y: 6 }, density: 1, seed: 10, color: RED });
    });

    it('treats an unset opacity as 1', () => {
        const unset = fill({ type: 'noise' });
        expect(at(unset, a, 0.5).opacity).toBe(0.5);
    });
});

describe('fractal noise lerp', () => {
    const a = fill({
        type: 'fractalNoise', basis: 'value', octaves: 2, frequency: { x: 2, y: 4 }, lacunarity: 2, gain: 0.5,
        seed: 0, offset: { x: 0, y: 0 }, angle: 0, colors: [RED, BLUE], contrast: 1, opacity: 0,
    });
    const b = fill({
        type: 'fractalNoise', basis: 'worley', octaves: 6, frequency: { x: 6, y: 8 }, lacunarity: 4, gain: 1,
        seed: 10, offset: { x: 2, y: -2 }, angle: 90, colors: [BLUE, RED], contrast: 3, opacity: 1,
    });

    it('interpolates frequency, lacunarity, gain, seed, offset, angle, contrast and opacity', () => {
        const mid = at(a, b, 0.5);
        expect(mid.frequency).toEqual({ x: 4, y: 6 });
        expect(mid.lacunarity).toBe(3);
        expect(mid.gain).toBe(0.75);
        expect(mid.seed).toBe(5);
        expect(mid.offset).toEqual({ x: 1, y: -1 });
        expect(mid.angle).toBe(45);
        expect(mid.contrast).toBe(2);
        expect(mid.opacity).toBe(0.5);
    });

    it('snaps the basis and the octave count at the midpoint', () => {
        expect([at(a, b, 0.49).basis, at(a, b, 0.49).octaves]).toEqual(['value', 2]);
        expect([at(a, b, 0.5).basis, at(a, b, 0.5).octaves]).toEqual(['worley', 6]);
    });

    it('blends the colour ramp', () => {
        expect(at(a, b, 0.5).colors).toEqual([[0.5, 0, 0.5, 1], [0.5, 0, 0.5, 1]]);
    });

    it('reaches the destination\'s ramp when the stop counts differ', () => {
        const two = fill({ type: 'fractalNoise', colors: [RED, BLUE] });
        const three = fill({ type: 'fractalNoise', colors: [RED, LIME, BLUE] });
        const end = at(two, three, 1);
        expect(end.colors).toEqual([RED, LIME, BLUE]);
        expect(end.stops).toEqual([0, 0.5, 1]);
        expect(at(two, three, 0).colors).toHaveLength(3);
    });

    it('is the source at t = 0 and the destination at t = 1', () => {
        expect(at(a, b, 0)).toMatchObject({ basis: 'value', octaves: 2, frequency: { x: 2, y: 4 }, seed: 0, angle: 0 });
        expect(at(a, b, 1)).toMatchObject({ basis: 'worley', octaves: 6, frequency: { x: 6, y: 8 }, seed: 10, angle: 90 });
    });
});

describe('stripe lerp', () => {
    it('interpolates gap, stroke width, angle, colour and opacity', () => {
        const a = fill({ type: 'stripe', gap: 4, strokeWidth: 1, angle: 0, color: BLUE, opacity: 0 });
        const b = fill({ type: 'stripe', gap: 12, strokeWidth: 3, angle: 90, color: RED, opacity: 1 });
        const mid = at(a, b, 0.5);
        expect(mid).toMatchObject({ gap: 8, strokeWidth: 2, angle: 45, color: [0.5, 0, 0.5, 1], opacity: 0.5 });
    });

    it('measures an unset side against the renderer\'s defaults: a gap of 8, a width of 1, an angle of -45', () => {
        const unset = fill({ type: 'stripe' });
        const set = fill({ type: 'stripe', gap: 20, strokeWidth: 5, angle: 45 });
        expect(at(unset, set, 0.5)).toMatchObject({ gap: 14, strokeWidth: 3, angle: 0 });
        expect(at(set, unset, 0.5)).toMatchObject({ gap: 14, strokeWidth: 3, angle: 0 });
    });

    it('fills an unset pair with those defaults too, so a lerp never leaves a gap unset', () => {
        expect(at(fill({ type: 'stripe' }), fill({ type: 'stripe' }), 0.5)).toMatchObject({ gap: 8, strokeWidth: 1, angle: -45 });
    });

    it('takes the colour from whichever side has one, not blending it towards nothing', () => {
        const none = fill({ type: 'stripe' });
        const red = fill({ type: 'stripe', color: RED });
        expect(at(none, red, 0.25).color).toEqual(RED);
        expect(at(red, none, 0.75).color).toEqual(RED);
    });

    it('leaves the colour unset when neither side has one', () => {
        expect(at(fill({ type: 'stripe' }), fill({ type: 'stripe', gap: 3 }), 0.5).color).toBeUndefined();
    });

    it('is the source at t = 0 and the destination at t = 1', () => {
        const a = fill({ type: 'stripe', gap: 4, angle: 10 });
        const b = fill({ type: 'stripe', gap: 12, angle: 80 });
        expect(at(a, b, 0)).toMatchObject({ gap: 4, angle: 10 });
        expect(at(a, b, 1)).toMatchObject({ gap: 12, angle: 80 });
    });
});

describe('dot grid lerp', () => {
    const a = fill({ type: 'dotGrid', radius: 1, spacing: 10, offset: { x: 0, y: 0 }, color: BLUE, opacity: 0 });
    const b = fill({ type: 'dotGrid', radius: 3, spacing: 30, offset: { x: 4, y: -4 }, color: RED, opacity: 1 });

    it('interpolates radius, spacing, offset, colour and opacity', () => {
        expect(at(a, b, 0.5)).toMatchObject({
            radius: 2, spacing: 20, offset: { x: 2, y: -2 }, color: [0.5, 0, 0.5, 1], opacity: 0.5,
        });
    });

    it('is the source at t = 0 and the destination at t = 1', () => {
        expect(at(a, b, 0)).toMatchObject({ radius: 1, spacing: 10, color: BLUE });
        expect(at(a, b, 1)).toMatchObject({ radius: 3, spacing: 30, color: RED });
    });
});

describe('grid lerp', () => {
    const a = fill({ type: 'grid', divisions: 4, subdivisions: 1, offset: { x: 0, y: 0 }, strokeWidth: 1, color: BLUE, opacity: 0 });
    const b = fill({ type: 'grid', divisions: 8, subdivisions: 5, offset: { x: 6, y: 2 }, strokeWidth: 3, color: RED, opacity: 1 });

    it('interpolates divisions continuously, so a fractional count is a grid caught mid-zoom', () => {
        expect(at(a, b, 0.5).divisions).toBe(6);
        expect(at(a, b, 0.125).divisions).toBe(4.5);
    });

    it('interpolates subdivisions continuously too, leaving the rounding to the renderer', () => {
        expect(at(a, b, 0.5).subdivisions).toBe(3);
        expect(at(a, b, 0.125).subdivisions).toBe(1.5);
    });

    it('interpolates offset, stroke width, colour and opacity', () => {
        expect(at(a, b, 0.5)).toMatchObject({
            offset: { x: 3, y: 1 }, strokeWidth: 2, color: [0.5, 0, 0.5, 1], opacity: 0.5,
        });
    });

    it('interpolates the subdivision width resolved on each side', () => {
        // 0.5 (half of 1) against 1.5 (half of 3).
        expect(at(a, b, 0.5).subdivisionWidth).toBe(1);
    });

    it('is the source at t = 0 and the destination at t = 1', () => {
        expect(at(a, b, 0)).toMatchObject({ divisions: 4, subdivisions: 1, strokeWidth: 1, color: BLUE });
        expect(at(a, b, 1)).toMatchObject({ divisions: 8, subdivisions: 5, strokeWidth: 3, color: RED });
    });
});

describe('every procedural kind', () => {
    const PAIRS: Array<[string, Fields, Fields]> = [
        ['conic-gradient', { colors: [RED, BLUE] }, { colors: [BLUE, RED], startAngle: 40 }],
        ['noise', { seed: 1 }, { seed: 2 }],
        ['fractalNoise', { seed: 1 }, { seed: 2 }],
        ['stripe', { gap: 4 }, { gap: 8 }],
        ['dotGrid', { spacing: 8 }, { spacing: 16 }],
        ['grid', { divisions: 2 }, { divisions: 6 }],
    ];

    it.each(PAIRS)('%s keeps its type and blend', (type, left, right) => {
        const a = fill({ type, ...left, blend: 'screen' });
        const b = fill({ type, ...right, blend: 'screen' });
        const mid = at(a, b, 0.5);
        expect(mid.type).toBe(type);
        expect(mid.blend).toBe('screen');
    });

    it.each(PAIRS)('%s does not write to either endpoint', (type, left, right) => {
        const a = fill({ type, ...left });
        const b = fill({ type, ...right });
        const before = JSON.stringify([a, b]);
        lerpFill(a, b, 0.3);
        expect(JSON.stringify([a, b])).toBe(before);
    });
});
