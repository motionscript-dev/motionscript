import { AudioEffect } from "./union";
import { Param, isRamp } from "../ramp";

/** Every builder takes one options object; those with one dominant param also take it directly (a number or a {@link Ramp}), so `AudioEffects.lowpass(ramp(8000, 400, 2))` works. */

/** Gain. Param shorthand sets `value`. */
export interface GainEffectOptions {
    /** 1 = unchanged, 0 = silent, >1 = louder. */
    value: Param;
}

/** High-pass filter. Param shorthand sets `frequency`. */
export interface HighPassEffectOptions {
    /** Rolls off content below this frequency, in Hz. */
    frequency: Param;
    /** Resonance at the cutoff (default 1). */
    q?: Param;
}

/** Low-pass filter. Param shorthand sets `frequency`. */
export interface LowPassEffectOptions {
    /** Rolls off content above this frequency, in Hz. */
    frequency: Param;
    /** Resonance at the cutoff (default 1). */
    q?: Param;
}

/** Amplitude wobble. Param shorthand sets `rate`. */
export interface TremoloEffectOptions {
    /** Wobble rate in Hz. */
    rate: Param;
    /** Modulation depth, 0–1 (default 0.5). */
    depth?: Param;
}

/** Delay line with feedback. Param shorthand sets `delay`. */
export interface EchoEffectOptions {
    /** Delay time in seconds. */
    delay: Param;
    /** Feedback amount, 0–<1 (default 0.4). */
    feedback?: Param;
    /** Wet mix, 0–1 (default 0.5). */
    mix?: Param;
}

/** A ramp is an object too, so the shorthand test has to ask {@link isRamp}, or it reads as an options bag. */
function scalarParam<O extends object>(arg: Param | O, key: keyof O): O {
    return typeof arg === "number" || isRamp(arg) ? ({ [key]: arg } as O) : (arg as O);
}

/** Immutable, chainable list of audio effects applied in order (index 0 closest to the source): `AudioEffects.gain(1.5).lowpass(800).echo(0.3)`. */
export class AudioEffectChain {
    constructor(public list: AudioEffect[] = []) { }

    private append(effect: AudioEffect): AudioEffectChain {
        return new AudioEffectChain([...this.list, effect]);
    }

    gain(options: Param | GainEffectOptions) {
        const { value } = scalarParam(options, "value");
        return this.append({ type: 'gain', value });
    }

    /** Alias for {@link gain}. */
    volume(options: Param | GainEffectOptions) {
        return this.gain(options);
    }

    /** Rolls off content below `frequency` Hz. */
    highpass(options: Param | HighPassEffectOptions) {
        const { frequency, q } = scalarParam(options, "frequency");
        return this.append({ type: 'highpass', frequency, q });
    }

    /** Rolls off content above `frequency` Hz. */
    lowpass(options: Param | LowPassEffectOptions) {
        const { frequency, q } = scalarParam(options, "frequency");
        return this.append({ type: 'lowpass', frequency, q });
    }

    /** A `rate` Hz wobble at `depth` (0–1). */
    tremolo(options: Param | TremoloEffectOptions) {
        const { rate, depth } = scalarParam(options, "rate");
        return this.append({ type: 'tremolo', rate, depth: depth ?? 0.5 });
    }

    /** `delay` seconds, `feedback` 0–<1, optional wet `mix` 0–1. */
    echo(options: Param | EchoEffectOptions) {
        const { delay, feedback, mix } = scalarParam(options, "delay");
        return this.append({ type: 'echo', delay, feedback: feedback ?? 0.4, mix });
    }

    *[Symbol.iterator]() {
        yield* this.list;
    }

    toJSON() {
        return this.list;
    }
}

/** What an `effects` prop accepts: one effect, a plain array, or a chain. */
export type AudioEffectsInput = AudioEffect[] | AudioEffectChain | AudioEffect;

/** An empty {@link AudioEffectChain}: `AudioEffects.gain(1.5)` is `new AudioEffectChain().gain(1.5)`. */
export const AudioEffects = new AudioEffectChain();

export function resolveAudioEffects(effects: AudioEffectsInput | undefined): AudioEffect[] {
    if (effects === undefined) return [];
    if (effects instanceof AudioEffectChain) return effects.list;
    if (Array.isArray(effects)) return effects;
    return [effects];
}
