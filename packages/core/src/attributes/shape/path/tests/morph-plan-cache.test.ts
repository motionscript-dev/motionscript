import { beforeEach, describe, expect, it, vi } from "vitest";

import { pathOps } from "../ops";

// `lerp` keeps the last plan it built, and nothing public says when it builds
// one. Building a plan reads both paths through `contours`, so wrapping that in
// a spy turns "how many plans were built" into "how many pairs of reads".
const walk = vi.hoisted(() => ({ contourCalls: 0 }));
vi.mock("../walk", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../walk")>();
    return {
        ...actual,
        contours: (d: Parameters<typeof actual.contours>[0]) => {
            walk.contourCalls++;
            return actual.contours(d);
        },
    };
});

const SQUARE = "M 0 0 L 10 0 L 10 10 L 0 10 Z";
const TRIANGLE = "M 0 0 L 10 0 L 5 10 Z";
const DIAMOND = "M 5 0 L 10 5 L 5 10 L 0 5 Z";

/** How many plans building `lerp(from, to, t)` costs: each plan reads two paths. */
function plansBuilt(run: () => void): number {
    const before = walk.contourCalls;
    run();
    return (walk.contourCalls - before) / 2;
}

describe("lerp – the one-entry plan cache", () => {
    beforeEach(() => {
        // Park the cache on a pair no test below uses.
        pathOps.lerp("M 1 1 L 2 2 L 3 1 Z", "M 4 4 L 5 5 L 6 4 Z", 0.5);
    });

    it("builds a plan on the first in-between sample", () => {
        expect(plansBuilt(() => pathOps.lerp(SQUARE, TRIANGLE, 0.5))).toBe(1);
    });

    it("reuses it for every later t of the same pair", () => {
        pathOps.lerp(SQUARE, TRIANGLE, 0.1);
        expect(plansBuilt(() => {
            for (const t of [0.2, 0.3, 0.9, 0.5]) pathOps.lerp(SQUARE, TRIANGLE, t);
        })).toBe(0);
    });

    it("builds none for the exact ends, which return the endpoints", () => {
        expect(plansBuilt(() => {
            pathOps.lerp(SQUARE, TRIANGLE, 0);
            pathOps.lerp(SQUARE, TRIANGLE, 1);
            pathOps.lerp(SQUARE, TRIANGLE, -1);
            pathOps.lerp(SQUARE, TRIANGLE, 2);
        })).toBe(0);
    });

    it("rebuilds for a different target", () => {
        pathOps.lerp(SQUARE, TRIANGLE, 0.5);
        expect(plansBuilt(() => pathOps.lerp(SQUARE, DIAMOND, 0.5))).toBe(1);
    });

    it("rebuilds for a different source", () => {
        pathOps.lerp(SQUARE, TRIANGLE, 0.5);
        expect(plansBuilt(() => pathOps.lerp(DIAMOND, TRIANGLE, 0.5))).toBe(1);
    });

    it("holds one plan only: going back to the first pair rebuilds it", () => {
        pathOps.lerp(SQUARE, TRIANGLE, 0.5);
        pathOps.lerp(SQUARE, DIAMOND, 0.5);
        expect(plansBuilt(() => pathOps.lerp(SQUARE, TRIANGLE, 0.5))).toBe(1);
    });

    it("compares strings by value, so an equal string is a hit", () => {
        pathOps.lerp(SQUARE, TRIANGLE, 0.5);
        expect(plansBuilt(() => pathOps.lerp("M 0 0 L 10 0 L 10 10 L 0 10 Z", "M 0 0 L 10 0 L 5 10 " + "Z", 0.5))).toBe(0);
    });

    it("compares arrays by reference, so an equal copy is a miss", () => {
        const from = pathOps.commands(SQUARE);
        const to = pathOps.commands(TRIANGLE);
        pathOps.lerp(from, to, 0.5);
        expect(plansBuilt(() => pathOps.lerp(from, to, 0.6))).toBe(0);
        expect(plansBuilt(() => pathOps.lerp([...from], to, 0.6))).toBe(1);
    });

    it("returns the same samples from a cached plan as from a fresh one", () => {
        const first = pathOps.lerp(SQUARE, TRIANGLE, 0.4);
        pathOps.lerp(SQUARE, DIAMOND, 0.4);
        const rebuilt = pathOps.lerp(SQUARE, TRIANGLE, 0.4);
        expect(rebuilt).toEqual(first);
    });
});
