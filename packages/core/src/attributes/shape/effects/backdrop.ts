import type { NodeEffect } from "./union";
import { effectSurface } from "./registry";

/** Backdrop/foreground classification: every effect carries a uniform {@link EffectMode}, so it is a single field read with no branching on `effect.type`. `"backdrop"` runs on the content beneath the node (clipped to its silhouette); anything else is a foreground effect over its own content. */

export const isBackdropEffect = (effect: NodeEffect): boolean => effect.mode === "backdrop";

/** Shared result for the common "no effects" case: both classifiers run once per node per frame and `.filter` allocates even with nothing to filter. */
const NONE: NodeEffect[] = [];

/** The backdrop-targeting effects in `effects`, for the renderer's backdrop pass. */
export const backdropEffects = (effects: NodeEffect[]): NodeEffect[] =>
    effects.length === 0 ? NONE : effects.filter(isBackdropEffect);

/** Foreground effects that warp/band the node's *own* content and so need a snapshot-and-redraw scope rather than a composable image filter. Driven by each effect's declared {@link EffectSurface}, so a new shader effect needs no edit here; chain order is kept (index 0 outermost). */
export function foregroundShaderEffects(effects: NodeEffect[]): NodeEffect[] {
    if (effects.length === 0) return NONE;
    return effects.filter((e) => e.mode !== "backdrop" && effectSurface(e) === "shader");
}
