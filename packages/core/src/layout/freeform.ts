import type { Size2D } from "@/attributes/layout/size";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { MeasureContext2D } from "@/render/measure-context";
import type { BoxBounds } from "./bounds";
import type { FlowSpace, LayoutItem } from "./types";
import { measureItem } from "./item";

/** Every item measured against the whole content box; the content is the largest of them. */
export function measureFreeform(
    items: readonly LayoutItem[],
    space: FlowSpace,
    measurer: MeasureContext2D | undefined,
): { sizes: Size2D[]; hug: Size2D } {
    const constraints = { maxWidth: space.width, maxHeight: space.height };
    const sizes: Size2D[] = [];
    const hug = { width: 0, height: 0 };
    for (const item of items) {
        const size = measureItem(item, constraints, measurer);
        sizes.push(size);
        if (size.width > hug.width) hug.width = size.width;
        if (size.height > hug.height) hug.height = size.height;
    }
    return { sizes, hug };
}

/**
 * Each item aligned in the content box, centre-relative and y-up. Slack is
 * clamped at 0, so an item larger than the box stays centred on it.
 */
export function placeFreeform(sizes: readonly Size2D[], inner: Size2D, align: Vector2): BoxBounds[] {
    return sizes.map((size) => ({
        x: align.x * Math.max(0, inner.width - size.width) / 2,
        y: align.y * Math.max(0, inner.height - size.height) / 2,
        width: size.width,
        height: size.height,
    }));
}
