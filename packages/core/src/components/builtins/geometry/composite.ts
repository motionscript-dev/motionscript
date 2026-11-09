import type { NodeOf } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import * as Flow from "@/components/modules/flow";
import * as Paint from "@/components/modules/paint";
import type { BooleanOperation } from "@/attributes/mask/boolean";
import type { Node2DProps } from "@/components/trees/2d/node2d";
import type { ShapeProps } from "@/components/builtins/geometry/geometry";
import type { MaskMode } from "@/attributes/mask/mask";

/**
 * The compositing built-ins: children drawn as one. `op`, `mode` and
 * `inverted` are entries, where the classes kept them in unlisted slots, so a
 * host lists them and a command can switch them.
 */

/** Its children become one shape by `op`, painted with its own fill, stroke and shadow. */
export const BooleanGroup = component2d({
    key: "boolean",
    state: { ...Paint.state, ...Flow.state, op: Types.oneOf(["union", "subtract", "intersect", "exclude"]) },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => ctx.merge(state.op, state),
});

/** Its first child is the stencil the rest draw through. */
export const MaskGroup = component2d({
    key: "mask",
    state: { mode: Types.oneOf(["alpha", "vector", "luminance"]), inverted: false },
    render: (ctx, state) => ctx.mask(state),
});

export type BooleanGroup = NodeOf<typeof BooleanGroup>;
export type MaskGroup = NodeOf<typeof MaskGroup>;

// What code building a boolean or a mask names its props as.

export interface BooleanGroupProps extends ShapeProps {
    op: BooleanOperation;
}

export interface MaskGroupProps extends Node2DProps {
    // How the mask shape determines content visibility:
    //   "alpha"     — mask alpha drives content alpha (default; matches Figma)
    //   "vector"    — fast hard clip using the mask's outline only
    //   "luminance" — mask brightness drives content alpha
    mode: MaskMode;
    // When true, content shows where the mask is *not* (Figma's "subtract" mask).
    inverted: boolean;
}
