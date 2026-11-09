import { describe, it, expect, vi } from 'vitest';
import { Effects, EffectChain, effectsOps, resolveChainEffects } from '@/attributes/shape/effects/chain';
import { WGSL_CONTRACT } from '@/attributes/shape/shaders/language';
import {
    declareEffect, effectSurface, equalsEffect, hasEffect, lerpEffect, resolveEffect,
} from '@/attributes/shape/effects/registry';
import type { NodeEffect } from '@/attributes/shape/effects/union';
import type { AssetScope } from '@/assets/scope';
import {
    resolveEffectColor,
    sameEffectColor,
    withEffectOptions,
} from '@/attributes/shape/effects/effect-data';
import { backdropEffects, foregroundShaderEffects, isBackdropEffect } from '@/attributes/shape/effects/backdrop';

describe('Effects builders', () => {
    it('blur produces a single blur effect', () => {
        expect([...Effects.blur(4)]).toEqual([{ type: 'blur', radius: 4 }]);
    });

    it('blur with { mode: "backdrop" } flags the effect as a backdrop filter', () => {
        expect([...Effects.blur({ radius: 12, mode: "backdrop" })]).toEqual([
            { type: 'blur', radius: 12, mode: "backdrop" },
        ]);
    });

    it('grayscale carries the mode flag too', () => {
        expect([...Effects.grayscale({ amount: 1, mode: "backdrop" })]).toEqual([
            { type: 'grayscale', amount: 1, mode: "backdrop" },
        ]);
    });

    it('omitting mode leaves it unset rather than undefined (foreground effect)', () => {
        const [effect] = [...Effects.blur(12)];
        expect(effect).toEqual({ type: 'blur', radius: 12 });
        // Not merely `undefined` — the key must be absent, because every
        // per-effect `equals()` compares `mode` directly.
        expect('mode' in effect).toBe(false);
    });

    it('directionalBlur takes radius as the scalar and defaults angle to 0', () => {
        expect([...Effects.directionalBlur(20)]).toEqual([
            { type: 'directionalBlur', radius: 20, angle: 0 },
        ]);
        expect([...Effects.directionalBlur({ radius: 20, angle: 45 })]).toEqual([
            { type: 'directionalBlur', radius: 20, angle: 45 },
        ]);
    });

    it('pixelate maps a bare number to equal block counts and sharp colours', () => {
        expect([...Effects.pixelate(20)]).toEqual([
            { type: 'pixelate', blocks: { x: 20, y: 20 }, sharpColors: true },
        ]);
    });

    it('pixelate accepts a uniform block count with options', () => {
        expect([...Effects.pixelate({ blocks: 32, sharpColors: false })]).toEqual([
            { type: 'pixelate', blocks: { x: 32, y: 32 }, sharpColors: false },
        ]);
    });

    it('pixelate accepts per-axis block counts as one vector', () => {
        expect([...Effects.pixelate({ blocks: { x: 200, y: 180 } })]).toEqual([
            { type: 'pixelate', blocks: { x: 200, y: 180 }, sharpColors: true },
        ]);
    });

    it('grayscale produces a grayscale effect', () => {
        expect([...Effects.grayscale(0.5)]).toEqual([{ type: 'grayscale', amount: 0.5 }]);
    });

    it('bulge takes strength as the scalar and centres by default', () => {
        expect([...Effects.bulge(0.6)]).toEqual([
            { type: 'bulge', strength: 0.6, center: { x: 0.5, y: 0.5 } },
        ]);
    });

    it('bulge accepts negative strength (pinch) and an explicit centre', () => {
        expect([...Effects.bulge({ strength: -0.4, center: { x: 0.2, y: 0.8 } })]).toEqual([
            { type: 'bulge', strength: -0.4, center: { x: 0.2, y: 0.8 } },
        ]);
    });

    it('magnify defaults to backdrop mode but allows an override', () => {
        expect([...Effects.magnify(3)]).toEqual([
            { type: 'magnify', scale: 3, center: { x: 0.5, y: 0.5 }, mode: 'backdrop' },
        ]);
        expect([...Effects.magnify({ scale: 2, mode: 'foreground' })]).toEqual([
            { type: 'magnify', scale: 2, center: { x: 0.5, y: 0.5 }, mode: 'foreground' },
        ]);
    });

    it('magnify takes centre as a named option, not a second positional', () => {
        expect([...Effects.magnify({ scale: 1.5, center: { x: 0.3, y: 0.4 } })]).toEqual([
            { type: 'magnify', scale: 1.5, center: { x: 0.3, y: 0.4 }, mode: 'backdrop' },
        ]);
    });

    it('glass defaults to the glass Figma adds and runs on the backdrop', () => {
        // Figma's defaults, verbatim: a bare `Effects.glass()` is the effect a
        // designer arriving from Figma expects, and backdrop is the only target
        // it means anything on.
        expect([...Effects.glass()]).toEqual([
            {
                type: 'glass',
                lightAngle: -45,
                lightIntensity: 80,
                refraction: 80,
                depth: 20,
                dispersion: 50,
                frost: 4,
                splay: 0,
                mode: 'backdrop',
            },
        ]);
    });

    it('glass lets mode be overridden like magnify does', () => {
        const [effect] = [...Effects.glass({ depth: 40, mode: 'foreground' })];
        expect(effect).toMatchObject({ type: 'glass', depth: 40, mode: 'foreground' });
    });

    it('bloom takes intensity as the scalar', () => {
        expect([...Effects.bloom(2.5)]).toEqual([
            { type: 'bloom', threshold: 0.7, radius: 12, intensity: 2.5 },
        ]);
    });

    it('glow defaults to an uncoloured spread behind the layer', () => {
        expect([...Effects.glow()]).toEqual([
            {
                type: 'glow',
                channel: 'luminance',
                threshold: 0.5,
                radius: 25,
                spread: 0,
                intensity: 1,
                axis: 'both',
                original: 'behind',
                blend: 'screen',
                tint: 'none',
                color: 'white',
                colors: ['white', '#ffa640'],
                stops: [0, 1],
                loopStyle: 'mirror',
                cycles: 1,
                phase: 0,
            },
        ]);
    });

    it('glow hands out a fresh ramp per effect', () => {
        // Module-level default arrays, shared by reference, would let one glow's
        // ramp edit reach into every other built from the defaults.
        const [a] = [...Effects.glow()] as { colors: unknown[]; stops: unknown[] }[];
        const [b] = [...Effects.glow()] as { colors: unknown[]; stops: unknown[] }[];
        expect(a.colors).not.toBe(b.colors);
        expect(a.stops).not.toBe(b.stops);
    });

    it('invert defaults to rgba at full strength', () => {
        expect([...Effects.invert()]).toEqual([
            { type: 'invert', channel: 'rgba', strength: 1 },
        ]);
    });

    it('invert takes strength as the scalar with channel named', () => {
        expect([...Effects.invert({ channel: 'hue', strength: 0.5 })]).toEqual([
            { type: 'invert', channel: 'hue', strength: 0.5 },
        ]);
        expect([...Effects.invert(0.5)]).toEqual([
            { type: 'invert', channel: 'rgba', strength: 0.5 },
        ]);
    });

    it('scatter defaults to both axes', () => {
        expect([...Effects.scatter(10)]).toEqual([
            { type: 'scatter', strength: 10, axis: 'both' },
        ]);
    });

    it('scatter accepts a constrained axis', () => {
        expect([...Effects.scatter({ strength: 5, axis: 'x' })]).toEqual([
            { type: 'scatter', strength: 5, axis: 'x' },
        ]);
    });

    it('posterize defaults to 4 levels', () => {
        expect([...Effects.posterize()]).toEqual([{ type: 'posterize', levels: 4 }]);
    });

    it('posterize accepts an explicit level count', () => {
        expect([...Effects.posterize(2)]).toEqual([{ type: 'posterize', levels: 2 }]);
    });

    it('motionBlur defaults to a centered both-axis smear', () => {
        expect([...Effects.motionBlur()]).toEqual([
            { type: 'motionBlur', length: 50, alignment: 'centered', samples: 16, strength: 1, axis: 'both' },
        ]);
    });

    it('motionBlur accepts explicit params', () => {
        expect([...Effects.motionBlur({ length: 80, alignment: 'ahead', samples: 32, strength: 2, axis: 'x' })]).toEqual([
            { type: 'motionBlur', length: 80, alignment: 'ahead', samples: 32, strength: 2, axis: 'x' },
        ]);
    });

    it('a shader defaults to a foreground effect whose output replaces the layer', () => {
        expect([...Effects.shader({ source: 'src' })]).toEqual([
            { type: 'shader', source: 'src', language: 'wgsl', uniforms: {}, mode: 'foreground' },
        ]);
    });

    it('shader in backdrop mode omits blendMode', () => {
        const [effect] = [...Effects.shader({ source: 'src', mode: 'backdrop' })];
        expect(effect).toEqual({ type: 'shader', source: 'src', language: 'wgsl', uniforms: {}, mode: 'backdrop' });
        expect('blendMode' in effect).toBe(false);
    });

    describe('resolving a stored shader effect', () => {
        it('stamps one inside a mixed array, leaving the rest alone', () => {
            const blur = { type: 'blur', radius: 3 } as const;
            const resolved = resolveChainEffects([blur, { type: 'shader', source: 's', uniforms: {} }] as never);
            expect(resolved[0]).toBe(blur);
            expect(resolved[1]).toEqual({ type: 'shader', source: 's', uniforms: {}, contract: WGSL_CONTRACT });
        });

        it('leaves a current effect untouched, by identity', () => {
            const current = { type: 'shader', source: 's', contract: 1, uniforms: {} } as const;
            expect(resolveChainEffects(current as never)[0]).toBe(current);
        });

        it('stamps the WGSL contract on a WGSL effect that states none, and none on a retired language', () => {
            const wgsl = { type: 'shader', source: 'fn effect(in: EffectIn) -> vec4f { return vec4f(1.0); }', uniforms: {} };
            expect(resolveChainEffects(wgsl as never)[0]).toEqual({ ...wgsl, contract: WGSL_CONTRACT });
            const later = { ...wgsl, contract: 7 };
            expect(resolveChainEffects(later as never)[0]).toBe(later);
            const retired = { type: 'shader', source: 's', language: 'sksl', uniforms: {} };
            expect(resolveChainEffects(retired as never)[0]).toBe(retired);
        });

        it('no longer knows the retired sksl key, which migration rewrites', () => {
            expect(hasEffect('sksl')).toBe(false);
        });
    });

    it('wave reads a scalar amplitude as transverse (Y only)', () => {
        // A wave displacing along its own travel direction just smears, so the
        // terse form is the one that actually ripples.
        expect([...Effects.wave(20)]).toEqual([
            { type: 'wave', amplitude: { x: 0, y: 20 }, wavelength: 120, phase: 0, shape: 'linear', angle: 0, center: { x: 0.5, y: 0.5 } },
        ]);
    });

    it('wave accepts a per-axis amplitude', () => {
        const [effect] = [...Effects.wave({ amplitude: { x: 6, y: 0 }, shape: 'radial' })];
        expect(effect).toMatchObject({ type: 'wave', amplitude: { x: 6, y: 0 }, shape: 'radial' });
    });

    it('twirl takes angle as the scalar', () => {
        expect([...Effects.twirl(90)]).toEqual([
            { type: 'twirl', angle: 90, radius: 1, center: { x: 0.5, y: 0.5 } },
        ]);
    });

    it('progressiveBlur defaults to a downward linear ramp', () => {
        expect([...Effects.progressiveBlur(24)]).toEqual([
            { type: 'progressiveBlur', radius: 24, startRadius: 0, shape: 'linear', start: 0, end: 1, angle: 90, center: { x: 0.5, y: 0.5 }, samples: 20 },
        ]);
    });

    it('progressiveBlur ramps between two radii when given a near end', () => {
        // The default ramps out of sharp; a startRadius makes it a falloff
        // between two softnesses instead (a depth-of-field near field).
        const [effect] = [...Effects.progressiveBlur({ radius: 24, startRadius: 4 })];
        expect(effect).toMatchObject({ startRadius: 4, radius: 24 });
    });

    it('carries clip onto the effect, like mode', () => {
        // `clip` is the second cross-cutting option, so this is really a check
        // that EFFECT_OPTION_KEYS still drives every builder rather than `mode`
        // being special-cased somewhere.
        expect([...Effects.blur({ radius: 8, clip: true })]).toEqual([
            { type: 'blur', radius: 8, clip: true },
        ]);
        expect([...Effects.bloom({ clip: true, mode: 'backdrop' })][0]).toMatchObject({
            clip: true,
            mode: 'backdrop',
        });
    });

    it('leaves clip off the effect when it was never asked for', () => {
        // Omitted rather than `clip: undefined` — `equals()` compares the field
        // directly, so a planted undefined is not equal to an effect without it.
        expect([...Effects.blur(8)][0]).not.toHaveProperty('clip');
    });

    it('kaleidoscope rounds segments and defaults to a full fold', () => {
        expect([...Effects.kaleidoscope({ segments: 6.4 })]).toEqual([
            { type: 'kaleidoscope', segments: 6, angle: 0, center: { x: 0.5, y: 0.5 }, offset: 0, amount: 1 },
        ]);
    });

    it('the new warps all carry mode like every other effect', () => {
        for (const chain of [
            Effects.wave({ amplitude: 4, mode: 'backdrop' }),
            Effects.twirl({ angle: 30, mode: 'backdrop' }),
            Effects.progressiveBlur({ radius: 8, mode: 'backdrop' }),
        ]) {
            expect([...chain][0]).toMatchObject({ mode: 'backdrop' });
        }
    });

    it('Effects is an alias for Effects', () => {
        expect(Effects).toBe(Effects);
    });
});

describe('Effects builders — roadmap effects', () => {
    it('outline defaults to a 4px black band outside the silhouette', () => {
        expect([...Effects.outline()]).toEqual([
            { type: 'outline', width: 4, color: 'black', position: 'outside' },
        ]);
    });

    it('outline takes width as the scalar with colour and position named', () => {
        expect([...Effects.outline({ width: 10, color: '#ff0044', position: 'inside' })]).toEqual([
            { type: 'outline', width: 10, color: '#ff0044', position: 'inside' },
        ]);
    });

    it('vignette defaults to a soft black falloff', () => {
        expect([...Effects.vignette()]).toEqual([
            { type: 'vignette', amount: 0.5, radius: 0.75, softness: 0.5, color: 'black' },
        ]);
    });

    it('grain defaults to static luminance noise', () => {
        expect([...Effects.grain()]).toEqual([
            { type: 'grain', amount: 0.25, size: 1, seed: 0, animated: false, colored: false },
        ]);
    });

    it('grain accepts the animated + coloured variant', () => {
        expect([...Effects.grain({ amount: 0.4, animated: true, colored: true })]).toEqual([
            { type: 'grain', amount: 0.4, size: 1, seed: 0, animated: true, colored: true },
        ]);
    });

    it('sharpen defaults to a 1px unsharp mask', () => {
        expect([...Effects.sharpen()]).toEqual([{ type: 'sharpen', amount: 1, radius: 1 }]);
    });

    it('edges defaults to a monochrome sobel', () => {
        expect([...Effects.edges()]).toEqual([
            { type: 'edges', strength: 1, kernel: 'sobel', colored: false },
        ]);
    });

    it('edges accepts the other kernels', () => {
        expect([...Effects.edges({ kernel: 'laplacian' })]).toEqual([
            { type: 'edges', strength: 1, kernel: 'laplacian', colored: false },
        ]);
    });

    it('threshold defaults to a midpoint cut with a hair of smoothing', () => {
        expect([...Effects.threshold()]).toEqual([
            { type: 'threshold', level: 0.5, smoothness: 0.05 },
        ]);
    });

    it('radialBlur defaults to a centred zoom', () => {
        expect([...Effects.radialBlur()]).toEqual([
            { type: 'radialBlur', amount: 0.5, style: 'zoom', center: { x: 0.5, y: 0.5 }, samples: 16 },
        ]);
    });

    it('radialBlur accepts a spin about an off-centre point', () => {
        expect([...Effects.radialBlur({ amount: 0.8, style: 'spin', center: { x: 0.2, y: 0.7 } })]).toEqual([
            { type: 'radialBlur', amount: 0.8, style: 'spin', center: { x: 0.2, y: 0.7 }, samples: 16 },
        ]);
    });

    it('halftone defaults to an 8px dot screen at 45°', () => {
        expect([...Effects.halftone()]).toEqual([
            { type: 'halftone', size: 8, angle: 45, shape: 'dot', separation: 'mono' },
        ]);
    });

    it('dither defaults to 1-bit output through a 4×4 Bayer matrix', () => {
        expect([...Effects.dither()]).toEqual([
            { type: 'dither', levels: 2, matrix: 4, scale: 1, monochrome: false, noise: 'bayer' },
        ]);
    });

    it('dither takes blue noise instead of the ordered matrix', () => {
        // `matrix` is still carried (it is simply unused) so switching `noise`
        // back and forth doesn't lose the Bayer setting.
        expect([...Effects.dither({ levels: 3, noise: 'blue' })]).toEqual([
            { type: 'dither', levels: 3, matrix: 4, scale: 1, monochrome: false, noise: 'blue' },
        ]);
    });

    it('duotone defaults to a full black→white ramp', () => {
        expect([...Effects.duotone()]).toEqual([
            { type: 'duotone', amount: 1, shadows: 'black', highlights: 'white' },
        ]);
    });

    it('curves carries its points through and defaults the channel', () => {
        const points: [number, number][] = [[0, 0.1], [1, 0.9]];
        expect([...Effects.curves({ points })]).toEqual([
            { type: 'curves', points, channel: 'rgb' },
        ]);
    });

    it('colorAdjustment keeps only the fields it was given', () => {
        expect([...Effects.colorAdjustment({ contrast: 1.4, saturation: 0.6 })]).toEqual([
            { type: 'colorAdjustment', contrast: 1.4, saturation: 0.6 },
        ]);
    });

    it('colorAdjustment does not plant a mode key when passed an explicit undefined', () => {
        // The spread of the caller's options would otherwise carry `mode: undefined`
        // onto the effect, and every `equals()` compares `mode` directly.
        const [effect] = [...Effects.colorAdjustment({ brightness: 0.2, mode: undefined })];
        expect('mode' in effect).toBe(false);
    });

    it('rgbShift spreads red and blue apart horizontally by default', () => {
        expect([...Effects.rgbShift()]).toEqual([
            {
                type: 'rgbShift',
                red: { x: 4, y: 0 },
                green: { x: 0, y: 0 },
                blue: { x: -4, y: 0 },
            },
        ]);
    });

    it('rgbShift lets a named channel override the scalar spread', () => {
        expect([...Effects.rgbShift({ amount: 6, green: { x: 0, y: 3 } })]).toEqual([
            {
                type: 'rgbShift',
                red: { x: 6, y: 0 },
                green: { x: 0, y: 3 },
                blue: { x: -6, y: 0 },
            },
        ]);
    });

    it('scanlines default to 4px bands at half darkness', () => {
        expect([...Effects.scanlines()]).toEqual([
            { type: 'scanlines', spacing: 4, thickness: 0.5, darkness: 0.5, offset: 0, angle: 0 },
        ]);
    });

    it('blockDisplace defaults to sparse horizontal tears', () => {
        expect([...Effects.blockDisplace()]).toEqual([
            { type: 'blockDisplace', amount: 20, size: 16, density: 0.3, seed: 0, axis: 'x' },
        ]);
    });

    it('bitCrush defaults to 3 bits per channel with no palette', () => {
        expect([...Effects.bitCrush()]).toEqual([
            { type: 'bitCrush', bits: 3, palette: 'none', amount: 1 },
        ]);
    });

    it('bitCrush accepts a fixed hardware palette', () => {
        expect([...Effects.bitCrush({ palette: 'gameboy' })]).toEqual([
            { type: 'bitCrush', bits: 3, palette: 'gameboy', amount: 1 },
        ]);
    });

    it('ascii defaults to a 12px standard-ramp grid, white on black', () => {
        expect([...Effects.ascii()]).toEqual([
            {
                type: 'ascii',
                size: 12,
                charset: 'standard',
                fontFamily: 'monospace',
                ink: 'white',
                background: 'black',
                colored: false,
            },
        ]);
    });

    it('ascii accepts a custom ramp string in place of a named charset', () => {
        const [effect] = [...Effects.ascii({ size: 8, charset: ' .oO@' })];
        expect(effect).toMatchObject({ size: 8, charset: ' .oO@' });
    });

    it('carries the backdrop mode like every other effect', () => {
        expect([...Effects.halftone({ size: 6, mode: 'backdrop' })]).toEqual([
            { type: 'halftone', size: 6, angle: 45, shape: 'dot', separation: 'mono', mode: 'backdrop' },
        ]);
    });
});

describe('colour-valued options', () => {
    it('are stored as authored so a raw literal and a builder agree', () => {
        // Parsing at build time would make `Effects.outline({ color: 'primary' })`
        // and `{ type: 'outline', color: 'primary', … }` two different effects.
        const [effect] = [...Effects.outline({ color: 'rebeccapurple' })];
        expect(effect).toMatchObject({ color: 'rebeccapurple' });
    });

    it('accept a pre-normalised tuple as readily as a string', () => {
        const [effect] = [...Effects.duotone({ shadows: [0, 0, 0, 1], highlights: 'white' })];
        expect(effect).toMatchObject({ shadows: [0, 0, 0, 1], highlights: 'white' });
    });

    it('resolveEffectColor turns either spelling into the same RGBA', () => {
        expect(resolveEffectColor('#ff0000')).toEqual([1, 0, 0, 1]);
        expect(resolveEffectColor([1, 0, 0, 1])).toEqual([1, 0, 0, 1]);
    });

    it('sameEffectColor compares by resolved value, not by spelling', () => {
        expect(sameEffectColor('red', '#ff0000')).toBe(true);
        expect(sameEffectColor('red', [1, 0, 0, 1])).toBe(true);
        expect(sameEffectColor('red', 'blue')).toBe(false);
    });
});

describe('scalar shorthand', () => {
    // The whole point of `number | Options`: the two spellings must be
    // indistinguishable once built, so docs and call sites can use either.
    it.each([
        ['blur', () => Effects.blur(8), () => Effects.blur({ radius: 8 })],
        ['grayscale', () => Effects.grayscale(1), () => Effects.grayscale({ amount: 1 })],
        ['pixelate', () => Effects.pixelate(16), () => Effects.pixelate({ blocks: 16 })],
        ['bulge', () => Effects.bulge(0.5), () => Effects.bulge({ strength: 0.5 })],
        ['magnify', () => Effects.magnify(2), () => Effects.magnify({ scale: 2 })],
        ['bloom', () => Effects.bloom(1.5), () => Effects.bloom({ intensity: 1.5 })],
        ['glow', () => Effects.glow(1.5), () => Effects.glow({ intensity: 1.5 })],
        ['vintage', () => Effects.vintage(0.8), () => Effects.vintage({ amount: 0.8 })],
        ['chromaticAberration', () => Effects.chromaticAberration(6), () => Effects.chromaticAberration({ amount: 6 })],
        ['invert', () => Effects.invert(0.3), () => Effects.invert({ strength: 0.3 })],
        ['scatter', () => Effects.scatter(12), () => Effects.scatter({ strength: 12 })],
        ['posterize', () => Effects.posterize(3), () => Effects.posterize({ levels: 3 })],
        ['directionalBlur', () => Effects.directionalBlur(30), () => Effects.directionalBlur({ radius: 30 })],
        ['motionBlur', () => Effects.motionBlur(90), () => Effects.motionBlur({ length: 90 })],
        ['outline', () => Effects.outline(6), () => Effects.outline({ width: 6 })],
        ['vignette', () => Effects.vignette(0.8), () => Effects.vignette({ amount: 0.8 })],
        ['grain', () => Effects.grain(0.4), () => Effects.grain({ amount: 0.4 })],
        ['sharpen', () => Effects.sharpen(1.5), () => Effects.sharpen({ amount: 1.5 })],
        ['edges', () => Effects.edges(2), () => Effects.edges({ strength: 2 })],
        ['threshold', () => Effects.threshold(0.4), () => Effects.threshold({ level: 0.4 })],
        ['radialBlur', () => Effects.radialBlur(0.3), () => Effects.radialBlur({ amount: 0.3 })],
        ['halftone', () => Effects.halftone(12), () => Effects.halftone({ size: 12 })],
        ['dither', () => Effects.dither(4), () => Effects.dither({ levels: 4 })],
        ['duotone', () => Effects.duotone(0.7), () => Effects.duotone({ amount: 0.7 })],
        ['rgbShift', () => Effects.rgbShift(6), () => Effects.rgbShift({ amount: 6 })],
        ['scanlines', () => Effects.scanlines(0.8), () => Effects.scanlines({ darkness: 0.8 })],
        ['blockDisplace', () => Effects.blockDisplace(30), () => Effects.blockDisplace({ amount: 30 })],
        ['bitCrush', () => Effects.bitCrush(2), () => Effects.bitCrush({ bits: 2 })],
        ['ascii', () => Effects.ascii(16), () => Effects.ascii({ size: 16 })],
        ['glass', () => Effects.glass(60), () => Effects.glass({ refraction: 60 })],
    ])('%s(n) is identical to its options form', (_name, scalar, options) => {
        expect([...scalar()]).toEqual([...options()]);
    });
});

describe('withEffectOptions', () => {
    it('omits undefined option keys rather than writing them', () => {
        const effect = withEffectOptions({ type: 'blur' as const, radius: 4 }, { mode: undefined });
        expect('mode' in effect).toBe(false);
    });

    it('copies a defined mode through', () => {
        expect(withEffectOptions({ type: 'blur' as const, radius: 4 }, { mode: 'backdrop' })).toEqual({
            type: 'blur', radius: 4, mode: 'backdrop',
        });
    });
});

describe('foregroundShaderEffects', () => {
    it('preserves author chain order instead of a fixed sequence', () => {
        const bulgeFirst = resolveChainEffects(Effects.bulge(0.5).posterize(4));
        expect(foregroundShaderEffects(bulgeFirst).map((e) => e.type)).toEqual(['bulge', 'posterize']);

        const posterizeFirst = resolveChainEffects(Effects.posterize(4).bulge(0.5));
        expect(foregroundShaderEffects(posterizeFirst).map((e) => e.type)).toEqual(['posterize', 'bulge']);
    });

    it('returns every shader effect, not just the first of each type', () => {
        const effects = resolveChainEffects(Effects.bulge(0.2).bulge(0.4).posterize(8));
        expect(foregroundShaderEffects(effects)).toHaveLength(3);
    });

    it('excludes filter-surface effects and backdrop-mode effects', () => {
        const effects = resolveChainEffects(
            Effects.blur(4).grayscale(1).bulge(0.5).posterize({ levels: 4, mode: 'backdrop' }),
        );
        expect(foregroundShaderEffects(effects).map((e) => e.type)).toEqual(['bulge']);
    });

    it('picks up the roadmap shader effects in author order', () => {
        const effects = resolveChainEffects(
            Effects.halftone(8).outline(4).vignette(0.5).dither(2),
        );
        expect(foregroundShaderEffects(effects).map((e) => e.type)).toEqual([
            'halftone', 'outline', 'vignette', 'dither',
        ]);
    });

    it('picks up the glitch cluster in author order', () => {
        const effects = resolveChainEffects(
            Effects.blockDisplace(20).rgbShift(6).scanlines(0.4).bitCrush(2),
        );
        expect(foregroundShaderEffects(effects).map((e) => e.type)).toEqual([
            'blockDisplace', 'rgbShift', 'scanlines', 'bitCrush',
        ]);
    });

    it('leaves the colour-matrix roadmap effects on the filter path', () => {
        // duotone/colorAdjustment are affine in the source channels, so they
        // compose as Adjustments rather than opening a snapshot scope.
        const effects = resolveChainEffects(
            Effects.duotone(1).colorAdjustment({ contrast: 1.2 }),
        );
        expect(foregroundShaderEffects(effects)).toEqual([]);
    });

    it('opens a shader scope for a tone curve', () => {
        // A curve is a *lookup*, which is the one thing a colour matrix cannot
        // be. It used to sit on the filter path alongside the affine effects,
        // and the renderer paid for that by fitting a straight line through it
        // — throwing away the bends the curve was drawn for.
        const effects = resolveChainEffects(
            Effects.curves({ points: [[0, 0], [0.5, 0.8], [1, 1]] }),
        );
        expect(foregroundShaderEffects(effects).map((e) => e.type)).toEqual(['curves']);
    });

    it('treats a foreground shader as a filter, not a shader scope', () => {
        // Its surface is mode-dependent: only the backdrop variant resamples its source.
        const foreground = resolveChainEffects(Effects.shader({ source: 'src' }));
        expect(foregroundShaderEffects(foreground)).toEqual([]);
    });
});

describe('EffectChain', () => {
    it('appends effects in order while staying immutable', () => {
        const base = Effects.blur(4);
        const extended = base.grayscale(1);
        expect(base.list).toHaveLength(1);
        expect(extended.list).toHaveLength(2);
        expect(extended.list[1]).toEqual({ type: 'grayscale', amount: 1 });
    });

    it('is iterable for spreading into an array', () => {
        const arr = [...Effects.blur(2).pixelate(10)];
        expect(arr).toHaveLength(2);
        expect(arr[0]).toEqual({ type: 'blur', radius: 2 });
    });

    it('toJSON returns the raw effect list', () => {
        const chain = Effects.blur(8);
        expect(chain.toJSON()).toBe(chain.list);
    });
});

describe('resolveChainEffects', () => {
    it('returns [] for undefined', () => {
        expect(resolveChainEffects(undefined)).toEqual([]);
    });

    it('unwraps an EffectChain to its list', () => {
        const chain = Effects.blur(3);
        expect(resolveChainEffects(chain)).toBe(chain.list);
    });

    it('normalises an array, preserving its effects', () => {
        const arr = [{ type: 'blur', radius: 1 } as const];
        expect(resolveChainEffects(arr)).toEqual(arr);
    });

    it('flattens chains used as array elements', () => {
        const arr = [{ type: 'invert', channel: 'rgba', strength: 1 } as const, Effects.blur(2)];
        expect(resolveChainEffects(arr)).toEqual([
            { type: 'invert', channel: 'rgba', strength: 1 },
            { type: 'blur', radius: 2 },
        ]);
    });

    it('wraps a single effect into an array', () => {
        expect(resolveChainEffects({ type: 'blur', radius: 5 })).toEqual([{ type: 'blur', radius: 5 }]);
    });

    it('flattens the plain array a nested chain serializes to', () => {
        const live = [{ type: 'invert', channel: 'rgba', strength: 1 } as const, Effects.blur(2)];
        expect(resolveChainEffects(JSON.parse(JSON.stringify(live)))).toEqual(resolveChainEffects(live));
    });
});

// ── An effect type nobody registered ────────────────────────────────

describe('an unknown effect type', () => {
    const unknown = (extra: Record<string, unknown> = {}) => ({ type: 'plasma', amount: 3, ...extra }) as unknown as NodeEffect;

    it('is not registered', () => {
        expect(hasEffect('plasma')).toBe(false);
    });

    it('passes through resolve untouched, by identity', () => {
        const effect = unknown();
        expect(resolveEffect(effect)).toBe(effect);
        expect(resolveChainEffects(effect)).toEqual([effect]);
        expect(resolveChainEffects([effect])[0]).toBe(effect);
    });

    it('keeps the chain\'s own list when nothing in it needs rewriting', () => {
        const chain = new EffectChain([unknown(), ...Effects.blur(4).list]);
        expect(resolveChainEffects(chain)).toBe(chain.list);
    });

    it('lerps by switching at t = 0.5, whatever its fields', () => {
        const from = unknown({ amount: 0 });
        const to = unknown({ amount: 10 });
        expect(lerpEffect(from, to, 0.49)).toBe(from);
        expect(lerpEffect(from, to, 0.5)).toBe(to);
        expect(lerpEffect(from, to, 0)).toBe(from);
        expect(lerpEffect(from, to, 1)).toBe(to);
    });

    it('reports the composable \'filter\' surface', () => {
        expect(effectSurface(unknown())).toBe('filter');
        expect(effectSurface(unknown({ mode: 'backdrop' }))).toBe('filter');
    });

    it('declares nothing', () => {
        const scope = { image: vi.fn(), video: vi.fn(), loader: vi.fn(), font: vi.fn() };
        expect(() => declareEffect(unknown(), scope as unknown as AssetScope)).not.toThrow();
        for (const call of Object.values(scope)) expect(call).not.toHaveBeenCalled();
    });

    it('is equal only to itself, by reference, though its type and options match', () => {
        const a = unknown();
        expect(equalsEffect(a, a)).toBe(true);
        expect(equalsEffect(a, unknown())).toBe(false);
        expect(equalsEffect(a, { ...a, mode: 'backdrop' } as NodeEffect)).toBe(false);
    });

    it('lerps against a registered type by switching, too', () => {
        const blur = Effects.blur(4).list[0];
        const from = unknown();
        expect(lerpEffect(from, blur, 0.25)).toBe(from);
        expect(lerpEffect(from, blur, 0.75)).toBe(blur);
    });
});

// ── effectsOps.lerp ─────────────────────────────────────────────────

describe('effectsOps.lerp', () => {
    const blur = (radius: number) => Effects.blur(radius).list;
    const gray = (amount: number) => Effects.grayscale(amount).list;

    it('returns from itself when from is to', () => {
        const same = blur(4);
        expect(effectsOps.lerp(same, same, 0.5)).toBe(same);
    });

    it('lerps two effects of one type with that type\'s entry', () => {
        const [mid] = effectsOps.lerp(blur(0), blur(10), 0.5);
        expect(mid).toMatchObject({ type: 'blur', radius: 5 });
    });

    it('yields from before t = 0.5 and to from there on for two different types', () => {
        const from = blur(4);
        const to = gray(1);
        expect(effectsOps.lerp(from, to, 0.49)[0]).toBe(from[0]);
        expect(effectsOps.lerp(from, to, 0.5)[0]).toBe(to[0]);
    });

    it('works index by index over the longer chain', () => {
        const from = [...blur(0), ...gray(0)];
        const to = [...blur(10), ...gray(1), ...Effects.invert(1).list];
        const out = effectsOps.lerp(from, to, 0.5);
        expect(out).toHaveLength(3);
        expect(out[0]).toMatchObject({ type: 'blur', radius: 5 });
        expect(out[1]).toMatchObject({ type: 'grayscale', amount: 0.5 });
        expect(out[2]).toMatchObject({ type: 'invert' });
    });

    it('carries an effect present on one side only, unchanged, at any t', () => {
        const only = Effects.invert(1).list;
        const from = [...blur(2)];
        const to = [...blur(2), ...only];
        for (const t of [0, 0.25, 1]) {
            expect(effectsOps.lerp(from, to, t)[1]).toBe(only[0]);
            expect(effectsOps.lerp(to, from, t)[1]).toBe(only[0]);
        }
    });

    it('takes an effect as it is when the other side has none', () => {
        const to = blur(6);
        expect(effectsOps.lerp([], to, 0.5)[0]).toBe(to[0]);
        expect(effectsOps.lerp(to, [], 0.5)[0]).toBe(to[0]);
    });

    it('gives an empty array for two distinct empty arrays', () => {
        const out = effectsOps.lerp([], [], 0.5);
        expect(out).toEqual([]);
    });

    it('does not clamp t: an overshoot goes past the destination, an undershoot before the source', () => {
        expect(effectsOps.lerp(blur(0), blur(10), 1.5)[0]).toMatchObject({ radius: 15 });
        expect(effectsOps.lerp(blur(0), blur(10), -0.5)[0]).toMatchObject({ radius: -5 });
    });

    it('switches a discrete field by t even outside [0, 1]', () => {
        const a = Effects.blur({ radius: 4, mode: 'foreground' }).list;
        const b = Effects.blur({ radius: 4, mode: 'backdrop' }).list;
        expect(effectsOps.lerp(a, b, -1)[0].mode).toBe('foreground');
        expect(effectsOps.lerp(a, b, 2)[0].mode).toBe('backdrop');
    });

    it('does not write to either array or to the effects in them', () => {
        const from = blur(0);
        const to = [...blur(10), ...gray(1)];
        const before = JSON.stringify([from, to]);
        effectsOps.lerp(from, to, 0.5);
        expect(JSON.stringify([from, to])).toBe(before);
    });
});

// ── The backdrop classifiers ────────────────────────────────────────

describe('isBackdropEffect and backdropEffects', () => {
    const fore = Effects.blur(4).list[0];
    const back = Effects.blur({ radius: 4, mode: 'backdrop' }).list[0];
    const explicitFore = Effects.blur({ radius: 4, mode: 'foreground' }).list[0];

    it('tests mode === backdrop', () => {
        expect(isBackdropEffect(back)).toBe(true);
        expect(isBackdropEffect(fore)).toBe(false);
        expect(isBackdropEffect(explicitFore)).toBe(false);
    });

    it('takes the effects that default to backdrop at their word', () => {
        expect(isBackdropEffect(Effects.magnify(2).list[0])).toBe(true);
        expect(isBackdropEffect(Effects.glass({}).list[0])).toBe(true);
        expect(isBackdropEffect(Effects.magnify({ scale: 2, mode: 'foreground' }).list[0])).toBe(false);
    });

    it('returns the backdrop subset, in order', () => {
        const other = Effects.grayscale({ amount: 1, mode: 'backdrop' }).list[0];
        expect(backdropEffects([fore, back, explicitFore, other])).toEqual([back, other]);
        expect(backdropEffects([fore, back, explicitFore, other])[0]).toBe(back);
    });

    it('returns nothing for a chain with no backdrop effect, a fresh array if it had to look', () => {
        expect(backdropEffects([fore, explicitFore])).toEqual([]);
    });

    it('shares one empty array for an empty input, so the common case allocates nothing', () => {
        expect(backdropEffects([])).toBe(backdropEffects([]));
        expect(backdropEffects([])).toEqual([]);
    });

    it('does not write to the list it filters', () => {
        const list = [fore, back];
        backdropEffects(list);
        expect(list).toEqual([fore, back]);
    });
});
