import type { Size2D } from "@/attributes/layout/size";
import type { CornerStyle } from "@/attributes/shape/corners/corner-style";
import { pathOps } from "@/attributes/shape/path/ops";
import { shapeOutlinePixels, type ShapeOutlineKind, type ShapeOutlineOptions } from "@/components/builtins/geometry/shape-outline";
import type { PathData } from "@/render/descriptors/path";
import { Graphics2D } from "@/render/graphics2d";

/** Each outline a built-in shape paints, from its box and its own entries. `Paint.draw` trims and paints it. */

export function ellipse(size: Size2D, s: { readonly startAngle: number; readonly sweep: number; readonly ratio: number }): Graphics2D {
    return new Graphics2D().ellipse({ width: size.width, height: size.height, startAngle: s.startAngle, sweep: s.sweep, ratio: s.ratio });
}

export interface PolygonShape {
    readonly sides: number;
    readonly cornerRadius: number;
    readonly cornerStyle: CornerStyle;
}

export function polygon(size: Size2D, s: PolygonShape): Graphics2D {
    return new Graphics2D().polygon({ width: size.width, height: size.height, sides: s.sides, cornerRadius: s.cornerRadius, cornerStyle: s.cornerStyle });
}

export function polygram(size: Size2D, s: PolygonShape & { readonly ratio: number }): Graphics2D {
    return new Graphics2D().polygram({
        width: size.width, height: size.height, sides: s.sides, ratio: s.ratio, cornerRadius: s.cornerRadius, cornerStyle: s.cornerStyle,
    });
}

/** The box, as a shape: what a path clips its children to. */
export function box(size: Size2D): Graphics2D {
    return new Graphics2D().rect({ x: 0, y: 0, width: size.width, height: size.height });
}

/** Path data in the unit space of the box (y up), drawn at the box's size. */
export function unitPath(size: Size2D, data: PathData): Graphics2D {
    const { width: w, height: h } = size;
    return new Graphics2D().path({
        data: pathOps.anchorCommands(pathOps.anchors(data), (p) => ({ x: p.x * w, y: -p.y * h })),
        centerBounds: [-w / 2, -h / 2, w / 2, h / 2],
    });
}

/** Path data at face value, centred on its own bounds. */
export function facePath(data: PathData): Graphics2D {
    const b = pathOps.bounds(data);
    return new Graphics2D().path({ data, centerBounds: b ? [b.minX, b.minY, b.maxX, b.maxY] : undefined });
}

/** A named outline (triangle, star, …) fitted to the box. */
export function outline(kind: ShapeOutlineKind, size: Size2D, options: Omit<ShapeOutlineOptions, "width" | "height">): Graphics2D {
    const { width: w, height: h } = size;
    return new Graphics2D().path({
        data: pathOps.anchorCommands(shapeOutlinePixels(kind, { ...options, width: w, height: h }), (p) => ({ x: p.x, y: -p.y })),
        centerBounds: [-w / 2, -h / 2, w / 2, h / 2],
    });
}

/** A rect's corners, to spread in (`...Shapes.corners`), and the rect they round. */
export { state as corners, rect } from "@/components/modules/corners";
