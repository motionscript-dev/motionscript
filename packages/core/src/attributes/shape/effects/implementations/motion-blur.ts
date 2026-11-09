import { lerpNumber } from "@/tween/lerp";
import { lerpVector2 } from "@/attributes/layout/vector2";
import type { ModedEffect, EffectData } from "../effect-data";
import { resolveEffectAxis } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Shutter phase presets — see {@link MotionBlurEffect.alignment}. */
export type MotionBlurAlignment = "behind" | "centered" | "ahead" | number;

/**
 * Velocity-driven motion blur. Unlike {@link DirectionalBlurEffect}, whose smear
 * is authored, this derives its direction and length from the node's actual
 * per-frame motion (sampled by the renderer), modelled on After Effects' shutter
 * angle (`length`) and shutter phase (`alignment`). A static node renders sharp.
 */
export interface MotionBlurEffect extends ModedEffect, EffectFields<typeof motionBlurSpec.params> {
    type: "motionBlur";
}

/** Resolve {@link MotionBlurEffect.alignment} to a shutter-phase number in −1…1. */
export function resolveMotionBlurAlignment(alignment: MotionBlurAlignment): number {
    switch (alignment) {
        case "behind": return -1;
        case "centered": return 0;
        case "ahead": return 1;
        default: return Math.max(-1, Math.min(1, alignment));
    }
}

/** The {@link MotionBlurEffect} spec: its parameters, defaults and ranges. */
export const motionBlurSpec = defineEffect({
    type: "motionBlur",
    group: "blur",
    scalar: "length",
    neutral: { length: 0 },
    params: {
        /**
         * Shutter "openness" as a percentage, the user-friendly form of a shutter
         * angle. `100` ≈ 360° = a smear spanning the node's full per-frame
         * displacement; `0` = no blur.
         */
        length: param.number({ default: 50, min: 0, unit: "percent", label: "shutter", inline: true }),
        /**
         * Shutter phase — where the smear sits relative to the node's current
         * position along its motion: `'behind'` (−1) trails it, `'centered'` (0)
         * straddles it, `'ahead'` (1) leads it; a number in −1…1 sits between.
         */
        alignment: param.of<MotionBlurAlignment>()({
            kind: "enum",
            default: "centered",
            options: ["centered", "behind", "ahead"],
            optionsLabel: "motionBlurAlignment",
            // Resolved to a phase, so e.g. 'behind' → 'ahead' sweeps.
            lerp: (a, b, t) => lerpNumber(resolveMotionBlurAlignment(a), resolveMotionBlurAlignment(b), t),
            equals: (a, b) => resolveMotionBlurAlignment(a) === resolveMotionBlurAlignment(b),
        }),
        /** Renderer quality hint; above 32 switches to multi-tap accumulation. */
        samples: param.number({ default: 16, min: 1, step: 1, hidden: true }),
        /** Blur-length multiplier. */
        strength: param.number({ default: 1, min: 0, max: 2, control: "slider" }),
        /** Per-axis velocity scale. */
        axis: param.axis({
            default: "both",
            optionsLabel: "effectAxis",
            lerp: (a, b, t) => lerpVector2(resolveEffectAxis(a), resolveEffectAxis(b), t),
        }),
    },
});

export const motionBlurEffect: EffectData<MotionBlurEffect> = effectDataOf(motionBlurSpec);
