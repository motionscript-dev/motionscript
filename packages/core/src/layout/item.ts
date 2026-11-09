import type { Size2D, SizeInput } from "@/attributes/layout/size";
import type { MeasureContext2D } from "@/render/measure-context";
import type { SizeConstraints } from "./constraints";
import type { LayoutItem } from "./types";

/** An item's size under `constraints` — through its own `measure` when it has one. */
export function measureItem(
    item: LayoutItem,
    constraints: SizeConstraints,
    measurer: MeasureContext2D | undefined,
): Size2D {
    if (item.measure) {
        const size = item.measure(constraints, measurer);
        return { width: size.width ?? 0, height: size.height ?? 0 };
    }
    return {
        width: extentOf(item.width, constraints.maxWidth),
        height: extentOf(item.height, constraints.maxHeight),
    };
}

function extentOf(input: SizeInput, available: number | undefined): number {
    if (typeof input === "number") return input;
    return input === "fill" ? available ?? 0 : 0;
}
