import { describe, it, expect } from 'vitest';
import { lerpColorRamp } from '@/attributes/shape/fill/gradient-stops';
import { resolveFill, lerpFill } from '@/attributes/shape/fill/registry';
import type { LinearGradientFillResolved } from '@/attributes/shape/fill/implementations/linear-gradient';
import type { RadialGradientFillResolved } from '@/attributes/shape/fill/implementations/radial-gradient';
import type { ConicGradientFillResolved } from '@/attributes/shape/fill/implementations/conic-gradient';
import { fractalNoiseFill, type FractalNoiseFillResolved } from '@/attributes/shape/fill/implementations/fractal-noise';
import type { NormalizedColor } from '@/attributes/shape/fill/color/parser';

const RED: NormalizedColor = [1, 0, 0, 1];
const GREEN: NormalizedColor = [0, 1, 0, 1];
const BLUE: NormalizedColor = [0, 0, 1, 1];

describe('lerpColorRamp', () => {
    it('blends stop by stop when the positions match', () => {
        const out = lerpColorRamp(
            { colors: [RED, GREEN], stops: [0, 1] },
            { colors: [GREEN, BLUE], stops: [0, 1] },
            0.5,
        );
        expect(out.stops).toEqual([0, 1]);
        expect(out.colors).toEqual([[0.5, 0.5, 0, 1], [0, 0.5, 0.5, 1]]);
    });

    it('ends on the destination ramp when a 2-stop gradient tweens to a 3-stop one', () => {
        const a = { colors: [RED, GREEN], stops: [0, 1] };
        const b = { colors: [RED, GREEN, BLUE], stops: [0, 0.5, 1] };
        expect(lerpColorRamp(a, b, 1)).toEqual(b);
    });

    it('ends on the destination ramp when a 3-stop gradient tweens to a 2-stop one', () => {
        const a = { colors: [RED, GREEN, BLUE], stops: [0, 0.5, 1] };
        const b = { colors: [RED, BLUE], stops: [0, 1] };
        const end = lerpColorRamp(a, b, 1);
        expect(end.stops).toEqual([0, 0.5, 1]);
        // The destination's blue-to-red line sampled at its middle.
        expect(end.colors[0]).toEqual(RED);
        expect(end.colors[1]).toEqual([0.5, 0, 0.5, 1]);
        expect(end.colors[2]).toEqual(BLUE);
    });

    it('starts on the source ramp, whatever the destination adds', () => {
        const a = { colors: [RED, GREEN], stops: [0, 1] };
        const b = { colors: [RED, GREEN, BLUE], stops: [0, 0.25, 1] };
        const start = lerpColorRamp(a, b, 0);
        expect(start.stops).toEqual([0, 0.25, 1]);
        expect(start.colors[1]).toEqual([0.75, 0.25, 0, 1]);
    });

    it('clamps a ramp past its first and last stop, as the renderer does', () => {
        const a = { colors: [RED, BLUE], stops: [0.25, 0.75] };
        const b = { colors: [GREEN, GREEN], stops: [0, 1] };
        const start = lerpColorRamp(a, b, 0);
        expect(start.stops).toEqual([0, 0.25, 0.75, 1]);
        expect(start.colors[0]).toEqual(RED);
        expect(start.colors[3]).toEqual(BLUE);
    });

    it('keeps a hard edge on either side', () => {
        const hard = { colors: [RED, RED, BLUE, BLUE], stops: [0, 0.5, 0.5, 1] };
        const soft = { colors: [GREEN, GREEN], stops: [0, 1] };
        const end = lerpColorRamp(soft, hard, 1);
        expect(end).toEqual(hard);
        const start = lerpColorRamp(soft, hard, 0);
        expect(start.stops).toEqual([0, 0.5, 0.5, 1]);
        expect(start.colors.every(c => c[0] === 0 && c[1] === 1)).toBe(true);
    });
});

describe('gradient fills — tween between different stop counts', () => {
    const two = { colors: ['red', 'lime'], stops: [0, 1] };
    const three = { colors: ['red', 'lime', 'blue'], stops: [0, 0.5, 1] };

    it.each([
        ['linear-gradient', {}],
        ['radial-gradient', {}],
        ['conic-gradient', {}],
    ] as const)('%s ends on the destination stops', (type, extra) => {
        const a = resolveFill({ type, ...two, ...extra } as never);
        const b = resolveFill({ type, ...three, ...extra } as never);
        const end = lerpFill(a, b, 1) as LinearGradientFillResolved | RadialGradientFillResolved | ConicGradientFillResolved;
        expect(end.stops).toEqual([0, 0.5, 1]);
        expect(end.colors).toEqual((b as typeof end).colors);
        const back = lerpFill(b, a, 1) as typeof end;
        expect(back.stops).toEqual([0, 0.5, 1]);
        expect(back.colors[1][0]).toBeCloseTo(0.5, 5);
    });

    it('fractal noise ends on the destination colour ramp', () => {
        const a = fractalNoiseFill.resolve({ type: 'fractal-noise', colors: ['red', 'lime'] });
        const b = fractalNoiseFill.resolve({ type: 'fractal-noise', colors: ['red', 'lime', 'blue'] });
        const end = fractalNoiseFill.lerp(a, b, 1) as FractalNoiseFillResolved;
        expect(end.stops).toEqual([0, 0.5, 1]);
        expect(end.colors).toEqual(b.colors);
    });
});
