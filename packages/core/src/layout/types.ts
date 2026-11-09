import type { Alignment } from "@/attributes/layout/alignment";
import type { Insets } from "@/attributes/layout/insets";
import type { Size2D, SizeInput } from "@/attributes/layout/size";
import type { MeasureContext2D } from "@/render/measure-context";
import type { BoxBounds } from "./bounds";
import type { SizeConstraints } from "./constraints";

/**
 * How a container arranges the items that take part in its layout:
 *
 * - `'freeform'` — items overlap, each aligned in the padded content box by
 *   `align` and offset from there by its own `x`/`y`.
 * - `'horizontal'` — a run left-to-right.
 * - `'vertical'` — a run top-to-bottom.
 * - `'grid'` — N equal columns, rows sized to their content (or divided equally
 *   when the container's height is bounded). Items place themselves with
 *   `column`/`row` and span with `colSpan`/`rowSpan`; anything unplaced is
 *   auto-flowed left-to-right.
 *
 * A run also answers `wrap` — "and break onto a new line when you run out of
 * room" — which is a property of the run rather than a fourth direction.
 */
export type FlowMode = "horizontal" | "vertical" | "freeform" | "grid";

/** Spacing between items, or `"auto"` to spread the free space evenly between them. */
export type GapSize = number | "auto";

/**
 * What a `flow` prop holds: a mode, or — mid-tween between two — both and how far
 * along. The blend lives in the value so that restoring the prop restores it.
 */
export type FlowResolved = FlowMode | { from: FlowMode; to: FlowMode; t: number };

/** A container's author-facing layout props. */
export interface FlowProps {
    /**
     * Layout mode for children: a run (`horizontal` / `vertical`), overlapping
     * `freeform`, or a `grid` of N equal columns.
     */
    flow: FlowMode;
    /** Spacing between children along the layout's main axis. */
    gap: GapSize;
    /**
     * Break a `horizontal`/`vertical` run onto new lines once it runs out of
     * main-axis room. It needs a bounded main axis to break against, so an axis
     * set to `'hug'` stays one line.
     */
    wrap: boolean;
    /**
     * Spacing on the **cross** axis: between wrapped lines, and between a grid's
     * rows. Omitted, it follows `gap` — "wrap this row" almost never means "and
     * stack the lines flush against each other".
     */
    crossGap: number;
    /** Number of equal columns when `flow` is `'grid'`. At least 1. */
    columns: number;
    /**
     * Where children sit in the content box: a named position (`'center'`,
     * `'topLeft'`, …) or a per-axis `Vector2` (x: -1 left … +1 right, y: -1
     * bottom … +1 top).
     */
    align: Alignment;
}

/**
 * What `flowOps` arranges by: the {@link FlowProps} vocabulary, every field
 * optional and defaulting as the prop does. A shape's state or a `Canvas2D` is one
 * as it stands.
 */
export interface FlowSettings {
    readonly flow?: FlowResolved;
    readonly gap?: GapSize;
    readonly wrap?: boolean;
    readonly crossGap?: number;
    readonly columns?: number;
    readonly align?: Alignment;
    /** Read by `flowOps.arrange` only; a node insets its own content box. */
    readonly padding?: Insets;
}

/** One thing a flow arranges — a `Node2D` as it stands, or a plain `{ width, height }`. */
export interface LayoutItem {
    readonly width: SizeInput;
    readonly height: SizeInput;
    /** Share of a run's free space among its `fill` items. Default 1. */
    readonly flex?: number;
    /** Fraction of a full gap this item opens on each side, `[0, 1]`. Default 1. */
    readonly gapScale?: number;
    /** 1-based grid column; with `row`, places the item explicitly. */
    readonly column?: number;
    readonly row?: number;
    readonly colSpan?: number;
    readonly rowSpan?: number;
    /**
     * The item's own size under `constraints`. Without one, a number is the size,
     * `'fill'` takes what is offered and `'hug'` is 0.
     */
    measure?(constraints: SizeConstraints, measurer?: MeasureContext2D): Partial<Size2D>;
}

/** The content box a flow measures in, and which of its axes hug their content. */
export interface FlowSpace {
    readonly width: number;
    readonly height: number;
    readonly hugWidth?: boolean;
    readonly hugHeight?: boolean;
}

/** One line of a `horizontal`/`vertical` run: items `[start, end)`. */
export interface FlowLine {
    readonly start: number;
    readonly end: number;
    /** The line's thickness — its deepest item — on the cross axis. */
    readonly cross: number;
}

/**
 * One measure pass: what `flowOps.place` needs to position the items, and the
 * extent a hugging container wraps.
 */
export interface FlowMeasure<I extends LayoutItem = LayoutItem> {
    readonly mode: FlowMode;
    readonly items: readonly I[];
    readonly sizes: readonly Size2D[];
    readonly hug: Size2D;
    /** The content box this was measured in — see `flowOps.reusable`. */
    readonly space: FlowSpace;
    /** Runs: the lines, and each item's clamped `gapScale` (all 1 when wrapped). */
    readonly lines?: readonly FlowLine[];
    readonly gapScales?: readonly number[];
    /** Grid: each item's cell, from the content box's top-left, y-down. */
    readonly cells?: readonly BoxBounds[];
    /** A blend between two modes: the measure of the mode being left, and how far along. */
    readonly from?: FlowMeasure<I>;
    readonly t?: number;
}
