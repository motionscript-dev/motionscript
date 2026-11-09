import { fillOps } from '../fill/registry';
import { FillResolved } from '../fill/union';
import { Fill } from '../fill/chain';
import { Vector2, lerpVector2 } from '@/attributes/layout/vector2';
import type { AttributeOps } from '@/attributes/shared/operators';

// ── Prop (loose) ─────────────────────────────────────────────────────────────

export interface ShadowProp {
    blur?: number;
    /** Offset of the shadow from the shape, in px. Defaults to `{ x: 0, y: 0 }`. */
    offset?: Vector2;
    /** Any loose fill: a CSS color string, fill prop object, resolved fill, or {@link FillChain}/array of layers. */
    fill?: Fill;
    /** When true, the shadow is cast inward (inset) instead of as a drop shadow. Defaults to false. */
    inner?: boolean;
    /**
     * Grows (positive) or shrinks (negative) the shadow's silhouette before it
     * is offset and blurred, like CSS `box-shadow` spread. Only honoured for
     * ellipses and rectangles, whose geometry can be resized cleanly; ignored
     * for other shapes. Defaults to 0.
     */
    spread?: number;
}
/**
 * Fully resolved shadow — all fields normalised with defaults applied.
 * Compatible with the lerp registry (IFill is used for fill to avoid
 * breaking the existing lerp/registry pipeline).
 */
export interface ShadowResolved {
    blur: number;
    /** Offset of the shadow from the shape, in px. */
    offset?: Vector2;
    /** Resolved fill layers, painted bottom-to-top like a node's `fill`. */
    fill: FillResolved[];
    /** When true, the shadow is cast inward (inset) instead of as a drop shadow. */
    inner: boolean;
    /** Silhouette grow (positive) / shrink (negative) before blur, in px. Only ellipses and rects honour it. */
    spread: number;
}

/**
 * Accepted shapes for a node's `shadow` prop: a single loose {@link ShadowProp},
 * an array of them (stacked), or an already-resolved {@link ShadowResolved}/array
 * — resolved values pass through `resolveShadow` idempotently, so a node's
 * read-back `shadow` can be assigned straight back.
 */
export type Shadow =
    | ShadowProp
    | ShadowResolved
    | (ShadowProp | ShadowResolved)[];

// ── Resolve ──────────────────────────────────────────────────────────────────

export function resolveShadow(prop: ShadowProp, previous?: ShadowResolved): ShadowResolved {
    return {
        blur: prop.blur ?? previous?.blur ?? 0,
        offset: prop.offset ?? previous?.offset,
        fill: prop.fill != null ? fillOps.resolve(prop.fill) : (previous?.fill ?? fillOps.resolve('transparent')),
        inner: prop.inner ?? previous?.inner ?? false,
        spread: prop.spread ?? previous?.spread ?? 0,
    };
}

// ── Lerp ─────────────────────────────────────────────────────────────────────

function lerpShadow(from: ShadowResolved, to: ShadowResolved, t: number): ShadowResolved {
    return {
        blur: from.blur + (to.blur - from.blur) * t,
        offset: lerpVector2(from.offset ?? { x: 0, y: 0 }, to.offset ?? { x: 0, y: 0 }, t),
        fill: fillOps.lerp(from.fill, to.fill, t),
        // inner/outer is a discrete kind — keep the start's until the tween completes.
        inner: t < 1 ? from.inner : to.inner,
        spread: from.spread + (to.spread - from.spread) * t,
    };
}

/** The shadow-layer attribute's op set — the `shadow` prop's resolve/lerp pair. */
export const shadowOps: AttributeOps<Shadow, ShadowResolved[]> = {
    resolve: (prop, previous) => {
        if (prop == null) return [];
        const arr = Array.isArray(prop) ? prop : [prop];
        return arr.map((p, i) => resolveShadow(p as ShadowProp, previous?.[i]));
    },
    lerp: (from, to, t) => {
        if (from === to) return from;
        const len = Math.max(from.length, to.length);
        const result: ShadowResolved[] = [];
        for (let i = 0; i < len; i++) {
            const f = from[i];
            const tf = to[i];
            if (!f) { result.push(tf); continue; }
            if (!tf) { result.push(f); continue; }
            result.push(lerpShadow(f, tf, t));
        }
        return result;
    },
};
