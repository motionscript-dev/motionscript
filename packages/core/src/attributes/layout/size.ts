import { lerpNumber } from "@/tween/lerp";
import type { AttributeOps } from "@/attributes/shared/operators";

export interface Size2D {
    width: number;
    height: number;
}

/** The {@link Size2D} attribute's op set: `lerp` interpolates `width`/`height` independently; `expand` fills the `size` shorthand (same value on both axes) into `width`/`height` in place. Explicit `width`/`height` win (`{ size: 200, width: 100 }` keeps `width: 100`, fills `height: 200`). A reactive `size: () => SizeInput` binds both axes to the callback, evaluated per axis. */
export const size2DOps: AttributeOps<Size2D, Size2D> & { expand(props: Record<string, unknown>): void } = {
    resolve: (value) => value,
    lerp: (from, to, t) => ({ width: lerpNumber(from.width, to.width, t), height: lerpNumber(from.height, to.height, t) }),
    expand: (props) => {
        if (props.size === undefined) return;
        if (props.width === undefined) props.width = props.size;
        if (props.height === undefined) props.height = props.size;
    },
};

/** Sizing behavior for a node dimension: `"fill"` expands to fill the parent's space, `"hug"` shrinks to the node's own content. */
/** @internal */
export type SizeType = "fill" | "hug";

/** @internal */
export type SizeInput = SizeType | number;

/** The `SizeInput` op set (`width`/`height`'s): `lerp` interpolates numbers and hard-switches at t=1 when either end is a keyword; `resolveLayout` turns a `SizeInput` into a concrete number given the available space and the size contents need; `isAuto` reports whether a dimension needs layout to resolve at all (a keyword). */
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
