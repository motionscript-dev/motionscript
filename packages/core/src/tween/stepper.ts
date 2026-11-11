/** A flat animation driver. `advance(dt)` moves forward `dt` seconds and returns `true` once complete (final value applied); prime it at t=0 via `seek(0)` before the first `advance`. `seek(elapsed)` is the absolute-time half a {@link Command}'s `at` is built on: any time, in any order, so a timeline can evaluate a frame without playing the ones before it. */
/** @internal */
export interface TweenStepper {
    /** Jumps to the value at `elapsed` seconds; `0` primes the stepper before the first {@link advance}. */
    seek(elapsed: number): void;
    /** Advances by `dt` seconds; returns `true` when finished and the final value is applied. */
    advance(dt: number): boolean;
}

/** Implemented by anything that can produce a {@link TweenStepper}: a {@link Command}, or anything a host drives directly. */
export interface Steppable {
    _stepper(): TweenStepper;
}

export function isSteppable(x: unknown): x is Steppable {
    return typeof (x as Steppable)?._stepper === "function";
}
