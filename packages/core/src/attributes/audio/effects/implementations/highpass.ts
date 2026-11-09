import type { AudioEffectData } from "../registry";
import { Param, lerpParam, equalsParam } from "../../ramp";

/** Attenuates frequencies below `frequency`, passing the highs through. */
export interface HighPassEffect {
    type: 'highpass';
    /** Cutoff frequency in Hz. Content below this is rolled off. May be a ramp. */
    frequency: Param;
    /** Resonance (Q) at the cutoff. Default 1. May be a ramp. */
    q?: Param;
}

export const highPassEffect: AudioEffectData<HighPassEffect> = {
    lerp: (from, to, t) => ({
        type: "highpass",
        frequency: lerpParam(from.frequency, to.frequency, t),
        q: lerpParam(from.q ?? 1, to.q ?? 1, t),
    }),
    equals: (a, b) => equalsParam(a.frequency, b.frequency) && equalsParam(a.q ?? 1, b.q ?? 1),
};
