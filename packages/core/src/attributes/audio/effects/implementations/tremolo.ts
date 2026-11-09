import type { AudioEffectData } from "../registry";
import { Param, lerpParam, equalsParam } from "../../ramp";

/** Modulates the clip's amplitude with a low-frequency oscillator for a wobble effect. */
export interface TremoloEffect {
    type: 'tremolo';
    /** Modulation rate in Hz (how fast the volume pulses). May be a ramp. */
    rate: Param;
    /** Modulation depth, 0–1. 0 = no effect, 1 = full dips to silence. May be a ramp. */
    depth: Param;
}

export const tremoloEffect: AudioEffectData<TremoloEffect> = {
    lerp: (from, to, t) => ({
        type: "tremolo",
        rate: lerpParam(from.rate, to.rate, t),
        depth: lerpParam(from.depth, to.depth, t),
    }),
    equals: (a, b) => equalsParam(a.rate, b.rate) && equalsParam(a.depth, b.depth),
};
