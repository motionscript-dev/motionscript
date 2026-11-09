import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * A shadow cast from the node's **alpha silhouette** rather than from its
 * geometry — the drop shadow that a `shadow` prop can't give you when the shape
 * on screen isn't the shape of the path.
 *
 * A shape's `shadow` fills the node's own outline with the shadow colour and
 * blurs it, which is exactly right for a rect, an ellipse or a star. It is
 * exactly wrong for anything whose visible form comes from *pixels*: a cut-out
 * PNG, a video with an alpha channel, a line of text, a whole subtree. All of
 * those cast a blurred **rectangle**, because the rectangle is what their path
 * is — and on a cut-out subject that reads as a bug rather than as a shadow.
 *
 * So this one is computed from what the node actually drew. Same relationship
 * to `shadow` that {@link OutlineEffect} has to `stroke`: the geometry version
 * is cheaper and sharper where the path *is* the picture, and this one is the
 * answer everywhere else.
 *
 * Offsets are in the scene's own axes — a positive `y` lifts the shadow upward,
 * matching `ShadowProp.offset` rather than the y-down device space the shader
 * runs in, so the two kinds of shadow move the same way under the same numbers.
 */
export interface DropShadowEffect extends ModedEffect, EffectFields<typeof dropShadowSpec.params> {
    type: "dropShadow";
}

/** The {@link DropShadowEffect} spec: its parameters, defaults and ranges. */
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
