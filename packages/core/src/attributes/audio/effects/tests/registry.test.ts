import { describe, it, expect } from 'vitest';
import { AudioEffectRegistry } from '@/attributes/audio/effects/registry';
import type { AudioEffect } from '@/attributes/audio/effects/union';
import { ramp } from '@/attributes/audio/ramp';

describe('AudioEffectRegistry registration', () => {
    it('registers all five built-in effects', () => {
        for (const type of ['gain', 'highpass', 'lowpass', 'tremolo', 'echo']) {
            expect(AudioEffectRegistry.has(type)).toBe(true);
        }
    });
});

describe('AudioEffectRegistry.lerp', () => {
    it('lerps gain linearly', () => {
        const r = AudioEffectRegistry.lerp({ type: 'gain', value: 0 }, { type: 'gain', value: 2 }, 0.5);
        expect(r).toEqual({ type: 'gain', value: 1 });
    });

    it('lerps echo across all params, defaulting mix to 0.5', () => {
        const r = AudioEffectRegistry.lerp(
            { type: 'echo', delay: 0, feedback: 0 },
            { type: 'echo', delay: 0.4, feedback: 0.8, mix: 1 },
            0.5,
        );
        expect(r).toEqual({ type: 'echo', delay: 0.2, feedback: 0.4, mix: 0.75 });
    });

    it('hard-cuts at t=0.5 when types differ', () => {
        const from: AudioEffect = { type: 'gain', value: 1 };
        const to: AudioEffect = { type: 'lowpass', frequency: 800 };
        expect(AudioEffectRegistry.lerp(from, to, 0.4)).toBe(from);
        expect(AudioEffectRegistry.lerp(from, to, 0.6)).toBe(to);
    });

    it('hard-cuts a ramp-valued param at t=0.5 instead of lerping', () => {
        const curve = ramp(0, 1, 1);
        const from: AudioEffect = { type: 'gain', value: 2 };
        const to: AudioEffect = { type: 'gain', value: curve };
        expect(AudioEffectRegistry.lerp(from, to, 0.4)).toEqual({ type: 'gain', value: 2 });
        expect(AudioEffectRegistry.lerp(from, to, 0.6)).toEqual({ type: 'gain', value: curve });
    });
});

describe('AudioEffectRegistry.equals', () => {
    it('treats omitted optional params as their default', () => {
        const echo = AudioEffectRegistry.get('echo')!;
        expect(echo.equals(
            { type: 'echo', delay: 0.3, feedback: 0.4 } as AudioEffect,
            { type: 'echo', delay: 0.3, feedback: 0.4, mix: 0.5 } as AudioEffect,
        )).toBe(true);
    });
});

describe('AudioEffectRegistry.lerpArray', () => {
    it('lerps matched indices and keeps unmatched ones', () => {
        const from: AudioEffect[] = [{ type: 'gain', value: 0 }];
        const to: AudioEffect[] = [{ type: 'gain', value: 2 }, { type: 'lowpass', frequency: 800 }];
        expect(AudioEffectRegistry.lerpArray(from, to, 0.5)).toEqual([
            { type: 'gain', value: 1 },
            { type: 'lowpass', frequency: 800 },
        ]);
    });
});
