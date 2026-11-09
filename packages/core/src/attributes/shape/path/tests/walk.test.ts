import { describe, expect, it } from "vitest";

import { contourBounds, contours, parseCommands, segmentPointAt } from "../walk";
import { measureContours } from "../measure";
import { pathOps } from "../ops";
import type { PathCommand } from "@/render/descriptors/path";

/**
 * The single pen walk, and the four things the seven walks it replaced disagreed
 * about: where `Z` leaves the cursor, which control point an `S`/`T` reflects,
 * how a number run is split, and what an arc is.
 *
 * Each case here is a behaviour at least one of the old walks got wrong, so this
 * file is the regression net for the unification rather than coverage for its
 * own sake.
 */
describe("the number grammar", () => {
    it("splits a run of numbers with no separators", () => {
        // The regex scanner read `.5.5` as one token, and `parseFloat` then kept
        // only the first half — so this parsed as a move with an undefined y.
        expect(parseCommands("M.5.5")).toEqual([{ type: "M", x: 0.5, y: 0.5 }]);
    });

    it("reads a minus as a separator, not an operator", () => {
        expect(parseCommands("M0 0L1-2")).toEqual([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 1, y: -2 },
        ]);
    });

    it("keeps a minus that belongs to an exponent", () => {
        expect(parseCommands("M0 0L1e-3 2")).toEqual([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 0.001, y: 2 },
        ]);
    });

    it("stops at a token it cannot read, keeping what came before", () => {
        expect(parseCommands("M 0 0 L 5 5 $$$ L 9 9")).toEqual([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 5, y: 5 },
        ]);
    });

    it("reads run-together arc flags as flags, not as one number", () => {
        // SVG spells `0 0 1 12 6.844` as `0112 6.844`: the flags are single
        // characters. Both parsers this replaces read `0112` as the number 112
        // and put the endpoint a hundred units away — which is why every real
        // icon came out mangled.
        expect(parseCommands("M0 0A9.564 9.564 0 0112 6.844")).toEqual([
            { type: "M", x: 0, y: 0 },
            { type: "A", rx: 9.564, ry: 9.564, rotation: 0, largeArc: 0, sweep: 1, x: 12, y: 6.844 },
        ]);
    });

    it("reads separated arc flags too", () => {
        expect(parseCommands("M0 0A5 5 0 1 0 10 0")).toEqual([
            { type: "M", x: 0, y: 0 },
            { type: "A", rx: 5, ry: 5, rotation: 0, largeArc: 1, sweep: 0, x: 10, y: 0 },
        ]);
    });
});

describe("parseCommands", () => {
    it("repeats a command letter across a coordinate run", () => {
        expect(parseCommands("L 1 1 2 2")).toEqual([
            { type: "L", x: 1, y: 1 },
            { type: "L", x: 2, y: 2 },
        ]);
    });

    it("treats extra pairs after a move as implicit lines", () => {
        expect(parseCommands("M 0 0 1 1")).toEqual([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 1, y: 1 },
        ]);
        expect(parseCommands("m 0 0 1 1")).toEqual([
            { type: "m", x: 0, y: 0 },
            { type: "l", x: 1, y: 1 },
        ]);
    });

    it("keeps commands as written rather than normalizing them", () => {
        expect(parseCommands("m 1 2 h 3 z")).toEqual([
            { type: "m", x: 1, y: 2 },
            { type: "h", x: 3 },
            { type: "Z" },
        ]);
    });

    it("drops a command whose arguments run out", () => {
        expect(parseCommands("M 0 0 C 1 1 2 2")).toEqual([{ type: "M", x: 0, y: 0 }]);
    });

    it("passes a command array through untouched", () => {
        const commands = [{ type: "M", x: 1, y: 2 }] as const;
        expect(pathOps.commands([...commands])).toEqual([...commands]);
        expect(pathOps.commands(null)).toEqual([]);
        expect(pathOps.commands(undefined)).toEqual([]);
    });
});

describe("contours", () => {
    it("returns the cursor to the contour start after Z", () => {
        // Four of the seven walks skipped this, so `l 5 0` resolved against the
        // last drawn point instead of the start and the second contour landed
        // 10px off.
        const walked = contours("M 10 10 L 20 10 Z l 5 0");
        expect(walked).toHaveLength(2);
        expect(walked[0].closed).toBe(true);
        expect(walked[1].start).toEqual({ x: 10, y: 10 });
        expect(walked[1].segments[0].to).toEqual({ x: 15, y: 10 });
    });

    it("reflects S from the cubic slot and T from the quadratic slot", () => {
        // A `T` after a `C` has no *quadratic* control to mirror, so per spec its
        // control point is the cursor. The walks with a single shared slot
        // reflected the cubic's trailing control instead and bent the curve.
        const [reflected] = contours("M 0 0 C 10 10 20 10 30 0 T 60 0");
        const [explicit] = contours("M 0 0 C 10 10 20 10 30 0 Q 30 0 60 0");
        expect(reflected.segments[1].kind).toBe("quad");
        expect(segmentPointAt(reflected.segments[1], 0.5)).toEqual(segmentPointAt(explicit.segments[1], 0.5));
    });

    it("reflects T from a preceding Q", () => {
        const [contour] = contours("M 0 0 Q 10 20 20 0 T 40 0");
        // Q's control was (10,20); reflected through (20,0) gives (30,-20).
        expect(segmentPointAt(contour.segments[1], 0.5)).toEqual({ x: 30, y: -10 });
    });

    it("clears the reflection slot after a non-curve command", () => {
        // `S` after a line starts from the cursor, not from the curve before it.
        const [contour] = contours("M 0 0 C 0 10 10 10 10 0 L 20 0 S 30 10 40 0");
        expect(segmentPointAt(contour.segments[2], 0).x).toBe(20);
        expect(segmentPointAt(contour.segments[2], 0.5).y).toBeCloseTo(3.75, 5);
    });

    it("resolves relative commands against the pen", () => {
        const [contour] = contours("m 5 5 l 10 0 v 10 h -10");
        expect(contour.segments.map(s => s.to)).toEqual([
            { x: 15, y: 5 },
            { x: 15, y: 15 },
            { x: 5, y: 15 },
        ]);
    });

    it("keeps a lone move as a contour with no segments", () => {
        const walked = contours("M 3 4");
        expect(walked).toHaveLength(1);
        expect(walked[0].segments).toHaveLength(0);
        expect(walked[0].start).toEqual({ x: 3, y: 4 });
    });

    it("keeps an arc as an arc", () => {
        const [contour] = contours("M -50 0 A 50 50 0 0 1 50 0");
        expect(contour.segments[0].kind).toBe("arc");
    });

    it("degrades a zero-radius arc to a line", () => {
        const [contour] = contours("M 0 0 A 0 0 0 0 1 10 0");
        expect(contour.segments[0].kind).toBe("line");
    });
});

describe("measuring the normal form", () => {
    const SEMICIRCLE = "M -50 0 A 50 50 0 0 1 50 0";

    it("bounds an arc by its bulge, not its endpoints", () => {
        // `measurePathData` expanded only the endpoint of an `A`, so this box
        // came back 100x0 — a Path hugging arc geometry collapsed on one axis.
        // `sweep: 1` is the positive-angle direction, so in y-down space this
        // arc bulges to y = -50 and the true box is 100 x 50.
        const box = contourBounds(contours(SEMICIRCLE))!;
        expect(box.minX).toBeCloseTo(-50, 6);
        expect(box.maxX).toBeCloseTo(50, 6);
        expect(box.minY).toBeCloseTo(-50, 6);
        expect(box.maxY).toBeCloseTo(0, 6);
    });

    it("measures an arc along the arc, not across its chord", () => {
        // `calculatePathLength` returned the chord, 100 — 36% short of the truth,
        // and `applyDashPattern` scaled its dash cycle against that number while
        // walking the real curve.
        expect(measureContours(contours(SEMICIRCLE)).length).toBeCloseTo(Math.PI * 50, 0);
    });

    it("bounds a cubic by its own extrema, not its control hull", () => {
        // Control points at y=100 but the curve only reaches y=75.
        const box = contourBounds(contours("M 0 0 C 0 100 100 100 100 0"))!;
        expect(box.maxY).toBeCloseTo(75, 6);
    });

    it("counts a closed contour's join in its length", () => {
        // The triangle's third side is implied by `Z` rather than written.
        expect(measureContours(contours("M 0 0 L 30 0 L 30 40 Z")).length).toBeCloseTo(120, 6);
    });

    it("has no bounds for an empty path", () => {
        expect(contourBounds(contours(""))).toBeNull();
    });
});

describe("pathOps.bounds, size and contours, called directly", () => {
    it("bounds a lone move as the point it occupies", () => {
        expect(pathOps.bounds("M 3 4")).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
        expect(pathOps.size("M 3 4")).toEqual({ width: 0, height: 0 });
    });

    it("includes a lone move beside drawn geometry", () => {
        expect(pathOps.bounds("M 0 0 L 10 5 M 40 -20")).toEqual({ minX: 0, minY: -20, maxX: 40, maxY: 5 });
    });

    it("bounds a closed contour by its geometry, the implied closing line adding nothing", () => {
        expect(pathOps.bounds("M 0 0 L 10 0 L 10 5 Z")).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });
        expect(pathOps.size("M 0 0 L 10 0 L 10 5 Z")).toEqual({ width: 10, height: 5 });
    });

    it("starts a contour at the origin for a drawing command before any move", () => {
        const walked = pathOps.contours("L 10 5");
        expect(walked).toHaveLength(1);
        expect(walked[0].start).toEqual({ x: 0, y: 0 });
        expect(walked[0].closed).toBe(false);
        expect(walked[0].segments).toHaveLength(1);
        expect(walked[0].segments[0]).toMatchObject({ kind: "line", from: { x: 0, y: 0 }, to: { x: 10, y: 5 } });
        expect(pathOps.bounds("L 10 5")).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });
    });

    it("resolves a relative command before any move against the origin", () => {
        expect(pathOps.bounds("l 3 4 l 3 4")).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 8 });
        expect(pathOps.bounds("h 7")).toEqual({ minX: 0, minY: 0, maxX: 7, maxY: 0 });
    });

    it("keeps a drawing command after Z as a contour of its own, from the start of the closed one", () => {
        const walked = pathOps.contours("M 5 5 L 10 5 Z L 20 20");
        expect(walked).toHaveLength(2);
        expect(walked[0].closed).toBe(true);
        expect(walked[1].start).toEqual({ x: 5, y: 5 });
        expect(walked[1].closed).toBe(false);
    });

    it("has no bounds and a 0 x 0 size for an empty, blank or nullish path", () => {
        for (const d of ["", "   ", null, undefined, [] as PathCommand[]]) {
            expect(pathOps.bounds(d)).toBeNull();
            expect(pathOps.size(d)).toEqual({ width: 0, height: 0 });
            expect(pathOps.contours(d)).toEqual([]);
        }
    });

    it("reads a command list as well as a string", () => {
        const list = pathOps.commands("M 1 2 L 4 8");
        expect(pathOps.bounds(list)).toEqual(pathOps.bounds("M 1 2 L 4 8"));
        expect(pathOps.size(list)).toEqual({ width: 3, height: 6 });
    });

    it("bounds a quadratic and a cubic by their own extrema", () => {
        const quad = pathOps.bounds("M 0 0 Q 50 100 100 0")!;
        expect(quad.maxY).toBeCloseTo(50, 9);
        const cubic = pathOps.bounds("M 0 0 C 0 100 100 100 100 0")!;
        expect(cubic.maxY).toBeCloseTo(75, 9);
        expect(cubic.minY).toBe(0);
    });
});

describe("the contour memo", () => {
    // Every case uses strings no other test in the file does, and fills the memo
    // first so that nothing from an earlier case sits in the window.
    let unique = 0;
    const fresh = () => `M ${++unique} 0 L ${unique} 1`;
    const flush = () => {
        for (let i = 0; i < 40; i++) pathOps.contours(fresh());
    };

    it("hits by string value", () => {
        flush();
        const first = pathOps.contours("M 0 0 L 70001 1");
        expect(pathOps.contours("M 0 0 " + "L 70001 1")).toBe(first);
    });

    it("hits an array by reference, and misses an equal one that is a different object", () => {
        flush();
        const a = pathOps.commands("M 0 0 L 70002 1");
        const copy = [...a];
        const first = pathOps.contours(a);
        expect(pathOps.contours(a)).toBe(first);
        expect(pathOps.contours(copy)).not.toBe(first);
        expect(pathOps.contours(copy)).toEqual(first);
    });

    it("keeps a string and an equal array apart", () => {
        flush();
        const d = "M 0 0 L 70003 1";
        expect(pathOps.contours(pathOps.commands(d))).not.toBe(pathOps.contours(d));
    });

    it("holds 32 entries and evicts the oldest at the 33rd", () => {
        flush();
        const oldest = fresh();
        const first = pathOps.contours(oldest);
        const others = Array.from({ length: 31 }, fresh);
        const held = others.map((d) => pathOps.contours(d));
        // The oldest and 31 more: 32 entries, so all of them are still held.
        expect(pathOps.contours(oldest)).toBe(first);
        expect(pathOps.contours(others[0])).toBe(held[0]);
        expect(pathOps.contours(others[30])).toBe(held[30]);

        // A 33rd entry pushes the oldest out; the next call walks it again.
        pathOps.contours(fresh());
        const again = pathOps.contours(oldest);
        expect(again).not.toBe(first);
        expect(again).toEqual(first);
    });

    it("evicts in insertion order, not by use", () => {
        flush();
        const oldest = fresh();
        const first = pathOps.contours(oldest);
        const rest = Array.from({ length: 31 }, fresh);
        for (const d of rest) pathOps.contours(d);
        // Reading the oldest again does not refresh it.
        expect(pathOps.contours(oldest)).toBe(first);
        pathOps.contours(fresh());
        expect(pathOps.contours(oldest)).not.toBe(first);
    });

    it("does not memoize nullish input, which has nothing to walk", () => {
        expect(pathOps.contours(null)).toEqual([]);
        expect(pathOps.contours(undefined)).toEqual([]);
        expect(pathOps.contours(null)).not.toBe(pathOps.contours(null));
    });
});

describe("arc radii", () => {
    it("takes the magnitude of a negative radius", () => {
        const positive = "M -50 0 A 50 50 0 0 1 50 0";
        const negative = "M -50 0 A -50 -50 0 0 1 50 0";
        expect(pathOps.bounds(negative)).toEqual(pathOps.bounds(positive));
        expect(pathOps.length(negative)).toBeCloseTo(pathOps.length(positive), 9);
        expect(pathOps.bounds(negative)!.minY).toBeCloseTo(-50, 6);
    });

    it("treats one negative radius like its magnitude", () => {
        expect(pathOps.bounds("M -50 0 A -50 50 0 0 1 50 0")).toEqual(pathOps.bounds("M -50 0 A 50 50 0 0 1 50 0"));
    });

    it("scales a radius up until the endpoints are reachable", () => {
        // 100 apart with a radius of 10: the only ellipse that reaches is the semicircle of radius 50.
        const box = pathOps.bounds("M 0 0 A 10 10 0 0 1 100 0")!;
        expect(box.minX).toBeCloseTo(0, 6);
        expect(box.maxX).toBeCloseTo(100, 6);
        expect(box.minY).toBeCloseTo(-50, 6);
        expect(box.maxY).toBeCloseTo(0, 6);
        expect(pathOps.length("M 0 0 A 10 10 0 0 1 100 0")).toBeCloseTo(Math.PI * 50, 0);
    });

    it("scales both radii by the same factor, keeping the ellipse's proportions", () => {
        // rx : ry = 2 : 1, scaled until a semi-ellipse spans the 100 chord: 50 x 25.
        const box = pathOps.bounds("M 0 0 A 4 2 0 0 1 100 0")!;
        expect(box.minY).toBeCloseTo(-25, 6);
        expect(box.maxX).toBeCloseTo(100, 6);
    });

    it("leaves a radius that already reaches alone", () => {
        // Radius 100 over a chord of 100: a minor arc, not a scaled-up semicircle.
        const box = pathOps.bounds("M 0 0 A 100 100 0 0 1 100 0")!;
        expect(box.maxX).toBeCloseTo(100, 6);
        expect(box.minY).toBeCloseTo(-(100 - Math.sqrt(100 * 100 - 50 * 50)), 6);
    });

    it("bounds a rotated ellipse by its own extent, not by its endpoints", () => {
        // An ellipse of 50 x 20 tilted 45 degrees, drawn as two half arcs through its major-axis ends.
        // Its box is +-sqrt((50^2 + 20^2) / 2) = +-38.08 on both axes, wider than the +-35.36 of the endpoints.
        const tip = 50 * Math.SQRT1_2;
        const box = pathOps.bounds(
            `M ${tip} ${tip} A 50 20 45 0 1 ${-tip} ${-tip} A 50 20 45 0 1 ${tip} ${tip}`,
        )!;
        const half = Math.sqrt((50 * 50 + 20 * 20) / 2);
        expect(box.maxX).toBeCloseTo(half, 4);
        expect(box.minX).toBeCloseTo(-half, 4);
        expect(box.maxY).toBeCloseTo(half, 4);
        expect(box.minY).toBeCloseTo(-half, 4);
        expect(half).toBeGreaterThan(tip);
    });

    it("bounds a half ellipse turned a quarter by its rotation like the unturned one swapped", () => {
        const turned = pathOps.bounds("M 0 -25 A 50 25 90 0 1 0 25")!;
        const plain = pathOps.bounds("M 0 -25 A 25 50 0 0 1 0 25")!;
        expect(turned.minX).toBeCloseTo(plain.minX, 6);
        expect(turned.maxX).toBeCloseTo(plain.maxX, 6);
        expect(turned.minY).toBeCloseTo(plain.minY, 6);
        expect(turned.maxY).toBeCloseTo(plain.maxY, 6);
    });

    it("measures a scaled-up arc along the arc", () => {
        expect(pathOps.length("M 0 0 A 1 1 0 1 1 100 0")).toBeCloseTo(Math.PI * 50, 0);
    });
});
