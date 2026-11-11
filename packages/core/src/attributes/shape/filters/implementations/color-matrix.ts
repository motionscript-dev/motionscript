import type { FilterData } from "../registry";
import { lerpNumber } from "@/tween/lerp";

/** An arbitrary 4×5 row-major colour transform: rows [R, G, B, A], each `[rScale, gScale, bScale, aScale, bias]`. For tints, channel swaps, anything the named filters don't cover. */
export interface ColorMatrixFilter {
    type: 'colorMatrix';
    /** 4×5 row-major color matrix. */
    matrix: number[];
}

export const colorMatrixFilter: FilterData<ColorMatrixFilter> = {
    // Lerps each matrix coefficient independently; missing target coefficients
    // hold their source value so partial matrices still animate gracefully.
    lerp: (from, to, t) => ({
        type: "colorMatrix",
        matrix: from.matrix.map((v, i) => lerpNumber(v, to.matrix[i] ?? v, t)),
    }),
    equals: (a, b) => a.matrix.length === b.matrix.length && a.matrix.every((v, i) => v === b.matrix[i]),
};
