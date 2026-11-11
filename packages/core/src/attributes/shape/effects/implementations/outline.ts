import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Where the outline sits relative to the silhouette, as in Figma and Illustrator: `"outside"` grows outward leaving the content untouched, `"inside"` eats inward so the footprint never changes, `"center"` straddles the edge. */
export type OutlinePosition = "outside" | "center" | "inside";

/** A coloured band traced around the node's silhouette (the alpha outline): what a geometry stroke can't give when the silhouette comes from text, an image's alpha, or a subtree. */
export interface OutlineEffect extends ModedEffect, EffectFields<typeof outlineSpec.params> {
    type: "outline";
}

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
