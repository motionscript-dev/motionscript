import { colorOps, fillOps, type Color, type Fill, type FillResolved, type NormalizedColor } from "@motionscript/sdk";
import { clamp } from "./geometry";

/** A run of colours a value is read off, lowest first: a surface's height, a field's strength. */

export function readScale(value: readonly Color[] | undefined): NormalizedColor[] {
    return (value ?? []).map((color) => colorOps.resolve(color));
}

export function lerpScale(from: NormalizedColor[], to: NormalizedColor[], t: number): NormalizedColor[] {
    if (from.length !== to.length) return t < 1 ? from : to;
    return to.map((color, index) => colorOps.lerp(from[index], color, t));
}

/** The colour `share` of the way along `scale`, 0 to 1. */
export function colorAt(scale: readonly NormalizedColor[], share: number): NormalizedColor {
    if (scale.length === 1) return scale[0];
    const at = clamp(share, 0, 1) * (scale.length - 1);
    const index = Math.min(scale.length - 2, Math.floor(at));
    return colorOps.lerp(scale[index], scale[index + 1], at - index);
}

/** A run of paints a value is read off, lowest first: a field's strength. Every entry is kept as written. */
export function readFillScale(value: readonly Fill[] | undefined): FillResolved[][] {
    return (Array.isArray(value) ? value : []).map((fill) => fillOps.resolve(fill ?? []));
}

export function lerpFillScale(from: FillResolved[][], to: FillResolved[][], t: number): FillResolved[][] {
    if (from.length !== to.length) return t < 1 ? from : to;
    return to.map((fill, index) => fillOps.lerp(from[index], fill, t));
}

/** The paint `share` of the way along `scale`, 0 to 1. */
export function fillAt(scale: readonly FillResolved[][], share: number): FillResolved[] {
    if (scale.length === 1) return scale[0];
    const at = clamp(share, 0, 1) * (scale.length - 1);
    const index = Math.min(scale.length - 2, Math.floor(at));
    return fillOps.lerp(scale[index], scale[index + 1], at - index);
}
