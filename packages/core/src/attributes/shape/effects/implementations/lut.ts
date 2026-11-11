import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * A 3D colour lookup table (the `.cube` a colourist hands you): not a formula but a measured cube of what each colour
 * should *become*, so no combination of curves and matrices substitutes for it. A node effect rather than a media-only
 * adjustment on purpose: outside {@link NonFilterEffect} everything is an `EffectAdjustment` too, so one implementation
 * grades an image fill and a whole node and the two stay the same look.
 *
 * The table is flat RGB triples, **red-fastest** (index `((b · size) + g) · size + r`, times three), the order a `.cube`
 * file writes, so a parser fills it with no transposition. It is a `Float32Array` treated as **immutable and shared**:
 * `equals` compares by reference and `lerp` hard-cuts it, because a 33³ cube is 107,811 floats (comparing per frame
 * costs more than the draw, interpolating allocates a cube per frame) and the renderer's GPU upload is cached against
 * this identity. Hand back the same array each frame for one upload per scene. Cross-fading two LUTs is a cut; dissolve
 * with two fills or {@link amount}.
 */
export interface LutEffect extends ModedEffect, EffectFields<typeof lutSpec.params> {
    type: "lut";
}

export const lutSpec = defineEffect({
    type: "lut",
    group: "color",
    // It samples a second texture at a coordinate derived from the source's colour, so it needs the source as a readable shader, not a composable colour matrix.
    surface: "shader",
    // A LUT's neutral is its mix, not its table.
    neutral: { amount: 0 },
    params: {
        /** The cube: flat RGB triples, red-fastest. Compared by reference, cut by `lerp`. */
        table: param.of<Float32Array>()({ kind: "table", required: true, hidden: true }),
        /** Entries per axis. Cuts with the table: a table read at the wrong stride is garbage, not a wrong colour. */
        size: param.number({ required: true, min: 2, step: 1, lerp: "step", hidden: true }),
        /** 0–1 mix against the ungraded colour. */
        amount: param.number({ default: 1, min: 0, max: 1, control: "slider", inline: true }),
    },
});

export const lutEffect: EffectData<LutEffect> = effectDataOf(lutSpec);
