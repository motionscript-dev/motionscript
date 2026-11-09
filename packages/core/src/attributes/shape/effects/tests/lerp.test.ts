import { describe, it, expect } from 'vitest';
import { Effects, type EffectChain } from '@/attributes/shape/effects/chain';
import { effectTypes, equalsEffect, lerpEffect } from '@/attributes/shape/effects/registry';
import { resolveEffectAxis, resolveEffectColor } from '@/attributes/shape/effects/effect-data';
import { resolveMotionBlurAlignment } from '@/attributes/shape/effects/implementations/motion-blur';
import type { NodeEffect } from '@/attributes/shape/effects/union';

/**
 * Which fields each effect interpolates, swept over the whole roster.
 *
 * Every registered effect is built with a builder, a second copy is made with
 * every number moved, every flag flipped and every table replaced, and the
 * pair is lerped. What must hold of every effect, with nothing known about it
 * beyond its field names: each end of the lerp is the effect it was handed, a
 * field never goes missing on the way, and a number is either on the line
 * between its two ends (it interpolates) or one of its two ends (it switches).
 */

const TABLE = new Float32Array(24);
const SHADER = 'fn effect(in: EffectIn) -> vec4f { return vec4f(1.0); }';

const ROSTER: Record<string, () => EffectChain> = {
    blur: () => Effects.blur(2),
    directionalBlur: () => Effects.directionalBlur(2),
    grayscale: () => Effects.grayscale(0.2),
    pixelate: () => Effects.pixelate(10),
    bulge: () => Effects.bulge(0.2),
    magnify: () => Effects.magnify(1.5),
    bloom: () => Effects.bloom({}),
    vintage: () => Effects.vintage({}),
    chromaticAberration: () => Effects.chromaticAberration(2),
    invert: () => Effects.invert(0.5),
    scatter: () => Effects.scatter(2),
    posterize: () => Effects.posterize(5),
    motionBlur: () => Effects.motionBlur(3),
    shader: () => Effects.shader({ source: SHADER, uniforms: { u_amount: 0.5 } }),
    outline: () => Effects.outline(2),
    dropShadow: () => Effects.dropShadow({}),
    vignette: () => Effects.vignette({}),
    grain: () => Effects.grain({}),
    sharpen: () => Effects.sharpen(1),
    edges: () => Effects.edges({}),
    threshold: () => Effects.threshold({}),
    radialBlur: () => Effects.radialBlur(3),
    halftone: () => Effects.halftone({}),
    dither: () => Effects.dither({}),
    duotone: () => Effects.duotone({}),
    curves: () => Effects.curves({ points: [[0, 0], [1, 1]] }),
    // Every field stated: an unstated one is defaulted by the lerp, so it would not come back as it went in.
    colorAdjustment: () => Effects.colorAdjustment({
        brightness: 0.1, contrast: 1.2, saturation: 0.8, hue: 10, vibrance: 0.2, shadows: 0.1, highlights: -0.1, temperature: 0.3, tint: -0.2,
    }),
    rgbShift: () => Effects.rgbShift({}),
    scanlines: () => Effects.scanlines({}),
    blockDisplace: () => Effects.blockDisplace({}),
    bitCrush: () => Effects.bitCrush({}),
    ascii: () => Effects.ascii({}),
    streak: () => Effects.streak({}),
    glow: () => Effects.glow({}),
    oilPaint: () => Effects.oilPaint({}),
    wave: () => Effects.wave({}),
    twirl: () => Effects.twirl(10),
    progressiveBlur: () => Effects.progressiveBlur(4),
    kaleidoscope: () => Effects.kaleidoscope({}),
    glass: () => Effects.glass({}),
    lut: () => Effects.lut({ table: TABLE, size: 2 }),
};

/** Option keys whose value is a colour: compared by what it resolves to, not by spelling. */
const COLOUR_KEYS = new Set(['color', 'ink', 'background', 'shadows', 'highlights']);
/** Fields a lerp may rewrite into another form (`alignment` into a number, `axis` into a vector) and the type tag, which no lerp switches. */
const RESOLVED_KEYS = new Set(['type', 'alignment', 'axis']);

type Json = Record<string, unknown>;

/** The same effect with every number moved, every flag flipped and every typed array replaced. */
function moved(value: unknown): unknown {
    if (typeof value === 'number') return value * 2 + 3;
    if (typeof value === 'boolean') return !value;
    if (value instanceof Float32Array) return new Float32Array(value.length);
    if (Array.isArray(value)) return value.map(moved);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, moved(inner)]));
    }
    return value;
}

/** Every number in `value`, with the path it sits at. */
function numbers(value: unknown, path = ''): Array<[string, number]> {
    if (typeof value === 'number') return [[path, value]];
    if (value instanceof Float32Array || !value || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, inner]) => numbers(inner, `${path}.${key}`));
}

function at(value: unknown, path: string): unknown {
    return path.split('.').slice(1).reduce<unknown>((v, key) => (v as Json | undefined)?.[key], value);
}

function sameColour(a: unknown, b: unknown): boolean {
    const resolve = (c: unknown) => resolveEffectColor(c as never);
    if (Array.isArray(a) && Array.isArray(b) && (typeof a[0] === 'string' || Array.isArray(a[0]))) {
        return a.length === b.length && a.every((c, i) => sameColour(c, b[i]));
    }
    const [x, y] = [resolve(a), resolve(b)];
    return x.every((channel, i) => Math.abs(channel - y[i]) < 1e-9);
}

/** Whether `actual` is `expected`, allowing a colour to have been resolved and a number to carry rounding noise. */
function matches(actual: unknown, expected: unknown, key = ''): boolean {
    // A shutter preset comes back as the phase it names.
    if (key === 'alignment') return matches(actual, resolveMotionBlurAlignment(expected as never));
    // An axis keyword and the vector it names are the same axis.
    if (key === 'axis') return matches(resolveEffectAxis(actual as never), resolveEffectAxis(expected as never));
    if (typeof expected === 'number') return typeof actual === 'number' && Math.abs(actual - expected) < 1e-9;
    if (COLOUR_KEYS.has(key) || key === 'colors') return sameColour(actual, expected);
    if (expected instanceof Float32Array) return actual === expected;
    if (Array.isArray(expected)) {
        return Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => matches(actual[i], v));
    }
    if (expected && typeof expected === 'object') {
        return !!actual && typeof actual === 'object'
            && Object.entries(expected).every(([k, v]) => matches((actual as Json)[k], v, k));
    }
    return Object.is(actual, expected);
}

const PAIRS = Object.entries(ROSTER).map(([type, build]) => {
    const from = build().list[0];
    const to = moved(from) as NodeEffect;
    // A different asset and a different table, where the effect has one.
    const record = to as unknown as Json;
    if (typeof record.src === 'string') record.src = 'other.png';
    return [type, from, to] as [string, NodeEffect, NodeEffect];
});

describe('the roster', () => {
    it('covers every registered effect', () => {
        expect(Object.keys(ROSTER).sort()).toEqual([...effectTypes()].sort());
    });

    it('is built from effects that differ from their moved copy in every number', () => {
        for (const [type, from, to] of PAIRS) {
            expect(numbers(from).length, `'${type}' has no number to move`).toBeGreaterThan(0);
            expect(equalsEffect(from, to), `'${type}' equals its moved copy`).toBe(false);
        }
    });
});

describe.each(PAIRS)('%s lerp', (type, from, to) => {
    it('is the first effect at t = 0, in every field', () => {
        const out = lerpEffect(from, to, 0);
        expect(matches(out, from)).toBe(true);
        expect(equalsEffect(out, from)).toBe(true);
    });

    it('is the second effect at t = 1, in every field', () => {
        const out = lerpEffect(from, to, 1);
        expect(matches(out, to)).toBe(true);
        expect(equalsEffect(out, to)).toBe(true);
    });

    it('keeps its type and carries every field the source had', () => {
        for (const t of [0.25, 0.5, 0.75]) {
            const out = lerpEffect(from, to, t) as unknown as Json;
            expect(out.type).toBe(type);
            for (const key of Object.keys(from)) {
                expect(key in out, `'${key}' is missing from ${type} at t = ${t}`).toBe(true);
            }
        }
    });

    it('puts every number on the line between its ends, or on one of them', () => {
        for (const t of [0.25, 0.75]) {
            const out = lerpEffect(from, to, t);
            for (const [path, a] of numbers(from)) {
                const b = at(to, path) as number;
                const value = at(out, path) as number;
                // A sample count is rounded after it is interpolated.
                const line = a + (b - a) * t;
                const allowed = [a, b, line, Math.round(line)];
                expect(
                    allowed.some((candidate) => Math.abs(value - candidate) < 1e-9),
                    `${type}${path} is ${value} at t = ${t}, between ${a} and ${b}`,
                ).toBe(true);
            }
        }
    });

    it('switches rather than blends on the far side of 0.5: the nearer end\'s value for every non-number', () => {
        const near = lerpEffect(from, to, 0.25) as unknown as Json;
        const far = lerpEffect(from, to, 0.75) as unknown as Json;
        for (const [key, value] of Object.entries(from)) {
            if (typeof value === 'string' && !COLOUR_KEYS.has(key) && !RESOLVED_KEYS.has(key)) {
                expect(near[key], `${type}.${key} at 0.25`).toBe(value);
            }
            const target = (to as unknown as Json)[key];
            if (typeof target === 'string' && !COLOUR_KEYS.has(key) && !RESOLVED_KEYS.has(key)) {
                expect(far[key], `${type}.${key} at 0.75`).toBe(target);
            }
        }
    });

    it('does not write to either end', () => {
        const before = JSON.stringify([from, to], (_k, v) => (v instanceof Float32Array ? Array.from(v) : v));
        lerpEffect(from, to, 0.5);
        expect(JSON.stringify([from, to], (_k, v) => (v instanceof Float32Array ? Array.from(v) : v))).toBe(before);
    });

    it('hands back a new object for a true in-between', () => {
        const out = lerpEffect(from, to, 0.5);
        expect(out).not.toBe(from);
        expect(out).not.toBe(to);
    });
});
