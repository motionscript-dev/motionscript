import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** CRT scanlines: periodic dark bands. `offset` scrolls the pattern (animating it past `spacing` gives a mistuned display's slow roll) and wraps, so a linear tween loops seamlessly. */
export interface ScanlinesEffect extends ModedEffect, EffectFields<typeof scanlinesSpec.params> {
    type: "scanlines";
}

export const scanlinesSpec = defineEffect({
    type: "scanlines",
    group: "stylize",
    // The band a pixel falls in depends on its position.
    surface: "shader",
    scalar: "darkness",
    neutral: { darkness: 0 },
    params: {
        /** Distance between band centres in px. */
        spacing: param.number({ default: 4, min: 1, unit: "px", order: 1 }),
        /** 0–1 share of each period the dark band covers. */
        thickness: param.number({ default: 0.5, min: 0, max: 1, control: "slider", order: 2 }),
        /** 0–1 how far the bands darken. */
        darkness: param.number({ default: 0.5, min: 0, max: 1, control: "slider", inline: true, order: 0 }),
        /** Band offset in px — animate to roll the pattern; it wraps. */
        offset: param.number({ default: 0, unit: "px", order: 3 }),
        /** Band angle in degrees; 0 = horizontal. */
        angle: param.number({ default: 0, unit: "deg", control: "angle", order: 4 }),
    },
});

export const scanlinesEffect: EffectData<ScanlinesEffect> = effectDataOf(scanlinesSpec);
