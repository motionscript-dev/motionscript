import type { AudioEffectData } from "../registry";
import { Param, lerpParam, equalsParam } from "../../ramp";

/** Attenuates frequencies above `frequency`, passing the lows through. */
export interface LowPassEffect {
    type: 'lowpass';
    /** Cutoff frequency in Hz. Content above this is rolled off. May be a ramp. */
    frequency: Param;
    /** Resonance (Q) at the cutoff. Default 1. May be a ramp. */
    q?: Param;
}

export const lowPassEffect: AudioEffectData<LowPassEffect> = {
    lerp: (from, to, t) => ({
        type: "lowpass",
        frequency: lerpParam(from.frequency, to.frequency, t),
        q: lerpParam(from.q ?? 1, to.q ?? 1, t),
    }),
    equals: (a, b) => equalsParam(a.frequency, b.frequency) && equalsParam(a.q ?? 1, b.q ?? 1),
};
