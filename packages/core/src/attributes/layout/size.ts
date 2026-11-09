import { lerpNumber } from "@/tween/lerp";
import type { AttributeOps } from "@/attributes/shared/operators";

/** Width and height in pixels. */
export interface Size2D {
    width: number;
    height: number;
}

/**
 * The {@link Size2D} attribute's op set: `lerp` interpolates `width`/`height`
 * independently. `expand` fills the `size` shorthand into `width`/`height` on a
 * props-like object, in place. `size` is sugar for "the same value on both
 * axes"; explicit `width`/`height` take precedence over it (same precedence as
 * `insetsOps.resolve`'s side-vs-shorthand rule), so `{ size: 200, width: 100 }`
 * keeps `width: 100` and only fills in `height: 200`. No-op when `size` is
 * absent. The reactive-binding form (`size: () => SizeInput`) is supported —
 * both axes are bound to the same callback, re-evaluated independently per axis.
 */
export const size2DOps: AttributeOps<Size2D, Size2D> & { expand(props: Record<string, unknown>): void } = {
    resolve: (value) => value,
    lerp: (from, to, t) => ({ width: lerpNumber(from.width, to.width, t), height: lerpNumber(from.height, to.height, t) }),
    expand: (props) => {
        if (props.size === undefined) return;
        if (props.width === undefined) props.width = props.size;
        if (props.height === undefined) props.height = props.size;
    },
};

/**
 * Sizing behavior for a node dimension.
 * - `"fill"`: expand to fill available space from the parent
 * - `"hug"`: shrink to fit the node's own content
 */
/** @internal */
export type SizeType = "fill" | "hug";

/** A dimension can be specified as a behavior keyword or a fixed pixel value. */
/** @internal */
export type SizeInput = SizeType | number;

/**
 * The dimension-keyword `SizeInput` attribute's op set — `width`/`height`'s.
 * `lerp` interpolates two numbers; a keyword on either end hard-switches at t=1.
 * `resolveLayout` turns a `SizeInput` into a concrete number for layout, given
 * the space available and the size contents would need; `isAuto` reports
 * whether a dimension needs layout to resolve at all (a keyword) as opposed to
 * being a fixed number.
 */
export const sizeInputOps: AttributeOps<SizeInput, SizeInput> & {
    resolveLayout(input: SizeInput, availableSize: number, contentSize: number): number;
    isAuto(input: SizeInput): boolean;
} = {
    resolve: (value) => value,
    lerp: (from, to, t) => {
        if (typeof from === "number" && typeof to === "number") {
            return lerpNumber(from, to, t);
        }
        return t === 1 ? to : from;
    },
    resolveLayout: (input, availableSize, contentSize) => {
        if (typeof input === "number") return input;
        if (input === "fill") return availableSize;
        if (input === "hug") return contentSize;
        return availableSize;
    },
    isAuto: (input) => typeof input !== "number",
};
