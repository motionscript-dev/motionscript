/**
 * Repetition as data: how many times a command runs and which way each pass goes. A loop is a **placement** property
 * like `at` and `duration` (when it runs, never what it does), so the wrapper goes around a built `Command` and `to`,
 * `fillTo`, `countTo` and custom commands all loop by the same code. It stays seekable: `at(t)` maps `t` onto a pass
 * and asks the inner command for that pass's frame, so scrubbing into the fourth repetition costs the same as the first.
 */

import { clamp01 } from "@/util/clamp";

/** Which way a pass runs. `alternate` makes a bounce (out and back) one command with two passes, not two commands kept in step by hand. */
export type LoopDirection = "normal" | "reverse" | "alternate";

/** How a command repeats. Absent on a command is "runs once". */
export interface LoopSpec {
    /** Absent is `"normal"`. */
    direction?: LoopDirection;
    /** Repeats **after** the first pass: `0` is no loop, `3` plays four passes, `null` repeats for as long as there is clip left to fill. (Repeats, not total passes, so "repeat twice" is `2` and the no-op is `0`.) */
    count: number | null;
}

/** Total passes: repeats plus the first one, or `Infinity` for an unlimited loop. */
export function loopPasses(loop: LoopSpec): number {
    return loop.count === null ? Infinity : Math.max(0, Math.floor(loop.count)) + 1;
}

/** Whether a loop changes anything: an unlimited one always does, a counted one only past zero. */
export function loopRepeats(loop: LoopSpec | undefined): loop is LoopSpec {
    return loop !== undefined && (loop.count === null || loop.count >= 1);
}

/** Seconds a looped command occupies. `fill` is what an unlimited loop covers (the clip's remaining time): it does not *define* a length, so `documentDuration` counts one pass and this stretches it. */
export function loopSpan(loop: LoopSpec, duration: number, fill = duration): number {
    if (duration <= 0) return duration;
    if (loop.count === null) return Math.max(duration, fill);
    return duration * loopPasses(loop);
}

/** Where in one pass `elapsed` lands, as normalized time for the inner command. Past the last pass of a counted loop it holds at that pass's end, so the value a loop leaves is the value the next command tweens from. */
export function loopPhase(loop: LoopSpec, elapsed: number, duration: number): number {
    if (duration <= 0) return 1;
    const passes = loopPasses(loop);
    const capped = Math.min(Math.max(elapsed, 0) / duration, passes);
    // `passes - 1` holds the final pass at its end instead of rolling over to a
    // pass that does not exist. `Infinity - 1` is still `Infinity`, so an
    // unlimited loop is never capped.
    const index = Math.min(Math.floor(capped), passes - 1);
    const t = clamp01(capped - index);
    switch (loop.direction ?? "normal") {
        case "reverse": return 1 - t;
        case "alternate": return index % 2 === 0 ? t : 1 - t;
        default: return t;
    }
}
