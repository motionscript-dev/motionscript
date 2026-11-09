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

/**
 * Reference rect for fills with `space:'parent'`, expressed in this node's local
 * space (origin = this node's positioned centre, y-down). The viewport
 * (`space:'global'`) is resolved by the renderer. Rotation/scale of this node
 * are not folded in — the rect is the axis-aligned parent box, which is what
 * gradients expect. Returns `{}` for a root node (no parent).
 */
/** @internal */
export function computeSpaceRects(
    parentRect: BoxBounds | undefined,
    thisRect: BoxBounds,
    x: number,
    y: number,
): SpaceRects {
    if (!parentRect) return {};
    // This node's local origin within the parent's space.
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

/**
 * Apply backdrop effects (any `mode:"backdrop"` effect — blur, grayscale, …;
 * plus magnify and backdrop shader) beneath the node, clipped to its silhouette,
 * before the node's own content is drawn — so what's underneath is
 * filtered/warped while the node's own edges stay sharp. A no-op when there are
 * no backdrop effects or no silhouette `clip` to confine them to.
 */
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

    // Clip to the silhouette first so the backdrop passes are confined to the
    // node; the renderer opens its backdrop layers within that clip.
    ctx.beginClip(clip);
    ctx.beginEffects(backdrop, "backdrop", width, height);
    ctx.endEffects();
    ctx.endClip();
}

/**
 * Run `body` inside the node's `foreground` effect scope (posterize wrapping
 * bulge), so those shader effects warp/band everything it paints: the inner
 * half of `renderContentWithEffects`, whose backdrop pass runs before this.
 * Skipped when there are none, so the begin/end calls match.
 */
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
