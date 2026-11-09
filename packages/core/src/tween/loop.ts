/**
 * Repetition, as data: how many times a command runs and which way each pass
 * goes.
 *
 * A loop is a **placement** property, the same kind of thing as `at` and
 * `duration` — it says when the command is running, never what it does. That is
 * why it lives out here rather than in any one command's args: the wrapper goes
 * *around* a built `Command`, so `to`, `fillTo`, `countTo` and a custom
 * `command()` nobody has written yet all loop by the same code, with nothing to
 * forward and nothing to forget.
 *
 * And it stays seekable. A looped command is still a pure function of its own
 * normalized time — `at(t)` maps `t` onto a pass and asks the inner command for
 * that pass's frame — so scrubbing into the fourth repetition costs the same as
 * scrubbing into the first, which is the whole reason commands are values here.
 */

import { clamp01 } from "@/util/clamp";

/**
 * Which way a pass runs.
 *
 * `alternate` is the reason this is three values rather than a boolean: a
 * bounce — out and back — is one command with two passes, not two commands whose
 * `at`s have to be kept in step by hand.
 */
export type LoopDirection = "normal" | "reverse" | "alternate";

/**
 * How a command repeats. Absent on a command is "runs once".
 */
export interface LoopSpec {
    /** Absent is `"normal"`. */
    direction?: LoopDirection;
    /**
     * How many times to repeat **after** the first pass: `0` is no repeat (the
     * same as no loop at all), `3` plays four passes, and `null` repeats for as
     * long as there is clip left to fill.
     *
     * Repeats rather than total passes so that the value reads as what the word
     * says — "repeat twice" is `2` — and so that the no-op is `0` rather than a
     * `1` that looks like it should do something.
     */
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

/**
 * Seconds a looped command occupies.
 *
 * `fill` is what an unlimited loop is given to cover — the clip's remaining time,
 * where a timeline places one. An unlimited loop does not *define* a length the
 * way a counted one does: a background that turns forever should fill the scene
 * it is in, not stretch it, so `documentDuration` counts one pass of it and this
 * stretches it to whatever that came to.
 */
export function loopSpan(loop: LoopSpec, duration: number, fill = duration): number {
    if (duration <= 0) return duration;
    if (loop.count === null) return Math.max(duration, fill);
    return duration * loopPasses(loop);
}

/**
 * Where in one pass `elapsed` lands, as normalized time for the inner command.
 *
 * Past the last pass of a counted loop it holds at that pass's end rather than
 * wrapping to the start — the same rule a finished command follows everywhere
 * else, and what keeps the value a loop leaves behind the value the next command
 * tweens from.
 */
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
