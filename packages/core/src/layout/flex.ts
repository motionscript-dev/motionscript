import { clamp } from "@/util/clamp";
import type { Size2D } from "@/attributes/layout/size";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { MeasureContext2D } from "@/render/measure-context";
import type { BoxBounds } from "./bounds";
import type { SizeConstraints } from "./constraints";
import type { FlowLine, FlowMeasure, FlowSpace, GapSize, LayoutItem } from "./types";
import { measureItem } from "./item";

type RunMeasure = Pick<FlowMeasure, "sizes" | "lines" | "gapScales" | "hug">;

/**
 * Measures an unwrapped run, as one line: fixed items first, then `fill` items
 * share what is left of the main axis by `flex`.
 */
export function measureRun(
    items: readonly LayoutItem[],
    horizontal: boolean,
    gap: GapSize,
    space: FlowSpace,
    measurer: MeasureContext2D | undefined,
): RunMeasure {
    const main = horizontal ? "width" : "height";
    const cross = horizontal ? "height" : "width";
    const hugsMain = (horizontal ? space.hugWidth : space.hugHeight) === true;
    const hugsCross = (horizontal ? space.hugHeight : space.hugWidth) === true;
    const bounded: SizeConstraints = { maxWidth: space.width, maxHeight: space.height };

    const n = items.length;
    const sizes: Size2D[] = new Array(n);
    const gapScales = items.map((item) => sanitizeGapScale(item.gapScale));
    // Weighted rather than a flat `n - 1`, so an item collapsing mid insert/remove
    // gives back exactly one gap wherever it sits. All weights 1 is `gap * (n - 1)`.
    const totalGap = gap === "auto" ? 0 : gap * Math.max(0, gapScales.reduce((sum, w) => sum + w, 0) - 1);

    // Fixed-main items first. On a hugging cross axis, `fill`-cross items wait:
    // what they fill is the deepest of these.
    let fixedMain = 0;
    let deepest = 0;
    for (let i = 0; i < n; i++) {
        if (items[i][main] === "fill" || (hugsCross && items[i][cross] === "fill")) continue;
        sizes[i] = measureItem(items[i], bounded, measurer);
        fixedMain += sizes[i][main];
        if (sizes[i][cross] > deepest) deepest = sizes[i][cross];
    }
    const fillCross = hugsCross ? deepest : space[cross];
    if (hugsCross) {
        for (let i = 0; i < n; i++) {
            if (items[i][main] === "fill" || items[i][cross] !== "fill") continue;
            const size = measureItem(items[i], bounded, measurer);
            sizes[i] = withCross(size, fillCross, horizontal);
            fixedMain += size[main];
        }
    }

    const free = Math.max(0, space[main] - totalGap - fixedMain);
    let flexSum = 0;
    for (const item of items) if (item[main] === "fill") flexSum += sanitizeFlex(item.flex);

    for (let i = 0; i < n; i++) {
        const item = items[i];
        if (item[main] !== "fill") continue;
        let share: number;
        let size: Size2D;
        if (hugsMain) {
            size = measureFillOnHugAxis(item, horizontal, space, measurer);
            share = size[main];
        } else {
            share = flexSum > 0 ? free * sanitizeFlex(item.flex) / flexSum : 0;
            size = measureItem(item, horizontal
                ? { maxWidth: share, maxHeight: space.height }
                : { maxWidth: space.width, maxHeight: share }, measurer);
        }
        const depth = item[cross] === "fill" ? fillCross : size[cross];
        sizes[i] = horizontal ? { width: share, height: depth } : { width: depth, height: share };
    }

    let extent = totalGap;
    let depth = 0;
    for (const size of sizes) {
        extent += size[main];
        if (size[cross] > depth) depth = size[cross];
    }
    return {
        sizes,
        lines: n > 0 ? [{ start: 0, end: n, cross: depth }] : [],
        gapScales,
        hug: horizontal ? { width: extent, height: depth } : { width: depth, height: extent },
    };
}

/**
 * A `fill`-main item on a main axis the container hugs. There is nothing to
 * share on such an axis — Figma disallows `fill` there — so the item measures
 * unconstrained along it, like a hug item. A bare `fill` leaf echoes that back as
 * Infinity, which would take the container's hug size with it; it collapses to 0
 * instead. Shared by {@link measureRun} and {@link measureWrap}, so a run hugs to
 * the same size whether or not it wraps.
 */
function measureFillOnHugAxis(
    item: LayoutItem,
    horizontal: boolean,
    space: FlowSpace,
    measurer: MeasureContext2D | undefined,
): Size2D {
    const size = measureItem(item, horizontal
        ? { maxWidth: Infinity, maxHeight: space.height }
        : { maxWidth: space.width, maxHeight: Infinity }, measurer);
    const main = horizontal ? "width" : "height";
    return Number.isFinite(size[main]) ? size : { ...size, [main]: 0 };
}

/**
 * Measures a wrapped run: every item at its natural size, broken greedily into
 * lines that fit the main axis. Two rules differ from {@link measureRun}, both
 * Figma's:
 *
 * - **A hugging main axis does not wrap** — there is nothing to break against.
 * - **`fill` on the main axis is not divided.** Which line an item lands on is
 *   what this pass decides, so it measures to the whole main axis and takes a
 *   line to itself. (On a hugging main axis there is no line to break and no
 *   extent to fill, so it measures as {@link measureRun} measures it.)
 *   Cross-axis `fill` stretches to its own line rather than the whole stack, the
 *   only reading that survives a reflow.
 */
export function measureWrap(
    items: readonly LayoutItem[],
    horizontal: boolean,
    gap: GapSize,
    crossGap: number,
    space: FlowSpace,
    measurer: MeasureContext2D | undefined,
): RunMeasure {
    const main = horizontal ? "width" : "height";
    const cross = horizontal ? "height" : "width";
    const hugsMain = (horizontal ? space.hugWidth : space.hugHeight) === true;
    const limit = hugsMain ? Infinity : space[main];
    // Flat, not gapScale-weighted: placement spaces the lines this breaks, and a
    // weighting across a break would put the two out of step. An animated insert
    // in a wrapped run slides instead of collapsing its gap.
    const step = gap === "auto" ? 0 : gap;
    const bounded: SizeConstraints = { maxWidth: space.width, maxHeight: space.height };
    // A `fill` item on a hugging main axis measures as it does unwrapped (see
    // `measureFillOnHugAxis`): the full extent is what a *bounded* axis offers it,
    // and a hugging one offers none.
    const sizes = items.map((item) => hugsMain && item[main] === "fill"
        ? measureFillOnHugAxis(item, horizontal, space, measurer)
        : measureItem(item, bounded, measurer));

    const lines: FlowLine[] = [];
    let widest = 0;
    let stack = 0;
    let start = 0;
    while (start < sizes.length) {
        // A line always takes at least one item, so an over-long one overflows its
        // own line rather than being pushed onto an empty one forever.
        let end = start + 1;
        let extent = sizes[start][main];
        while (end < sizes.length && extent + step + sizes[end][main] <= limit) {
            extent += step + sizes[end][main];
            end++;
        }
        // A line's thickness is its deepest item, not counting the ones that fill
        // the cross axis — what they fill is the answer being computed.
        let depth = 0;
        for (let i = start; i < end; i++) {
            if (items[i][cross] !== "fill" && sizes[i][cross] > depth) depth = sizes[i][cross];
        }
        for (let i = start; i < end; i++) {
            if (items[i][cross] === "fill") sizes[i] = withCross(sizes[i], depth, horizontal);
        }
        lines.push({ start, end, cross: depth });
        if (extent > widest) widest = extent;
        stack += depth;
        start = end;
    }
    stack += crossGap * Math.max(0, lines.length - 1);
    return {
        sizes,
        lines,
        gapScales: sizes.map(() => 1),
        hug: horizontal ? { width: widest, height: stack } : { width: stack, height: widest },
    };
}

/**
 * Places a run's lines in the content box, centre-relative and y-up. Positions
 * are worked out in reading order — from the main axis's start edge (left, or
 * top) and the cross axis's (top, or left) — and converted once, at the end.
 */
export function placeRun(
    sizes: readonly Size2D[],
    lines: readonly FlowLine[],
    gapScales: readonly number[],
    horizontal: boolean,
    gap: GapSize,
    crossGap: number,
    align: Vector2,
    inner: Size2D,
): BoxBounds[] {
    const main = horizontal ? "width" : "height";
    const cross = horizontal ? "height" : "width";
    // `align` is y-up and a run reads top-down, so y's fraction is flipped.
    const mainFraction = horizontal ? (1 + align.x) / 2 : (1 - align.y) / 2;
    const crossFraction = horizontal ? (1 - align.y) / 2 : (1 + align.x) / 2;

    let stack = crossGap * Math.max(0, lines.length - 1);
    for (const line of lines) stack += line.cross;
    let lineStart = crossFraction * (inner[cross] - stack);

    const boxes: BoxBounds[] = new Array(sizes.length);
    for (const line of lines) {
        const count = line.end - line.start;
        let extent = 0;
        let weight = 0;
        for (let i = line.start; i < line.end; i++) {
            extent += sizes[i][main];
            weight += gapScales[i];
        }

        let gapAfter: (i: number) => number;
        let lead = 0;
        if (gap === "auto") {
            // Spread within each line, so a short last line is as loose as the full ones.
            const spread = count > 1 ? Math.max(0, inner[main] - extent) / (count - 1) : 0;
            gapAfter = () => spread;
            extent += spread * (count - 1);
        } else {
            // A boundary takes the mean of its neighbours' weights, so the run spans
            // `gap * (Σweight − 1)` — what measureRun reserved. That leaves half a gap
            // over for a collapsing first item, which hangs before the visible run so
            // the content edge holds still at any alignment.
            const weightAt = (i: number): number => (i < line.end ? gapScales[i] : 1);
            gapAfter = (i) => gap * (gapScales[i] + weightAt(i + 1)) / 2;
            extent += gap * Math.max(0, weight - 1);
            lead = gap * (1 - gapScales[line.start]) / 2;
        }

        let at = mainFraction * (inner[main] - extent) - lead;
        for (let i = line.start; i < line.end; i++) {
            const size = sizes[i];
            const across = lineStart + crossFraction * (line.cross - size[cross]);
            boxes[i] = fromReadingOrder(horizontal ? at : across, horizontal ? across : at, size, inner);
            at += size[main] + gapAfter(i);
        }
        lineStart += line.cross + crossGap;
    }
    return boxes;
}

// From a top-left corner in the content box (y-down) to the content box's centre, y-up.
function fromReadingOrder(left: number, top: number, size: Size2D, inner: Size2D): BoxBounds {
    return {
        x: left + size.width / 2 - inner.width / 2,
        y: inner.height / 2 - top - size.height / 2,
        width: size.width,
        height: size.height,
    };
}

function withCross(size: Size2D, depth: number, horizontal: boolean): Size2D {
    return horizontal ? { width: size.width, height: depth } : { width: depth, height: size.height };
}

function sanitizeFlex(value: number | undefined): number {
    if (value == null) return 1;
    return Number.isFinite(value) && value >= 0 ? value : 1;
}

// Clamped so an eased tween overshooting 0 ↔ 1 can't push a gap negative or past full.
function sanitizeGapScale(value: number | undefined): number {
    if (value == null) return 1;
    return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}
