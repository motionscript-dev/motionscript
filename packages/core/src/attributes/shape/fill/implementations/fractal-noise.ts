import { Color, NormalizedColor, parseColor } from '../color/parser';
import type { BlendMode } from '../blend';
import type { FillData } from '../registry';
import { lerpColorRamp } from '../gradient-stops';
import { lerpNumber } from '@/tween/lerp';
import { lerpVector2, Vector2 } from '@/attributes/layout/vector2';

/**
 * Which noise function the octaves are summed from: `'value'` (smoothed; cheapest and softest: clouds, haze, paper),
 * `'simplex'` (gradient; more even, the default for anything organic up close), `'ridged'` (simplex folded and inverted
 * so zero crossings become sharp crests: mountains, lightning, marble), `'worley'` (cellular distance field, giving
 * edges rather than blur: scales, cracked earth, caustics).
 */
export type FractalNoiseBasis = 'value' | 'simplex' | 'ridged' | 'worley';

/** Fractal (fBm) noise, the procedural material source: unlike the per-pixel speckle of {@link NoiseFillProp}, a continuous *field* of octaves summed at rising frequency and falling amplitude (cloud, smoke, marble, terrain). Composes with the effect layer (`duotone` over it is marble, `threshold` an organic matte). `seed` shifts the whole field; tween `offset` instead to *travel* through it, which reads as flowing. */
export interface FractalNoiseFillProp {
    type: 'fractalNoise';
    /** Which noise function the octaves come from (default `'simplex'`). */
    basis?: FractalNoiseBasis;
    /** How many octaves are summed, 1–8 (default 4). Each one doubles the cost. */
    octaves?: number;
    /** Cycles of the first octave across the shape — a number, or per-axis (default 3). */
    frequency?: number | Vector2;
    /** Frequency multiplier per octave (default 2). */
    lacunarity?: number;
    /** Amplitude multiplier per octave; below 1 the detail fades in (default 0.5). */
    gain?: number;
    /** Field offset — random-access into the noise. Animate to drift. */
    seed?: number;
    /** Pan through the field, in cycles. Animate to make the pattern flow. */
    offset?: Vector2;
    /** Rotation of the field in degrees (default 0). */
    angle?: number;
    /** Colours the 0–1 field maps onto, low to high (default black → white). */
    colors?: Color[];
    /** Positions of each colour in 0–1 (default evenly spaced). */
    stops?: number[];
    /** Steepen (>1) or flatten (<1) the field before the ramp (default 1). */
    contrast?: number;
    opacity?: number;
    blend?: BlendMode;
}

export interface FractalNoiseFillResolved {
    type: 'fractalNoise';
    basis: FractalNoiseBasis;
    octaves: number;
    frequency: Vector2;
    lacunarity: number;
    gain: number;
    seed: number;
    offset: Vector2;
    angle: number;
    colors: NormalizedColor[];
    stops: number[];
    contrast: number;
    opacity?: number;
    blend?: BlendMode;
}

function toNormalized(c: Color): NormalizedColor {
    return Array.isArray(c) ? (c as NormalizedColor) : parseColor(c as string);
}

const BLACK: NormalizedColor = [0, 0, 0, 1];
const WHITE: NormalizedColor = [1, 1, 1, 1];

const toFrequency = (f: number | Vector2 | undefined): Vector2 =>
    f === undefined ? { x: 3, y: 3 } : typeof f === 'number' ? { x: f, y: f } : f;

export const fractalNoiseFill: FillData<FractalNoiseFillResolved> = {
    resolve: (prop: FractalNoiseFillProp) => {
        const colors = prop.colors?.length ? prop.colors.map(toNormalized) : [BLACK, WHITE];
        return {
            type: 'fractalNoise',
            basis: prop.basis ?? 'simplex',
            // Clamped here rather than in the shader so `equals` and the cache
            // key see the same value the renderer loops over.
            octaves: Math.max(1, Math.min(8, Math.round(prop.octaves ?? 4))),
            frequency: toFrequency(prop.frequency),
            lacunarity: prop.lacunarity ?? 2,
            gain: prop.gain ?? 0.5,
            seed: prop.seed ?? 0,
            offset: prop.offset ?? { x: 0, y: 0 },
            angle: prop.angle ?? 0,
            colors,
            stops: prop.stops ?? colors.map((_, i) => i / Math.max(1, colors.length - 1)),
            contrast: prop.contrast ?? 1,
            opacity: prop.opacity,
            blend: prop.blend,
        };
    },
    lerp: (a, b, t) => ({
        // The basis picks a different noise function entirely, so there is no
        // in-between field to cross to — snap, like every other enum-valued option.
        basis: t < 0.5 ? a.basis : b.basis,
        // Octave count bounds the shader's loop; a fractional one would round.
        octaves: t < 0.5 ? a.octaves : b.octaves,
        frequency: lerpVector2(a.frequency, b.frequency, t),
        lacunarity: lerpNumber(a.lacunarity, b.lacunarity, t),
        gain: lerpNumber(a.gain, b.gain, t),
        seed: lerpNumber(a.seed, b.seed, t),
        offset: lerpVector2(a.offset, b.offset, t),
        angle: lerpNumber(a.angle, b.angle, t),
        ...lerpColorRamp(a, b, t),
        contrast: lerpNumber(a.contrast, b.contrast, t),
        opacity: lerpNumber(a.opacity ?? 1, b.opacity ?? 1, t),
    }),
    equals: (a, b) =>
        a.basis === b.basis &&
        a.octaves === b.octaves &&
        a.frequency.x === b.frequency.x && a.frequency.y === b.frequency.y &&
        a.lacunarity === b.lacunarity &&
        a.gain === b.gain &&
        a.seed === b.seed &&
        a.offset.x === b.offset.x && a.offset.y === b.offset.y &&
        a.angle === b.angle &&
        a.contrast === b.contrast &&
        a.colors.length === b.colors.length &&
        a.colors.every((c, i) => {
            const d = b.colors[i];
            return d != null && c[0] === d[0] && c[1] === d[1] && c[2] === d[2] && c[3] === d[3];
        }) &&
        a.stops.length === b.stops.length &&
        a.stops.every((s, i) => s === b.stops[i]),
};
