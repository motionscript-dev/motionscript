import type { Alignment } from "@/attributes/layout/alignment";
import type { InsetsResolved } from "@/attributes/layout/insets";
import { insetsOps } from "@/attributes/layout/insets";
import type { Size2D } from "@/attributes/layout/size";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { BoxBounds } from "@/layout/bounds";
import { flowOps } from "@/layout/ops";
import type { FlowMeasure, FlowMode, FlowResolved, FlowSettings, GapSize } from "@/layout/types";
import type { Node2D } from "@/components/trees/2d/node2d";
import type { ChildView, Measurer, Placement2D, Values } from "@/components/factory/api";
import { Types, type Attribute } from "@/components/factory/types";
import { currentPass, nodeOfView } from "@/components/factory/views";

/** The Rect layout engine: freeform, runs, wrapped runs and grids. */
export const state = {
    flow: Types.custom<FlowMode, FlowResolved>("freeform", { lerp: flowOps.lerp }),
    gap: Types.custom<GapSize>(0),
    wrap: false,
    crossGap: Types.custom<number | undefined>(undefined),
    columns: Types.number(1),
    // Typed out so the declarations name Alignment by its own module: a kit's emit reaches it through the sdk.
    align: Types.alignment as Attribute<Alignment, Vector2>,
};

export type FlowState = Values<typeof state> & {
    readonly padding: InsetsResolved;
    readonly width: import("@/attributes/layout/size").SizeInput;
    readonly height: import("@/attributes/layout/size").SizeInput;
};

const NO_CONTENT: Size2D = { width: 0, height: 0 };

/** The measure a container took, kept for its layout in the same pass (as `Node2D` keeps its own). */
const pending = new WeakMap<Node2D, FlowMeasure<Node2D>>();

function padded(s: FlowState, inset: InsetsResolved | undefined): InsetsResolved {
    const p = s.padding;
    if (!inset) return p;
    return { left: p.left + inset.left, right: p.right + inset.right, top: p.top + inset.top, bottom: p.bottom + inset.bottom };
}

/** `inset` is room the children must clear beyond `padding`: a stroke, say. */
export function measure(measurer: Measurer, s: FlowState, children: readonly ChildView<any>[], inset?: InsetsResolved): Size2D {
    const { node, scope } = currentPass();
    const padding = padded(s, inset);
    const constraints = { maxWidth: measurer.max.width, maxHeight: measurer.max.height };
    if (children.length === 0) {
        pending.delete(node);
        return flowOps.size(s, constraints, padding, NO_CONTENT);
    }
    const space = flowOps.contentBox(s, constraints, padding);
    const measured = flowOps.measure(s as FlowSettings, children.map(nodeOfView), space, scope);
    pending.set(node, measured);
    return flowOps.size(s, constraints, padding, measured.hug);
}

export function layout(box: BoxBounds, s: FlowState, children: readonly ChildView<any>[], inset?: InsetsResolved): readonly Placement2D[] {
    const { node, scope } = currentPass();
    const kept = pending.get(node);
    pending.delete(node);
    const inner = insetsOps.insetBounds(box.width, box.height, padded(s, inset));
    // Where a child that is not here yet would land: a host dropping one in asks.
    node._childSpace = { settings: { flow: s.flow, align: s.align }, inner };
    if (children.length === 0) return [];
    const measured = kept && flowOps.reusable(kept, inner)
        ? kept
        : flowOps.measure(s as FlowSettings, children.map(nodeOfView), {
            width: inner.width, height: inner.height, hugWidth: s.width === "hug", hugHeight: s.height === "hug",
        }, scope);
    // `place` answers y-up from the content box's centre; a placement is y-up from the component's.
    return flowOps.place(measured, s as FlowSettings, inner).map((b) => ({
        x: inner.x + b.x, y: b.y - inner.y, width: b.width, height: b.height,
    }));
}
