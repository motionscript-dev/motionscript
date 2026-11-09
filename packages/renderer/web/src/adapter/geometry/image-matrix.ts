import type { Bounds } from "./base";

/** The placement fields `computeImageMatrix` reads off an image or video fill. */
export interface MediaPlacement {
    fit?: string;
    crop?: { left: number; right: number; top: number; bottom: number };
    zoom?: number;
    anchor?: { x: number; y: number };
    matrix?: Float32Array | number[][];
}

/**
 * The image→shape matrix (row-major 3×3 as 9 numbers) from intrinsic source
 * pixels, the space `tile`, `crop` and a raw `matrix` are authored in. Four
 * stages compose in order: crop picks a window treated as the whole image, fit
 * sets the base scale for it, zoom multiplies that, and anchor is both the zoom
 * focal point and the alignment where the image doesn't cover.
 */
export function computeImageMatrix(imgW: number, imgH: number, fill: MediaPlacement, bounds: Bounds | null): number[] {
    if (fill.matrix) {
        if (fill.matrix instanceof Float32Array) return Array.from(fill.matrix);
        return (fill.matrix as number[][]).flat();
    }
    const zoom = fill.zoom ?? 1;
    if (!bounds) return [zoom, 0, 0, 0, zoom, 0, 0, 0, 1];

    const mode = fill.fit ?? "fill";
    const boxW = bounds.right - bounds.left;
    const boxH = bounds.bottom - bounds.top;
    // A repeating texture repeats the whole image, so a tile ignores the crop.
    const crop = mode === "tile" ? undefined : fill.crop;
    const srcX = crop ? crop.left * imgW : 0;
    const srcY = crop ? crop.top * imgH : 0;
    const srcW = crop ? imgW * (1 - crop.left - crop.right) : imgW;
    const srcH = crop ? imgH * (1 - crop.top - crop.bottom) : imgH;
    if (srcW <= 0 || srcH <= 0) return [zoom, 0, bounds.left, 0, zoom, bounds.top, 0, 0, 1];

    let sx: number, sy: number;
    if (mode === "fit") {
        sx = sy = Math.min(boxW / srcW, boxH / srcH);
    } else if (mode === "stretch") {
        sx = boxW / srcW; sy = boxH / srcH;
    } else if (mode === "tile") {
        sx = sy = 1;
    } else {
        sx = sy = Math.max(boxW / srcW, boxH / srcH);
    }
    sx *= zoom; sy *= zoom;
    // A repeating texture has no corner to pin, so a tile keeps its origin.
    if (mode === "tile") return [sx, 0, bounds.left, 0, sy, bounds.top, 0, 0, 1];

    // The anchor is [-1, 1] y-up (the pivot space); texture space is [0, 1] y-down.
    const anchor = fill.anchor ?? { x: 0, y: 0 };
    const ax = (anchor.x + 1) / 2;
    const ay = (1 - anchor.y) / 2;
    const tx = bounds.left + ax * (boxW - srcW * sx) - srcX * sx;
    const ty = bounds.top + ay * (boxH - srcH * sy) - srcY * sy;
    return [sx, 0, tx, 0, sy, ty, 0, 0, 1];
}
