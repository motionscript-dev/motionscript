import type { AudioEffectData } from "../registry";
import { Param, lerpParam, equalsParam } from "../../ramp";

/** Scales the clip's amplitude by a linear factor. */
export interface GainEffect {
    type: 'gain';
    /** Linear gain multiplier. 1 = unchanged, 0 = silent, >1 = louder. May be a ramp. */
    value: Param;
}

export const gainEffect: AudioEffectData<GainEffect> = {
    lerp: (from, to, t) => ({ type: "gain", value: lerpParam(from.value, to.value, t) }),
    equals: (a, b) => equalsParam(a.value, b.value),
};
