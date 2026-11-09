import { describe, expect, it } from "vitest";

import { loopCommand, makeCommand, type Command } from "@/tween/command";
import { loopPasses, loopPhase, loopRepeats, loopSpan } from "@/tween/loop";

/** A one-second tween from 0 to 100, recording every `t` it is asked for. */
function ramp(duration = 1): { command: Command<{ x: number }>; seen: number[] } {
    const seen: number[] = [];
    const command = makeCommand<{ x: number }>(
        { set: () => { } },
        (t) => {
            seen.push(t);
            return { x: t * 100 };
        },
        duration,
    );
    return { command, seen };
}

describe("loopSpan", () => {
    it("multiplies a counted loop by its passes, first one included", () => {
        expect(loopSpan({ count: 0 }, 2)).toBe(2);
        expect(loopSpan({ count: 1 }, 2)).toBe(4);
        expect(loopSpan({ count: 3 }, 2)).toBe(8);
    });

    it("gives an unlimited loop whatever it was handed to fill", () => {
        expect(loopSpan({ count: null }, 2, 9)).toBe(9);
    });

    it("never shrinks a pass: a fill shorter than one still plays one", () => {
        expect(loopSpan({ count: null }, 2, 0.5)).toBe(2);
    });

    it("leaves a stamp a stamp", () => {
        expect(loopSpan({ count: 4 }, 0)).toBe(0);
    });
});

describe("loopPhase", () => {
    const of = (loop: Parameters<typeof loopPhase>[0], elapsed: number) => loopPhase(loop, elapsed, 2);

    it("wraps `normal` back to the start of each pass", () => {
        expect(of({ count: 2 }, 1)).toBeCloseTo(0.5);
        expect(of({ count: 2 }, 3)).toBeCloseTo(0.5);
        expect(of({ count: 2 }, 5)).toBeCloseTo(0.5);
    });

    it("runs every `reverse` pass end to start", () => {
        expect(of({ direction: "reverse", count: 1 }, 0)).toBe(1);
        expect(of({ direction: "reverse", count: 1 }, 0.5)).toBeCloseTo(0.75);
        expect(of({ direction: "reverse", count: 1 }, 2)).toBe(1);
    });

    it("turns every other `alternate` pass around", () => {
        expect(of({ direction: "alternate", count: 1 }, 1)).toBeCloseTo(0.5);
        expect(of({ direction: "alternate", count: 1 }, 2)).toBe(1);
        expect(of({ direction: "alternate", count: 1 }, 3)).toBeCloseTo(0.5);
        // An even number of passes lands back where it started.
        expect(of({ direction: "alternate", count: 1 }, 4)).toBe(0);
    });

    it("holds the last pass at its end rather than rolling over", () => {
        expect(of({ count: 1 }, 4)).toBe(1);
        expect(of({ count: 1 }, 40)).toBe(1);
    });

    it("keeps wrapping an unlimited loop, however far out", () => {
        expect(of({ count: null }, 41)).toBeCloseTo(0.5);
        expect(loopPasses({ count: null })).toBe(Infinity);
    });
});

describe("loopRepeats", () => {
    it("is false for anything that plays once", () => {
        expect(loopRepeats(undefined)).toBe(false);
        expect(loopRepeats({ count: 0 })).toBe(false);
        expect(loopRepeats({ direction: "alternate", count: 0 })).toBe(false);
    });

    it("is true for a repeat and for an unlimited loop", () => {
        expect(loopRepeats({ count: 1 })).toBe(true);
        expect(loopRepeats({ count: null })).toBe(true);
    });
});

describe("loopCommand", () => {
    it("lasts for every pass, and eases each one over its own pass", () => {
        const { command, seen } = ramp();
        const looped = loopCommand(command, { count: 2 });

        expect(looped.duration).toBe(3);
        expect(looped.at(0)).toEqual({ x: 0 });
        expect(looped.at(0.5).x).toBeCloseTo(50);   // 1.5s in — half of pass two
        expect(looped.at(1)).toEqual({ x: 100 });
        expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    });

    it("hands back an untouched command when there is nothing to repeat", () => {
        const { command } = ramp();
        expect(loopCommand(command, { count: 0 })).toBe(command);
        expect(loopCommand(makeCommand({ set: () => { } }, () => ({}), 0), { count: 3 }).duration).toBe(0);
    });

    it("ends an odd number of `alternate` passes back at the start value", () => {
        const { command } = ramp();
        const looped = loopCommand(command, { direction: "alternate", count: 1 });

        expect(looped.duration).toBe(2);
        expect(looped.at(0.5)).toEqual({ x: 100 });
        expect(looped.at(1)).toEqual({ x: 0 });
    });

    it("fills what it is given when unlimited, and holds a pure `at`", () => {
        const { command } = ramp();
        const looped = loopCommand(command, { count: null }, 4.5);

        expect(looped.duration).toBe(4.5);
        // 3.375s in: three whole passes, then three quarters of the fourth.
        expect(looped.at(0.75).x).toBeCloseTo(37.5);
        expect(looped.at(0.75).x).toBeCloseTo(37.5);
    });

    it("steps through every pass", () => {
        const { command } = ramp();
        const step = loopCommand(command, { count: 1 }).at;

        expect(step(0.25).x).toBeCloseTo(50);
        expect(step(0.5).x).toBeCloseTo(0);
        expect(step(0.75).x).toBeCloseTo(50);
    });
});

describe("loopPasses", () => {
    it("floors a fractional count and counts the first pass", () => {
        expect(loopPasses({ count: 0 })).toBe(1);
        expect(loopPasses({ count: 2.9 })).toBe(3);
        expect(loopPasses({ count: 3 })).toBe(4);
    });

    it("never goes below one pass, however negative the count", () => {
        expect(loopPasses({ count: -0.5 })).toBe(1);
        expect(loopPasses({ count: -4 })).toBe(1);
    });

    it("agrees with loopRepeats about what is a repeat", () => {
        // A fraction under one floors to no repeat, and `loopRepeats` says so.
        expect(loopPasses({ count: 0.5 })).toBe(1);
        expect(loopRepeats({ count: 0.5 })).toBe(false);
        expect(loopPasses({ count: 1.5 })).toBe(2);
        expect(loopRepeats({ count: 1.5 })).toBe(true);
        expect(loopRepeats({ count: -3 })).toBe(false);
    });
});

describe("loopPhase before the start", () => {
    it("treats a negative elapsed as the start of the first pass", () => {
        expect(loopPhase({ count: 2 }, -5, 2)).toBe(0);
        expect(loopPhase({ direction: "reverse", count: 2 }, -5, 2)).toBe(1);
        expect(loopPhase({ direction: "alternate", count: 2 }, -0.1, 2)).toBe(0);
    });

    it("reads a pass that has no length as already finished", () => {
        expect(loopPhase({ count: 2 }, 0, 0)).toBe(1);
        expect(loopPhase({ direction: "reverse", count: 2 }, 3, 0)).toBe(1);
    });
});

describe("the stepper of a looped command", () => {
    it("seeks into any pass and applies that pass's frame", () => {
        const { command, seen } = ramp();
        const stepper = loopCommand(command, { count: 1 })._stepper();

        stepper.seek(0.5);
        expect(seen.at(-1)).toBeCloseTo(0.5);
        stepper.seek(1.25);
        expect(seen.at(-1)).toBeCloseTo(0.25);
        stepper.seek(0);
        expect(seen.at(-1)).toBe(0);
    });

    it("advances through every pass and finishes on the last frame of the last one", () => {
        const { command, seen } = ramp();
        const stepper = loopCommand(command, { count: 1 })._stepper();

        stepper.seek(0);
        expect(stepper.advance(0.75)).toBe(false);
        expect(seen.at(-1)).toBeCloseTo(0.75);
        expect(stepper.advance(0.75)).toBe(false);
        expect(seen.at(-1)).toBeCloseTo(0.5);   // 1.5s in: halfway through pass two
        expect(stepper.advance(0.75)).toBe(true);
        expect(seen.at(-1)).toBe(1);
    });

    it("keeps its own clock per stepper", () => {
        const { command } = ramp();
        const looped = loopCommand(command, { count: 1 });
        const a = looped._stepper();
        const b = looped._stepper();

        expect(a.advance(1.5)).toBe(false);
        expect(b.advance(2)).toBe(true);
        expect(a.advance(0.5)).toBe(true);
    });

    it("runs an unlimited loop to the span it was given to fill", () => {
        const { command, seen } = ramp();
        const stepper = loopCommand(command, { count: null }, 3.5)._stepper();

        stepper.seek(0);
        expect(stepper.advance(3)).toBe(false);
        expect(seen.at(-1)).toBe(0);                // three whole passes land back on a pass start
        expect(stepper.advance(0.5)).toBe(true);
        expect(seen.at(-1)).toBe(0.5);              // done: the phase of 3.5s, half a pass in
    });
});
