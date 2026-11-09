import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Where the outline sits relative to the node's silhouette — the same three
 * choices Figma and Illustrator offer for a stroke:
 *
 * - `"outside"` grows outward from the edge, leaving the content untouched.
 * - `"inside"` eats inward, so the node's footprint never changes.
 * - `"center"` straddles the edge, half of `width` on each side.
 */
export type OutlinePosition = "outside" | "center" | "inside";

/**
 * A coloured band traced around the node's silhouette — the alpha outline
 * (a.k.a. "stroke" in Figma) that geometry strokes can't give you when the
 * silhouette comes from text, an image's alpha, or a whole subtree.
 */
export interface OutlineEffect extends ModedEffect, EffectFields<typeof outlineSpec.params> {
    type: "outline";
}

/** The {@link OutlineEffect} spec: its parameters, defaults and ranges. */
export const outlineSpec = defineEffect({
    type: "outline",
    group: "stylize",
    // Reads a ring of neighbouring texels to dilate/erode the source's alpha.
    surface: "shader",
    scalar: "width",
    onlyOn: "foreground",
    neutral: { width: 0 },
    params: {
        /** Band thickness in pixels. */
        width: param.number({ default: 4, min: 0, unit: "px", inline: true }),
        /** Band colour. */
        color: param.color({ default: "black" }),
        /** Which side of the edge the band grows from. */
        position: param.choice(["outside", "center", "inside"] satisfies OutlinePosition[], { default: "outside", optionsLabel: "outlinePosition" }),
    },
});

export const outlineEffect: EffectData<OutlineEffect> = effectDataOf(outlineSpec);
