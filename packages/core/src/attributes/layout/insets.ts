import { lerpNumber } from "@/tween/lerp";
import type { AttributeOps } from "@/attributes/shared/operators";
import type { BoxBounds } from "@/layout/bounds";
import { Size2D } from "./size";

/** Fully resolved per-side edge insets. */
export interface InsetsResolved {
    left: number;
    right: number;
    top: number;
    bottom: number;
}


export type InsetsProps = number | Partial<InsetsResolved> & {
    horizontal?: number;
    vertical?: number;
};

/**
 * Accepted shapes for a four-sided inset prop.
 *
 * The type is named for the shape (four edge insets), not for one use of it:
 * `Node2D.padding` insets a layout box in pixels, an image fill's `crop` insets a
 * source in fractions. Same value, same shorthands, same tween — different roles,
 * and each prop names its own.
 *
 * Mirrors {@link Fill}: the loose author-facing {@link InsetsProps} (a number or
 * per-side/symmetric object) plus the strict {@link InsetsResolved} — a read-back
 * resolved value structurally satisfies `InsetsProps`, so it passes through
 * `insetsOps.resolve` idempotently and can be assigned straight back.
 *
 *   node.padding = 3                          // uniform
 *   node.padding = { horizontal: 8, top: 4 }  // mixed
 *   node.padding = otherNode.padding          // resolved passes through
 */
export type Insets = InsetsProps | InsetsResolved;


/**
 * The insets attribute's op set — used by `insetsProperty` and anywhere else a
 * four-sided inset (padding, an image fill's `crop`, …) resolves and tweens.
 *
 * `insetBounds` computes the inner content area produced by subtracting a
 * resolved inset from an outer size — pure, works for any width/height pair,
 * with `x`/`y` carrying the offset of the inner-area center relative to the
 * outer-area center. `outsetSize` is its inverse: adds padding back onto
 * an inner size to get the outer size that contains it.
 */

export interface InsetsOps {

    insetBounds(outerWidth: number, outerHeight: number, pad: InsetsResolved): BoxBounds;
    outsetSize(innerWidth: number, innerHeight: number, pad: InsetsResolved): Size2D;
}

export const insetsOps: AttributeOps<InsetsProps, InsetsResolved> & InsetsOps = {
    resolve: (value: InsetsProps, previous?: InsetsResolved): InsetsResolved => {
        if (typeof value === "number") {
            return { left: value, right: value, top: value, bottom: value };
        }

        // Fallback resolution order: Specific side -> Symmetric shortcut -> Previous fallback -> Default 0
        return {
            left: value.left ?? value.horizontal ?? previous?.left ?? 0,
            right: value.right ?? value.horizontal ?? previous?.right ?? 0,
            top: value.top ?? value.vertical ?? previous?.top ?? 0,
            bottom: value.bottom ?? value.vertical ?? previous?.bottom ?? 0,
        };
    },
    lerp: (from: InsetsResolved, to: InsetsResolved, t: number): InsetsResolved => {
        return {
            left: lerpNumber(from.left, to.left, t),
            right: lerpNumber(from.right, to.right, t),
            top: lerpNumber(from.top, to.top, t),
            bottom: lerpNumber(from.bottom, to.bottom, t),
        };
    },
    insetBounds: (outerWidth, outerHeight, pad) => ({
        width: Math.max(0, outerWidth - pad.left - pad.right),
        height: Math.max(0, outerHeight - pad.top - pad.bottom),
        x: (pad.left - pad.right) / 2,
        y: (pad.top - pad.bottom) / 2,
    }),
    outsetSize: (innerWidth, innerHeight, pad) => ({
        width: innerWidth + pad.left + pad.right,
        height: innerHeight + pad.top + pad.bottom,
    }),
};
