import { EasingFunction } from "./ease/type";

/** Linearly interpolates `from + (to - from) * t`; `t` outside [0, 1] extrapolates. */
export function lerpNumber(from: number, to: number, t: number): number {
    return from + (to - from) * t;
}

/** Interpolates a CSS-style perspective distance (px; `0` is a parallel projection). Perspective enters the matrix as its reciprocal (`x / (1 - z/perspective)`), so `1/perspective` varies smoothly with visual strength: lerping the raw px value would sweep through small positive numbers near `0` where the reciprocal diverges, flashing a near-degenerate projection at the start of a `0 → 800` tween. Lerping the reciprocal (`0` standing for `0`, as in `isProjective`/`invP` in `matrix2d.ts`) stays monotonic and bounded. */
export function lerpPerspective(from: number, to: number, t: number): number {
    const invFrom = from !== 0 ? 1 / from : 0;
    const invTo = to !== 0 ? 1 / to : 0;
    const inv = invFrom + (invTo - invFrom) * t;
    return inv !== 0 ? 1 / inv : 0;
}

export type LerpFunction<T> = (from: T, to: T, t: number) => T;
export type TweenOptions<T> = { ease?: EasingFunction, lerp?: LerpFunction<T> };