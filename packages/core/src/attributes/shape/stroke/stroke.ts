import { fillOps } from '@/attributes/shape/fill/registry';
import { FillResolved } from '../fill/union';
import { Fill } from '../fill/chain';
import type { AttributeOps } from '@/attributes/shared/operators';

/** Where the stroke sits relative to the shape's edge, in `[-1, 1]`: -1 fully inside, 0 centred (straddling), +1 fully outside; named values map to the endpoints, intermediate numbers bias partway (like Figma's stroke alignment). */
export type StrokeAlign = number | 'inside' | 'center' | 'outside';

/** Resolve a loose `align` prop to a clamped number in [-1, 1]. */
export function resolveStrokeAlign(align: StrokeAlign | undefined, fallback: number): number {
    if (align == null) return fallback;
    if (typeof align === 'number') return Math.max(-1, Math.min(1, align));
    switch (align) {
        case 'inside': return -1;
        case 'center': return 0;
        case 'outside': return 1;
    }
    return fallback;
}

export type StrokeCap = 'butt' | 'round' | 'square';

/** A shape one end of an open contour wears in place of a cap, sized by `capScale`: `arrow` is an open chevron, `triangle`/`stealth` filled heads with their tip on the path's end, `dot`/`box`/`diamond`/`bar` centred on it. */
export type StrokeMarker = 'arrow' | 'triangle' | 'stealth' | 'dot' | 'box' | 'diamond' | 'bar';

/** What one end of an open contour wears: a cap, or a marker. */
export type StrokeEnd = StrokeCap | StrokeMarker;

/** A marker's length as a multiple of the stroke's weight, where none is given. */
export const DEFAULT_CAP_SCALE = 4;

export function isStrokeMarker(end: StrokeEnd | undefined): end is StrokeMarker {
    switch (end) {
        case 'arrow':
        case 'triangle':
        case 'stealth':
        case 'dot':
        case 'box':
        case 'diamond':
        case 'bar': return true;
    }
    return false;
}

export type StrokeJoin = 'miter' | 'round' | 'bevel';

export function resolveStrokeCap(cap: StrokeCap | undefined, fallback: StrokeCap): StrokeCap {
    if (cap == null) return fallback;
    switch (cap) {
        case 'butt':
        case 'round':
        case 'square': return cap;
    }
    return fallback;
}

export function resolveStrokeEnd(end: StrokeEnd | undefined, fallback: StrokeCap): StrokeEnd {
    return isStrokeMarker(end) ? end : resolveStrokeCap(end, fallback);
}

export function resolveStrokeJoin(join: StrokeJoin | undefined, fallback: StrokeJoin): StrokeJoin {
    if (join == null) return fallback;
    switch (join) {
        case 'miter':
        case 'round':
        case 'bevel': return join;
    }
    return fallback;
}

export interface StrokeProp {
    weight?: number;
    /** Any loose fill: a CSS color string, fill prop object, resolved fill, or {@link FillChain}/array of layers. */
    fill?: Fill;
    /** Dash pattern. A single number `n` becomes `[n, n]`. */
    dash?: number | number[];
    dashOffset?: number;
    /** `'inside'` (-1), `'center'` (0), `'outside'` (1) or a number in [-1, 1]. Defaults to `'inside'`, so the stroke stays within the shape's measured bounds (like a CSS border). */
    align?: StrokeAlign;
    /** How the ends of each dash and of an open stroke are shaped (default `'butt'`); `startCap`/`endCap` override it at the path's two ends. */
    cap?: StrokeCap;
    /** The cap or marker at the start of each open contour, in place of `cap`. */
    startCap?: StrokeEnd;
    /** The cap or marker at the end of each open contour, in place of `cap`. */
    endCap?: StrokeEnd;
    /** A marker's length as a multiple of `weight` (default `4`) so a head keeps its proportion as the stroke thickens; on a short contour it shrinks to fit. */
    capScale?: number;
    /** How two segments meet at a corner (default `'miter'`). */
    join?: StrokeJoin;
    /** Maximum miter length to stroke width ratio before a `'miter'` join truncates to a bevel (default 4). */
    miterLimit?: number;
}

/** Fully resolved stroke: all fields normalised, defaults applied. */
export interface StrokeResolved {
    weight: number;
    fill: FillResolved[];
    dash?: number[];
    dashOffset: number;
    align: number;
    /** End-cap shape for dash ends, and for open strokes' ends unless overridden. */
    cap: StrokeCap;
    /** Absent means the end follows `cap`. */
    startCap?: StrokeEnd;
    endCap?: StrokeEnd;
    capScale: number;
    join: StrokeJoin;
    miterLimit: number;
}

/** Accepted shapes for a node's `stroke`: a loose {@link StrokeProp}, an array of them (stacked bottom-to-top), or already-resolved values, which pass through `resolveStroke` idempotently so a read-back `stroke` can be assigned straight back. */
export type Stroke =
    | StrokeProp
    | StrokeResolved
    | (StrokeProp | StrokeResolved)[];

export function resolveStroke(prop: StrokeProp, previous?: StrokeResolved): StrokeResolved {
    let dash: number[] | undefined;
    if (prop.dash != null) {
        const raw = Array.isArray(prop.dash) ? prop.dash : [prop.dash];
        dash = raw.length === 1 ? [raw[0], raw[0]] : raw;
    } else {
        dash = previous?.dash;
    }
    const cap = resolveStrokeCap(prop.cap, previous?.cap ?? 'butt');
    return {
        weight: prop.weight ?? previous?.weight ?? 1,
        fill: prop.fill != null ? fillOps.resolve(prop.fill) : (previous?.fill ?? fillOps.resolve('transparent')),
        dash,
        dashOffset: prop.dashOffset ?? previous?.dashOffset ?? 0,
        align: resolveStrokeAlign(prop.align, previous?.align ?? -1),
        cap,
        startCap: prop.startCap != null ? resolveStrokeEnd(prop.startCap, cap) : previous?.startCap,
        endCap: prop.endCap != null ? resolveStrokeEnd(prop.endCap, cap) : previous?.endCap,
        capScale: Math.max(0, prop.capScale ?? previous?.capScale ?? DEFAULT_CAP_SCALE),
        join: resolveStrokeJoin(prop.join, previous?.join ?? 'miter'),
        miterLimit: prop.miterLimit ?? previous?.miterLimit ?? 4,
    };
}

function lerpDashArray(from: number[] | undefined, to: number[] | undefined, t: number): number[] | undefined {
    const fArray = from || [];
    const tArray = to || [];
    if (fArray.length === 0 && tArray.length === 0) return from;

    const len = Math.max(fArray.length, tArray.length);
    const result: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
        // Pad shorter arrays with 0 to ensure smooth transitions.
        const fVal = fArray[i] ?? 0;
        const tVal = tArray[i] ?? 0;
        result[i] = fVal + (tVal - fVal) * t;
    }
    return result;
}

function lerpStroke(from: StrokeResolved, to: StrokeResolved, t: number): StrokeResolved {
    return {
        weight: from.weight + (to.weight - from.weight) * t,
        fill: fillOps.lerp(from.fill, to.fill, t),
        dash: lerpDashArray(from.dash, to.dash, t) as number[],
        dashOffset: from.dashOffset + (to.dashOffset - from.dashOffset) * t,
        align: from.align + (to.align - from.align) * t,
        // cap/join are discrete enums — snap at the midpoint.
        cap: t < 0.5 ? from.cap : to.cap,
        startCap: t < 0.5 ? from.startCap : to.startCap,
        endCap: t < 0.5 ? from.endCap : to.endCap,
        capScale: from.capScale + (to.capScale - from.capScale) * t,
        join: t < 0.5 ? from.join : to.join,
        miterLimit: from.miterLimit + (to.miterLimit - from.miterLimit) * t,
    };
}

export const strokeOps: AttributeOps<Stroke, StrokeResolved[]> = {
    resolve: (prop, previous) => {
        if (prop == null) return [];
        const arr = Array.isArray(prop) ? prop : [prop];
        return arr.map((p, i) => resolveStroke(p as StrokeProp, previous?.[i]));
    },
    lerp: (from, to, t) => {
        if (from === to) return from;
        const len = Math.max(from.length, to.length);
        const result: StrokeResolved[] = [];
        for (let i = 0; i < len; i++) {
            const f = from[i];
            const tf = to[i];
            if (!f) { result.push(tf); continue; }
            if (!tf) { result.push(f); continue; }
            result.push(lerpStroke(f, tf, t));
        }
        return result;
    },
};
