import { CornerStyle } from "@/attributes/shape/corners/corner-style";
import { ShapeAlignmentInput, ShapeState, resolveShapeAlignment, resolveShapePivot, stripShapeAlignmentKeys } from "./shape";

export interface PolygramState extends ShapeState {
    width: number;
    height: number;
    sides: number;
    ratio: number;
    /** Vertex rounding radius in pixels (applied uniformly to every vertex). */
    cornerRadius: number;
    /** Vertex shape: `'rounded'` (circular arc) or `'angled'` (chamfer). */
    cornerStyle: CornerStyle;
}

export function withPolygramDescriptor(descriptor: Partial<PolygramState> & ShapeAlignmentInput): PolygramState {
    const width = descriptor.width ?? 0;
    const height = descriptor.height ?? 0;
    const { x, y, pivot } = resolveShapeAlignment(descriptor, width, height);
    return {
        ...stripShapeAlignmentKeys(descriptor),
        rotation: descriptor.rotation ?? 0,
        scale: descriptor.scale ?? 1,
        x,
        y,
        start: descriptor.start ?? 0,
        end: descriptor.end ?? 1,
        pivot: resolveShapePivot(pivot),

        width,
        height,
        sides: descriptor.sides ?? 5,
        ratio: descriptor.ratio ?? 0.5,
        cornerRadius: descriptor.cornerRadius ?? 0,
        cornerStyle: descriptor.cornerStyle ?? "rounded",
    };
}
