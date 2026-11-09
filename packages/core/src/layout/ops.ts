/**
 * Every layout operation, on one object — for the node tree, and for anything a
 * node lays out itself, like a row of `Graphics2D` shapes inside `renderSelf`.
 *
 * It takes plain data and returns boxes, and writes to nothing it is handed: a
 * node keeps its own measure between passes. Its `resolve`/`lerp` pair is the
 * `flow` prop's, which is how a tween between two modes lives in the prop's value
 * and a seek that restores the prop restores the blend with it.
 *
 * Boxes are centred on the content box and y-up — the space `Graphics2D` draws
 * in. `Node2D` converts once, where it hands a box to a child.
 *
 * Each method is the module function of the same name.
 */
import { alignmentOps } from "@/attributes/layout/alignment";
import { insetsOps, type InsetsResolved } from "@/attributes/layout/insets";
import { sizeInputOps, type Size2D, type SizeInput } from "@/attributes/layout/size";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { AttributeOps } from "@/attributes/shared/operators";
import type { MeasureContext2D } from "@/render/measure-context";
import { lerpNumber } from "@/tween/lerp";
import type { BoxBounds } from "./bounds";
import type { SizeConstraints } from "./constraints";
import { measureRun, measureWrap, placeRun } from "./flex";
import { measureFreeform, placeFreeform } from "./freeform";
import { measureGrid, placeGrid } from "./grid";
import type { FlowMeasure, FlowMode, FlowResolved, FlowSettings, FlowSpace, LayoutItem } from "./types";

/** The `flow` attribute's operations beyond `resolve`/`lerp`. */
export interface FlowOps {
    // ── Arranging ──────────────────────────────────────────────────────────
    /**
     * Lay `items` out in a box of `box`'s size, inset by `settings.padding`.
     * Boxes come back centred on `box` and y-up. Pass a `measurer` when an item
     * measures text.
     */
    arrange<I extends LayoutItem>(
        settings: FlowSettings, items: readonly I[], box: Size2D, measurer?: MeasureContext2D,
    ): BoxBounds[];
    /** The first half of `arrange`: each item's size, and the extent a hugging container wraps. */
    measure<I extends LayoutItem>(
        settings: FlowSettings, items: readonly I[], space: FlowSpace, measurer?: MeasureContext2D,
    ): FlowMeasure<I>;
    /** The second half: each item's box in a content box of `inner`'s size. */
    place(measure: FlowMeasure, settings: FlowSettings, inner: Size2D): BoxBounds[];
    /** Whether `measure` still holds for a content box of `inner`'s size. */
    reusable(measure: FlowMeasure, inner: Size2D): boolean;
    /**
     * Where `settings` would put one more item of `size` in a content box of
     * `inner`'s size, centred and y-up like `place`; `null` when they arrange
     * their items in a run or a grid, where the slot depends on the others.
     */
    freeSlot(settings: FlowSettings, inner: Size2D, size: Size2D): BoxBounds | null;

    // ── Sizing a container ─────────────────────────────────────────────────
    /** The content box a `width` × `height` container measures its items in. */
    contentBox(
        sizing: Pick<LayoutItem, "width" | "height">, constraints: SizeConstraints, padding: InsetsResolved,
    ): FlowSpace;
    /** The container's own size, given the `hug` extent its items came to. */
    size(
        sizing: Pick<LayoutItem, "width" | "height">, constraints: SizeConstraints, padding: InsetsResolved, hug: Size2D,
    ): Size2D;

    // ── Diagnostics ────────────────────────────────────────────────────────
    /** What is wrong with a run laid out in a box of `box`'s size, or `null`. */
    collapsedRun(measure: FlowMeasure, box: Size2D): string | null;
}

const CENTRE: Vector2 = { x: 0, y: 0 };

function arrange<I extends LayoutItem>(
    settings: FlowSettings, items: readonly I[], box: Size2D, measurer?: MeasureContext2D,
): BoxBounds[] {
    const inner = insetsOps.insetBounds(box.width, box.height, insetsOps.resolve(settings.padding ?? 0));
    const boxes = place(measure(settings, items, inner, measurer), settings, inner);
    // `insetBounds` offsets the content box y-down; the boxes are y-up.
    return boxes.map((b) => ({ x: b.x + inner.x, y: b.y - inner.y, width: b.width, height: b.height }));
}

function measure<I extends LayoutItem>(
    settings: FlowSettings, items: readonly I[], space: FlowSpace, measurer?: MeasureContext2D,
): FlowMeasure<I> {
    const flow = settings.flow ?? "freeform";
    if (typeof flow === "string") return measureMode(flow, settings, items, space, measurer);
    const from = measureMode(flow.from, settings, items, space, measurer);
    const to = measureMode(flow.to, settings, items, space, measurer);
    return { ...to, hug: lerpSize(from.hug, to.hug, flow.t), from, t: flow.t };
}

function place(measure: FlowMeasure, settings: FlowSettings, inner: Size2D): BoxBounds[] {
    const to = placeMode(measure, settings, inner);
    const from = measure.from;
    if (!from) return to;
    const fromBoxes = placeMode(from, settings, inner);
    const t = measure.t ?? 1;
    return to.map((box, i) => ({
        x: lerpNumber(fromBoxes[i].x, box.x, t),
        y: lerpNumber(fromBoxes[i].y, box.y, t),
        width: lerpNumber(fromBoxes[i].width, box.width, t),
        height: lerpNumber(fromBoxes[i].height, box.height, t),
    }));
}

// Yoga's rule: reuse on an axis laid out at the size it was measured in, or — on
// an axis that hugs — at exactly what it hugged. Anything else, a parent laid this
// out at a size it did not measure it for, and the measure is stale.
function reusable(measure: FlowMeasure, inner: Size2D): boolean {
    const { space, hug } = measure;
    return fits(inner.width, space.width, space.hugWidth, hug.width)
        && fits(inner.height, space.height, space.hugHeight, hug.height);
}

function contentBox(
    sizing: Pick<LayoutItem, "width" | "height">, constraints: SizeConstraints, padding: InsetsResolved,
): FlowSpace {
    const width = outerFor(sizing.width, constraints.maxWidth);
    const height = outerFor(sizing.height, constraints.maxHeight);
    const inner = insetsOps.insetBounds(width, height, padding);
    return {
        width: inner.width,
        height: inner.height,
        hugWidth: sizing.width === "hug",
        hugHeight: sizing.height === "hug",
    };
}

function size(
    sizing: Pick<LayoutItem, "width" | "height">, constraints: SizeConstraints, padding: InsetsResolved, hug: Size2D,
): Size2D {
    const hugged = insetsOps.outsetSize(hug.width, hug.height, padding);
    return {
        width: sizing.width === "hug" ? hugged.width : outerFor(sizing.width, constraints.maxWidth),
        height: sizing.height === "hug" ? hugged.height : outerFor(sizing.height, constraints.maxHeight),
    };
}

/**
 * A run laid out in a box of length 0 on its main axis, with items that have a
 * size. Always a bug, and a quiet one: a run is placed from the box's centre, so
 * its first item's leading edge lands on the centre and everything after follows —
 * content displaced by half a box it does not visibly have, which reads as "the
 * scene loaded at 0,0" rather than as a layout fault. A box holding only collapsed
 * items is legitimately empty: an animated insert or remove mid-flight.
 */
function collapsedRun(measure: FlowMeasure, box: Size2D): string | null {
    if (measure.mode !== "horizontal" && measure.mode !== "vertical") return null;
    if ((measure.mode === "horizontal" ? box.width : box.height) > 0) return null;
    const sized = measure.sizes.filter((s) => s.width > 0 || s.height > 0).length;
    if (sized === 0) return null;
    return `is laying out ${sized} sized child${sized === 1 ? "" : "ren"} in a run of length 0 `
        + `(${box.width}×${box.height}, ${measure.mode}). `
        + `They will be positioned from its centre rather than its leading edge.`;
}

// A `from` that is itself a blend — a tween built mid-blend — starts from where it was heading.
function lerp(from: FlowResolved, to: FlowResolved, t: number): FlowResolved {
    const a = typeof from === "string" ? from : from.to;
    const b = typeof to === "string" ? to : to.to;
    return t >= 1 || a === b ? b : { from: a, to: b, t };
}

function measureMode<I extends LayoutItem>(
    mode: FlowMode, settings: FlowSettings, items: readonly I[], space: FlowSpace, measurer: MeasureContext2D | undefined,
): FlowMeasure<I> {
    if (mode === "freeform") return { mode, items, space, ...measureFreeform(items, space, measurer) };
    if (mode === "grid") {
        const grid = measureGrid(items, settings.columns ?? 1, mainGap(settings), crossGap(settings), space, measurer);
        return { mode, items, space, ...grid };
    }
    const horizontal = mode === "horizontal";
    const run = settings.wrap
        ? measureWrap(items, horizontal, settings.gap ?? 0, crossGap(settings), space, measurer)
        : measureRun(items, horizontal, settings.gap ?? 0, space, measurer);
    return { mode, items, space, ...run };
}

function placeMode(measure: FlowMeasure, settings: FlowSettings, inner: Size2D): BoxBounds[] {
    if (measure.mode === "grid") return placeGrid(measure.cells ?? [], inner);
    const align = alignOf(settings);
    if (measure.mode === "freeform") return placeFreeform(measure.sizes, inner, align);
    return placeRun(
        measure.sizes, measure.lines ?? [], measure.gapScales ?? [], measure.mode === "horizontal",
        settings.gap ?? 0, crossGap(settings), align, inner,
    );
}

function freeSlot(settings: FlowSettings, inner: Size2D, size: Size2D): BoxBounds | null {
    if ((settings.flow ?? "freeform") !== "freeform") return null;
    return placeFreeform([size], inner, alignOf(settings))[0];
}

// A container stores `align` resolved, so only a named key needs resolving here.
function alignOf(settings: FlowSettings): Vector2 {
    const align = settings.align;
    if (align === undefined) return CENTRE;
    return typeof align === "string" ? alignmentOps.resolve(align) : align;
}

function mainGap(settings: FlowSettings): number {
    const gap = settings.gap ?? 0;
    return gap === "auto" ? 0 : gap;
}

function crossGap(settings: FlowSettings): number {
    return settings.crossGap ?? mainGap(settings);
}

// A hugging axis measures its items against all the room it could have.
function outerFor(input: SizeInput, max: number | undefined): number {
    const available = max ?? 0;
    return input === "hug" ? available : sizeInputOps.resolveLayout(input, available, 0);
}

function lerpSize(from: Size2D, to: Size2D, t: number): Size2D {
    return { width: lerpNumber(from.width, to.width, t), height: lerpNumber(from.height, to.height, t) };
}

function fits(laid: number, measured: number, hugs: boolean | undefined, hugged: number): boolean {
    return near(laid, measured) || (hugs === true && near(laid, hugged));
}

function near(a: number, b: number): boolean {
    if (a === b) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

export const flowOps: AttributeOps<FlowMode, FlowResolved> & FlowOps = {
    resolve: (value) => value,
    lerp,

    arrange,
    measure,
    place,
    reusable,
    freeSlot,

    contentBox,
    size,

    collapsedRun,
};
