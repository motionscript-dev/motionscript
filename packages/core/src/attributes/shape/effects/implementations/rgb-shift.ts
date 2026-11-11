import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Per-channel spatial offset: the red/green/blue planes pulled apart along independent vectors. Where `chromaticAberration` models a *lens* (symmetric fringing from one distance and angle), this is the digital-artefact version, each channel displaced wherever you point it: the RGB-tear of a glitch. Offsets are in px and scale with the node. */
export interface RgbShiftEffect extends ModedEffect, EffectFields<typeof rgbShiftSpec.params> {
    type: "rgbShift";
}

export const rgbShiftSpec = defineEffect({
    type: "rgbShift",
    group: "glitch",
    // Samples each channel at a different position.
    surface: "shader",
    neutral: { red: { x: 0, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 0, y: 0 } },
    params: {
        /** Red plane offset in px. */
        red: param.vec2({ default: { x: 4, y: 0 }, unit: "px", label: "redOffset" }),
        /** Green plane offset in px. */
        green: param.vec2({ default: { x: 0, y: 0 }, unit: "px", label: "greenOffset" }),
        /** Blue plane offset in px. */
        blue: param.vec2({ default: { x: -4, y: 0 }, unit: "px", label: "blueOffset" }),
    },
});

export const rgbShiftEffect: EffectData<RgbShiftEffect> = effectDataOf(rgbShiftSpec);
