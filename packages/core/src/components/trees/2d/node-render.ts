import { RenderContext2D, SpaceRects } from "@/render/render-context2d";
import { Clip } from "@/render/clip";
import { BoxBounds } from "@/layout/bounds";
import { NodeEffect } from "@/attributes/shape/effects/union";
import { backdropEffects, foregroundShaderEffects } from "@/attributes/shape/effects/backdrop";

/**
 * The **pure, leaf** pieces of {@link Node2D}'s render pipeline: they take
 * resolved inputs and the `ctx`, never call back into the node, so the
 * orchestration on the class reads without the scope bookkeeping.
 */

/** Reference rect for fills with `space:'parent'`, in this node's local space (origin at its positioned centre, y-down); the viewport (`space:'global'`) is the renderer's. This node's rotation/scale aren't folded in: the rect is the axis-aligned parent box, as gradients expect. `{}` for a root (no parent). */
/** @internal */
export function computeSpaceRects(
    parentRect: BoxBounds | undefined,
    thisRect: BoxBounds,
    x: number,
    y: number,
): SpaceRects {
    if (!parentRect) return {};
    const ox = thisRect.x + x;
    const oy = thisRect.y - y;
    return {
        parent: {
            left: -parentRect.width / 2 - ox,
            top: -parentRect.height / 2 - oy,
            right: parentRect.width / 2 - ox,
            bottom: parentRect.height / 2 - oy,
        },
    };
}

/** Backdrop effects (blur, grayscale, ..., magnify, backdrop shader) beneath the node, clipped to its silhouette and drawn before its own content, so what's underneath is filtered while its edges stay sharp. No-op without backdrop effects or a silhouette `clip`. */
/** @internal */
export function applyBackdropEffects(
    ctx: RenderContext2D,
    effects: NodeEffect[],
    clip: Clip | null,
    width: number,
    height: number,
): void {
    const backdrop = backdropEffects(effects);
    if (backdrop.length === 0) return;
    if (!clip || clip.isEmpty()) return;

    // Clip to the silhouette first so the backdrop passes are confined to the node.
    ctx.beginClip(clip);
    ctx.beginEffects(backdrop, "backdrop", width, height);
    ctx.endEffects();
    ctx.endClip();
}

/** Runs `body` inside the node's `foreground` effect scope (posterize wrapping bulge) so those shader effects warp/band everything it paints: the inner half of `renderContentWithEffects`, whose backdrop pass runs first. Skipped when there are none, keeping begin/end matched. */
/** @internal */
export function applyContentEffectScope(
    ctx: RenderContext2D,
    effects: NodeEffect[],
    width: number,
    height: number,
    body: () => void,
): void {
    const foreground = foregroundShaderEffects(effects);
    const hasForeground = foreground.length > 0;
    if (hasForeground) ctx.beginEffects(foreground, "foreground", width, height);
    body();
    if (hasForeground) ctx.endEffects();
}
