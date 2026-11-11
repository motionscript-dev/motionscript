import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** A shadow cast from the node's **alpha silhouette** rather than its geometry. A shape's `shadow` fills the node's outline, right for a rect or star but wrong for anything whose form comes from *pixels* (a cut-out PNG, alpha video, text, a subtree), which would cast a blurred rectangle. Computed from what the node drew, as {@link OutlineEffect} is to `stroke`. Offsets are in scene axes (positive `y` lifts the shadow), matching `ShadowProp.offset`, not the shader's y-down device space. */
export interface DropShadowEffect extends ModedEffect, EffectFields<typeof dropShadowSpec.params> {
    type: "dropShadow";
}

export const dropShadowSpec = defineEffect({
    type: "dropShadow",
    group: "stylize",
    surface: "shader",
    // Softness is the knob a shadow is usually reached for by.
    scalar: "blur",
    onlyOn: "foreground",
    // Nowhere to fall, no softness and no growth: nothing of it is ever visible.
    neutral: { offsetX: 0, offsetY: 0, blur: 0, spread: 0 },
    params: {
        /** Horizontal displacement in pixels. */
        offsetX: param.number({ default: 0, unit: "px", label: "shadowX" }),
        /** Vertical displacement in pixels, positive being upward. */
        offsetY: param.number({ default: -8, unit: "px", label: "shadowY" }),
        /** Softness in pixels, on a `blur` effect's scale. */
        blur: param.number({ default: 16, min: 0, unit: "px", label: "shadowBlur", inline: true }),
        /** Grows the silhouette before blurring, in pixels. */
        spread: param.number({ default: 0, min: 0, unit: "px", label: "shadowSpread" }),
        /** Shadow colour. */
        color: param.color({ default: "black" }),
    },
});

export const dropShadowEffect: EffectData<DropShadowEffect> = effectDataOf(dropShadowSpec);
