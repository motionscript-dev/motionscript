// End-marker outlines, in the frame of the end they sit on: `u` runs the way the
// stroke leaves, `v` to its left, and the origin is the path's end. `size` is
// the marker's length and `weight` the stroke's.

import type { StrokeMarker } from "@motionscript/core";

/** Half-width over length of a pointed head: as wide as it is long. */
const SPREAD = 0.5;
const SPREAD_LENGTH = Math.hypot(1, SPREAD);
const SPREAD_SIN = SPREAD / SPREAD_LENGTH;
const SPREAD_COS = 1 / SPREAD_LENGTH;

/** How far up a stealth head its notch reaches, as a share of its length. */
const STEALTH_NOTCH = 0.35;

/** A head with its tip on the end, turned by the stretch of path it covers. */
export function markerIsPointed(marker: StrokeMarker): boolean {
    return marker === "arrow" || marker === "triangle" || marker === "stealth";
}

/**
 * How far behind the end the stroke's own band has to stop: a pointed head is
 * narrower than the band near its tip, so the band's square end would show
 * either side of it.
 */
export function markerInset(marker: StrokeMarker, size: number, weight: number): number {
    return markerIsPointed(marker) ? Math.min(size, weight / (2 * SPREAD)) : 0;
}

/** The outline as a flat `[u, v, …]` polygon, or `null` for a disc `size` across centred on the end. */
export function markerPolygon(marker: StrokeMarker, size: number, weight: number): number[] | null {
    const half = size / 2;
    switch (marker) {
        case "dot":
            return null;
        case "triangle":
            return [0, 0, -size, size * SPREAD, -size, -size * SPREAD];
        case "stealth":
            return [0, 0, -size, size * SPREAD, -size * (1 - STEALTH_NOTCH), 0, -size, -size * SPREAD];
        case "arrow":
            return chevron(size, weight);
        case "box":
            return [-half, -half, half, -half, half, half, -half, half];
        case "diamond":
            return [half, 0, 0, half, -half, 0, 0, -half];
        case "bar":
            return [-weight / 2, -half, weight / 2, -half, weight / 2, half, -weight / 2, half];
    }
}

// Two limbs `weight` thick meeting in a mitre whose point is the origin. Short
// of room for a gap between them it is the solid triangle.
function chevron(size: number, weight: number): number[] {
    const outerV = size * SPREAD;
    const innerU = -size - weight * SPREAD_SIN;
    const innerV = outerV - weight * SPREAD_COS;
    if (innerV <= 0) return [0, 0, -size, outerV, -size, -outerV];
    const crotch = -weight / SPREAD_SIN;
    return [0, 0, -size, outerV, innerU, innerV, crotch, 0, innerU, -innerV, -size, -outerV];
}
