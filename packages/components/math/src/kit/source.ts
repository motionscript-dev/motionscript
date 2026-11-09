import type { Interval } from "./coords";
import type { ExpressionScope } from "./expression";

/** What a plot's equation, domain and named values are held as, and how each tweens: shared by every plot, 2D and 3D. */

/** An equation on its way to another: both are drawn, `t` of the way across. */
export interface PlotSource {
    source: string;
    blend?: { from: string; t: number };
}

export function readSource(value: string | PlotSource | undefined): PlotSource {
    if (typeof value === "string") return { source: value };
    return value ?? { source: "" };
}

// Mid-tween the prop holds both equations, so a seek restores the blend with it.
export function lerpSource(from: PlotSource, to: PlotSource, t: number): PlotSource {
    if (t <= 0 || from.source === to.source) return t <= 0 ? from : to;
    return t >= 1 ? to : { source: to.source, blend: { from: from.source, t } };
}

export function lerpDomain(from: Interval | null, to: Interval | null, t: number): Interval | null {
    if (!from || !to) return t < 1 ? from : to;
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

/** What a named value is until it is given one. */
export const UNSET_PARAM = 1;

export function lerpParams(from: ExpressionScope, to: ExpressionScope, t: number): ExpressionScope {
    const out: Record<string, number> = { ...from };
    for (const [name, value] of Object.entries(to)) {
        const start = from[name] ?? UNSET_PARAM;
        out[name] = start + (value - start) * t;
    }
    return out;
}

/** `params` with every name of `names` given a value, so one nobody has set yet still draws. */
export function scopeFor(names: readonly string[], params: ExpressionScope): ExpressionScope {
    let filled: Record<string, number> | null = null;
    for (const name of names) {
        if (typeof params[name] !== "number") (filled ??= { ...params })[name] = UNSET_PARAM;
    }
    return filled ?? params;
}

/** A string as a number that changes when it does: what a geometry's `revision` wants. */
export function revisionOf(key: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}
