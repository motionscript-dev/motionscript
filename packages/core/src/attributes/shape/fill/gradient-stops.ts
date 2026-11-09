import type { NormalizedColor } from './color/parser';
import { lerpColor } from './lerp';

/** A colour ramp: `colors[i]` sits at `stops[i]` (ascending, 0 to 1). */
export interface ColorRamp {
    colors: NormalizedColor[];
    stops: number[];
}

/** The colour of `ramp` at `position`: clamped past either end, linear between stops. */
function sampleRamp(ramp: ColorRamp, position: number): NormalizedColor {
    const { colors, stops } = ramp;
    const last = colors.length - 1;
    if (position <= stops[0]) return colors[0];
    if (position >= stops[last]) return colors[last];
    let hi = 1;
    while (stops[hi] < position) hi++;
    const lo = hi - 1;
    const span = stops[hi] - stops[lo];
    return lerpColor(colors[lo], colors[hi], span > 0 ? (position - stops[lo]) / span : 0);
}

/**
 * The colour of `ramp` for the `k`-th of several stops that share `position`: the
 * ramp's own stop there when it has one (a hard edge keeps both sides), else
 * the interpolated value.
 */
function colorAt(ramp: ColorRamp, position: number, k: number): NormalizedColor {
    const first = ramp.stops.indexOf(position);
    if (first === -1) return sampleRamp(ramp, position);
    let count = 1;
    while (ramp.stops[first + count] === position) count++;
    return ramp.colors[first + Math.min(k, count - 1)];
}

const sameStops = (a: number[], b: number[]) => a.length === b.length && a.every((s, i) => s === b[i]);

/**
 * Interpolates two colour ramps. Two ramps with the same stop positions are
 * blended stop by stop. Otherwise both are resampled onto the union of their
 * positions first (a position either ramp doubles, as for a hard edge, is kept
 * doubled), so a tween between a 2-stop and a 3-stop gradient is the destination
 * ramp at `t = 1` rather than the source's stop count with the destination's
 * colours merged in.
 */
export function lerpColorRamp(a: ColorRamp, b: ColorRamp, t: number): ColorRamp {
    if (sameStops(a.stops, b.stops)) {
        return {
            colors: a.colors.map((c, i) => lerpColor(c, b.colors[i], t)),
            stops: a.stops.slice(),
        };
    }
    const count = new Map<number, number>();
    for (const ramp of [a, b]) {
        const own = new Map<number, number>();
        for (const s of ramp.stops) own.set(s, (own.get(s) ?? 0) + 1);
        for (const [s, n] of own) count.set(s, Math.max(count.get(s) ?? 0, n));
    }
    const colors: NormalizedColor[] = [];
    const stops: number[] = [];
    for (const position of [...count.keys()].sort((x, y) => x - y)) {
        for (let k = 0; k < count.get(position)!; k++) {
            colors.push(lerpColor(colorAt(a, position, k), colorAt(b, position, k), t));
            stops.push(position);
        }
    }
    return { colors, stops };
}
