import { linear } from "@/tween/ease/constants";
import { easeOfSpec, specOfEase, type EaseSpec } from "@/tween/ease/spec";
import type { EasingFunction } from "@/tween/ease/type";
import { lerpNumber } from "@/tween/lerp";
import type { AttributeOps } from "@/attributes/shared/operators";

/** One point of a {@link Ramp}: a value placed `at` seconds after the start or `before` seconds before the end, plus the ease of the segment arriving at it (linear when absent). */
export type RampKey =
    | { readonly at: number; readonly before?: undefined; readonly value: number; readonly ease?: EaseSpec }
    | { readonly before: number; readonly at?: undefined; readonly value: number; readonly ease?: EaseSpec };

/** Automation for one audio param, as plain JSON. A `before` key stays put when the clip is trimmed, so "the last second" means the last second of any length. */
export interface Ramp {
    readonly keys: readonly RampKey[];
}

/** An audio param: a constant, or a {@link Ramp}. */
export type Param = number | Ramp;

export interface ResolvedRampKey {
    readonly time: number;
    readonly value: number;
    readonly ease: EasingFunction;
    /** Linear into this key, so a device can schedule a cheap ramp rather than a baked curve. */
    readonly linear: boolean;
}

interface Segment {
    readonly from?: number;
    readonly to?: number;
    readonly duration?: number;
    readonly ease?: EaseSpec;
}

/** An ease as data, or an engine-built function (which records the data it came from). */
export type RampEase = EaseSpec | EasingFunction;

const segmentsOf = new WeakMap<RampChain, readonly Segment[]>();

/** The fluent builder `ramp(0, 1, 0.5).hold().ramp(1, 0, 1)`; its only own field is `keys`, so it is a {@link Ramp}. Segments before the first bare `hold()` place from the start, after it from the end, and the hold fills the middle. */
export class RampChain implements Ramp {
    readonly keys: readonly RampKey[];

    constructor(segments: readonly Segment[] = []) {
        segmentsOf.set(this, segments);
        this.keys = keysOf(segments);
    }

    ramp(from: number, to: number, duration: number, options?: { readonly ease?: RampEase }): RampChain {
        return this._append({ from, to, duration, ease: specOf(options?.ease) });
    }

    hold(duration?: number): RampChain {
        return this._append({ duration });
    }

    private _append(segment: Segment): RampChain {
        return new RampChain([...(segmentsOf.get(this) ?? []), segment]);
    }
}

export function ramp(from: number, to: number, duration: number, options?: { readonly ease?: RampEase }): RampChain {
    return new RampChain().ramp(from, to, duration, options);
}

/** A hold; bare `hold()` stretches to fill the middle of the clip. */
export function hold(duration?: number): RampChain {
    return new RampChain().hold(duration);
}

function specOf(ease: RampEase | undefined): EaseSpec | undefined {
    if (ease === undefined) return undefined;
    const spec = typeof ease === "function" ? specOfEase(ease) : ease;
    if (!spec) {
        throw new TypeError("A ramp's ease is stored as data, and this function has none: pass an EaseSpec, or an engine-built ease (easeIn, easeOut, easeInOut, curveEase).");
    }
    return spec.kind === "linear" ? undefined : spec;
}

function keysOf(segments: readonly Segment[]): RampKey[] {
    let previous: number | undefined;
    const values = segments.map((s) => {
        const from = s.from ?? previous;
        const to = s.to ?? from;
        previous = to;
        return { from, to };
    });

    const keys: RampKey[] = [];
    const push = (key: RampKey): void => {
        const last = keys[keys.length - 1];
        if (last && !key.ease && last.at === key.at && last.before === key.before && last.value === key.value) return;
        keys.push(key);
    };
    const withEase = (s: Segment) => (s.ease ? { ease: s.ease } : {});

    const fill = segments.findIndex((s) => s.duration === undefined);
    const head = fill < 0 ? segments.length : fill;
    let at = 0;
    for (let i = 0; i < head; i++) {
        const s = segments[i];
        const duration = Math.max(0, s.duration ?? 0);
        const { from, to } = values[i];
        if (from !== undefined) push({ at, value: from });
        if (to !== undefined) push({ at: at + duration, value: to, ...withEase(s) });
        at += duration;
    }
    if (fill < 0) return keys;

    const tail = segments.slice(fill + 1);
    if (tail.some((s) => s.duration === undefined) && process.env.NODE_ENV !== "production") {
        console.warn("[motionscript] A ramp has more than one bare hold(); only the first stretches, the rest are zero-length.");
    }
    let before = tail.reduce((sum, s) => sum + Math.max(0, s.duration ?? 0), 0);
    for (let i = fill + 1; i < segments.length; i++) {
        const s = segments[i];
        const duration = Math.max(0, s.duration ?? 0);
        const { from, to } = values[i];
        if (from !== undefined) push({ before, value: from });
        before -= duration;
        if (to !== undefined) push({ before: Math.max(0, before), value: to, ...withEase(s) });
    }
    return keys;
}

/** Whether `p` is a {@link Ramp}: anything with a `keys` array, a parsed copy included. */
export function isRamp(p: unknown): p is Ramp {
    return typeof p === "object" && p !== null && Array.isArray((p as Ramp).keys);
}

const LINEAR = linear();
const resolved = new WeakMap<Ramp, { readonly length: number; readonly keys: readonly ResolvedRampKey[] }>();

/** The keys of `ramp` placed on a clip `length` seconds long, in time order. Times clamp to the clip (a longer ramp is cut, not squeezed); crossed anchors sort by where they land, with a development warning. */
export function resolveRamp(ramp: Ramp, length: number): readonly ResolvedRampKey[] {
    const clip = Number.isFinite(length) && length > 0 ? length : 0;
    const cached = resolved.get(ramp);
    if (cached && cached.length === clip) return cached.keys;

    let crossed = false;
    let last = -Infinity;
    const keys = ramp.keys.map((key) => {
        const time = Math.min(clip, Math.max(0, key.before !== undefined ? clip - key.before : key.at ?? 0));
        if (time < last) crossed = true;
        last = time;
        const ease = key.ease ? easeOfSpec(key.ease) : LINEAR;
        return { time, value: key.value, ease, linear: !key.ease || key.ease.kind === "linear" };
    });
    if (crossed) {
        keys.sort((a, b) => a.time - b.time);
        if (process.env.NODE_ENV !== "production") {
            console.warn(`[motionscript] A ramp's start and end keys cross on a ${clip.toFixed(3)}s clip; they play in the order they land.`);
        }
    }
    resolved.set(ramp, { length: clip, keys });
    return keys;
}

/** The value of `ramp` at `t` seconds into a clip `length` seconds long, `fallback` when it has no keys. */
export function sampleRamp(ramp: Ramp, t: number, length: number, fallback: number): number {
    const keys = resolveRamp(ramp, length);
    if (keys.length === 0) return fallback;
    if (t <= keys[0].time) return keys[0].value;
    for (let i = 1; i < keys.length; i++) {
        const key = keys[i];
        if (t > key.time) continue;
        const previous = keys[i - 1];
        const span = key.time - previous.time;
        return lerpNumber(previous.value, key.value, key.ease(span > 0 ? (t - previous.time) / span : 1));
    }
    return keys[keys.length - 1].value;
}

export function staticValue(p: Param, fallback = 0): number {
    if (!isRamp(p)) return p;
    let first: RampKey | undefined;
    for (const key of p.keys) {
        if (key.at !== undefined && (first?.at === undefined || key.at < first.at)) first = key;
    }
    return (first ?? p.keys[0])?.value ?? fallback;
}

/** Equal for two params exactly when they sound the same: what tells a device a param was edited. */
export function paramKey(p: Param | undefined): string {
    if (p === undefined) return "_";
    return isRamp(p) ? `r${JSON.stringify(p.keys)}` : String(p);
}

/** Two numbers lerp; a ramp on either side hard-cuts at the midpoint. */
export function lerpParam(from: Param, to: Param, t: number): Param {
    if (typeof from === "number" && typeof to === "number") return lerpNumber(from, to, t);
    return t < 0.5 ? from : to;
}

export function equalsParam(a: Param | undefined, b: Param | undefined): boolean {
    if (a === b) return true;
    if (typeof a === "number" || typeof b === "number" || a === undefined || b === undefined) return false;
    return paramKey(a) === paramKey(b);
}

export const audioParamOps: AttributeOps<Param, Param> = {
    resolve: (value) => value,
    lerp: lerpParam,
};

const INTEGRATION_STEP = 0.001;
/** The most cells one table holds: past it a long source gets coarser cells, not a bigger table. */
const MAX_CELLS = 20000;

/** `∫ 1/speed` tabulated once per ramp and source length: `clip[i]` is the clip seconds spent by the start of cell `i`, making either direction a lookup (walking from zero per query was quadratic). */
interface SpeedTable {
    readonly step: number;
    readonly clip: Float64Array;
    readonly rate: Float64Array;
}

const speedTables = new WeakMap<Ramp, Map<string, SpeedTable>>();

function speedTableOf(speed: Ramp, sourceLength: number, step: number): SpeedTable {
    let byLength = speedTables.get(speed);
    if (!byLength) speedTables.set(speed, (byLength = new Map()));
    const key = `${sourceLength}:${step}`;
    const cached = byLength.get(key);
    if (cached) return cached;
    const cells = Math.max(1, Math.min(MAX_CELLS, Math.ceil(sourceLength / step)));
    const size = sourceLength / cells;
    const clip = new Float64Array(cells + 1);
    const rate = new Float64Array(cells);
    for (let i = 0; i < cells; i++) {
        rate[i] = Math.max(1e-6, sampleRamp(speed, (i + 0.5) * size, sourceLength, 1));
        clip[i + 1] = clip[i] + size / rate[i];
    }
    const table = { step: size, clip, rate };
    if (byLength.size >= 8) byLength.clear();
    byLength.set(key, table);
    return table;
}

/** Clip seconds spent playing the first `upper` source seconds under a speed ramp: `∫ 1/speed(τ) dτ`, with the ramp placed on `sourceLength` and speed floored just above zero. */
export function integrateSpeedToClipTime(speed: Ramp, sourceLength: number, upper: number = sourceLength, step = INTEGRATION_STEP): number {
    const end = Math.min(upper, sourceLength);
    if (end <= 0) return 0;
    const table = speedTableOf(speed, sourceLength, step);
    const cell = Math.min(table.rate.length - 1, Math.floor(end / table.step));
    return table.clip[cell] + (end - cell * table.step) / table.rate[cell];
}

/** Inverse of {@link integrateSpeedToClipTime}: the source seconds reached after `clipElapsed` clip seconds. */
export function sourceTimeAtClipElapsed(speed: Ramp, sourceLength: number, clipElapsed: number, step = INTEGRATION_STEP): number {
    if (clipElapsed <= 0 || sourceLength <= 0) return 0;
    const table = speedTableOf(speed, sourceLength, step);
    const { clip, rate } = table;
    if (clipElapsed >= clip[clip.length - 1]) return sourceLength;
    let lo = 0;
    let hi = rate.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (clip[mid] <= clipElapsed) lo = mid;
        else hi = mid - 1;
    }
    return Math.min(sourceLength, lo * table.step + (clipElapsed - clip[lo]) * rate[lo]);
}
