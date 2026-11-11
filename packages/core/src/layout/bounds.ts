import { Size2D } from "@/attributes/layout/size";
import { Vector2 } from "@/attributes/layout/vector2";

/** An axis-aligned box as an origin plus a size, in pixels: a node's laid-out cell, the extent of what it draws, any positioned box. What `x`/`y` mean is **not** part of the type: layout rects are canvas (y-down) relative to the parent, a node's content bounds y-up relative to its centre; each site documents its own space, as {@link Vector2} is shared across both. */
export type BoxBounds = Size2D & Vector2;

/** Axis-aligned bounding box expressed as min/max corners rather than origin + size. */
export type Extents = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};