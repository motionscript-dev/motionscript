import type { ResolvedTextSpan, TextAlign } from "@/attributes/text/types";
import { ShapeAlignmentInput, ShapeState, resolveShapeAlignment, resolveShapePivot, stripShapeAlignmentKeys } from "./shape";

export interface RichTextState extends ShapeState {
    spans: ResolvedTextSpan[];
    /** A named typography preset — see {@link TextState.variant}. Applied per span. */
    variant?: string;
    lineHeight: number;
    textAlign: TextAlign;
    width: number;
    height: number;
}

export function withRichTextDescriptor(descriptor: Partial<RichTextState> & ShapeAlignmentInput): RichTextState {
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
        spans: descriptor.spans ?? [],
        lineHeight: descriptor.lineHeight ?? 1.2,
        textAlign: descriptor.textAlign ?? 'center',
        width,
        height,
    };
}
