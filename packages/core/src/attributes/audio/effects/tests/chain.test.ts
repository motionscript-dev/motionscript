import { describe, it, expect } from 'vitest';
import { AudioEffects, AudioEffectChain, resolveAudioEffects } from '@/attributes/audio/effects/chain';
import { ramp, isRamp } from '@/attributes/audio/ramp';

describe('AudioEffects builders', () => {
    it('gain produces a single gain effect', () => {
        expect([...AudioEffects.gain(2)]).toEqual([{ type: 'gain', value: 2 }]);
    });

    it('highpass/lowpass carry frequency and optional q', () => {
        expect([...AudioEffects.highpass(2000)]).toEqual([{ type: 'highpass', frequency: 2000, q: undefined }]);
        expect([...AudioEffects.lowpass({ frequency: 500, q: 0.7 })]).toEqual([{ type: 'lowpass', frequency: 500, q: 0.7 }]);
    });

    it('tremolo carries rate and depth', () => {
        expect([...AudioEffects.tremolo({ rate: 6, depth: 0.7 })]).toEqual([{ type: 'tremolo', rate: 6, depth: 0.7 }]);
    });

    it('tremolo defaults depth so the rate shorthand is usable alone', () => {
        expect([...AudioEffects.tremolo(6)]).toEqual([{ type: 'tremolo', rate: 6, depth: 0.5 }]);
    });

    it('echo carries delay, feedback, and optional mix', () => {
        expect([...AudioEffects.echo({ delay: 0.3, feedback: 0.45, mix: 0.5 })]).toEqual([
            { type: 'echo', delay: 0.3, feedback: 0.45, mix: 0.5 },
        ]);
    });

    it('echo defaults feedback so the delay shorthand is usable alone', () => {
        expect([...AudioEffects.echo(0.3)]).toEqual([
            { type: 'echo', delay: 0.3, feedback: 0.4, mix: undefined },
        ]);
    });

    it('volume is an alias for gain', () => {
        expect([...AudioEffects.volume(2)]).toEqual([{ type: 'gain', value: 2 }]);
        expect([...AudioEffects.gain(2).volume(1.5)]).toEqual([
            { type: 'gain', value: 2 },
            { type: 'gain', value: 1.5 },
        ]);
    });

    it('accepts a Ramp as a param and stores it verbatim', () => {
        const curve = ramp(0, 1, 0.5).hold().ramp(1, 0, 1);
        const [filter] = [...AudioEffects.volume(curve)];
        expect(filter.type).toBe('gain');
        if (filter.type !== 'gain') throw new Error('expected gain');
        expect(isRamp(filter.value)).toBe(true);
        expect(filter.value).toBe(curve);
    });

    it('mixes scalar and curve params across a chain', () => {
        const sweep = ramp(200, 2000, 1);
        const chain = AudioEffects.volume(ramp(0, 1, 0.5)).highpass(sweep).lowpass(1200);
        const [gain, hp, lp] = [...chain];
        if (gain.type !== 'gain' || hp.type !== 'highpass' || lp.type !== 'lowpass') {
            throw new Error('unexpected effect order');
        }
        expect(isRamp(gain.value)).toBe(true);
        expect(isRamp(hp.frequency)).toBe(true);
        expect(lp.frequency).toBe(1200);
    });
});

describe('AudioEffectChain', () => {
    it('appends effects in order while staying immutable', () => {
        const base = AudioEffects.gain(2);
        const extended = base.lowpass(800);
        expect(base.list).toHaveLength(1);
        expect(extended.list).toHaveLength(2);
        expect(extended.list).toEqual([
            { type: 'gain', value: 2 },
            { type: 'lowpass', frequency: 800, q: undefined },
        ]);
    });

    it('toJSON serializes to the raw effect array', () => {
        expect(AudioEffects.gain(2).echo({ delay: 0.3, feedback: 0.4 }).toJSON()).toEqual([
            { type: 'gain', value: 2 },
            { type: 'echo', delay: 0.3, feedback: 0.4, mix: undefined },
        ]);
    });
});

describe('resolveAudioEffects', () => {
    it('returns [] for undefined', () => {
        expect(resolveAudioEffects(undefined)).toEqual([]);
    });

    it('unwraps a chain to its list', () => {
        const chain = AudioEffects.gain(2).lowpass(800);
        expect(resolveAudioEffects(chain)).toBe(chain.list);
    });

    it('passes a plain array through', () => {
        const arr = [{ type: 'gain', value: 2 } as const];
        expect(resolveAudioEffects(arr)).toBe(arr);
    });

    it('wraps a single effect in an array', () => {
        expect(resolveAudioEffects({ type: 'gain', value: 2 })).toEqual([{ type: 'gain', value: 2 }]);
    });

    it('handles a bare AudioEffectChain instance', () => {
        expect(resolveAudioEffects(new AudioEffectChain())).toEqual([]);
    });
});
