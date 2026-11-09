import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Per-channel spatial offset — the red/green/blue planes pulled apart along
 * independent vectors.
 *
 * Where `chromaticAberration` models a *lens*, so its fringing is symmetric and
 * driven by one distance and angle, this is the digital-artefact version: each
 * channel is displaced wherever you point it, including all three differently.
 * That freedom is what makes it the RGB-tear component of a glitch, and it is
 * why the two effects coexist rather than one subsuming the other.
 *
 * Offsets are in px and scale with the node, like every other px option.
 */
export interface RgbShiftEffect extends ModedEffect, EffectFields<typeof rgbShiftSpec.params> {
    type: "rgbShift";
}

/** The {@link RgbShiftEffect} spec: its parameters, defaults and ranges. */
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
