import { describe, expect, it } from "vitest";

import { comp, evaluatorFor, node, project, track } from "@/runtime/document.fixtures";
import type { Node2D } from "@/components/trees/2d/node2d";

import { curveEase, curveSegments, isEaseCurve, type CurvePoint } from "../ease/curve";
import { validateDocument } from "@/document/validate";

const LINE: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

/** Bowed above the line: an ease-out drawn by hand, with one dragged handle. */
const BOWED: CurvePoint[] = [{ x: 0, y: 0, out: { x: 0.1, y: 0.8 } }, { x: 1, y: 1 }];

describe("curveEase", () => {
    it("runs a two-point line as constant speed", () => {
        const ease = curveEase(LINE);
        for (const x of [0, 0.25, 0.5, 0.75, 1]) expect(ease(x)).toBeCloseTo(x, 6);
    });

    it("pins the ends and follows a dragged handle", () => {
        const ease = curveEase(BOWED);
        expect(ease(0)).toBe(0);
        expect(ease(1)).toBe(1);
        expect(ease(0.5)).toBeGreaterThan(0.5);
        // Monotone in x whatever the handle does, so it stays a function of time.
        for (let i = 1; i <= 20; i++) expect(ease(i / 20)).toBeGreaterThanOrEqual(ease((i - 1) / 20));
    });

    it("keeps a control point inside its own segment's x span", () => {
        const [segment] = curveSegments([{ x: 0, y: 0, out: { x: 5, y: 0 } }, { x: 1, y: 1 }]);
        expect(segment.c1.x).toBe(1);
    });

    it("tells a curve from a registry key", () => {
        expect(isEaseCurve(LINE)).toBe(true);
        expect(isEaseCurve("wobble")).toBe(false);
        expect(isEaseCurve([{ x: 0, y: 0 }])).toBe(false);
        expect(isEaseCurve([{ x: 0, y: Number.NaN }, { x: 1, y: 1 }])).toBe(false);
    });
});

describe("a custom ease carrying its curve", () => {
    const clip = (args: unknown) => comp(
        [node("r", "rect", { width: 10, height: 10 })],
        [{ target: "r", args: { x: 100 }, duration: 1, easing: { kind: "custom", args: args as CurvePoint[] } }],
    );

    it("validates, and a malformed one names the args", () => {
        expect(validateDocument(clip(BOWED)).issues).toEqual([]);
        expect(validateDocument(clip([{ x: 0 }])).issues.map((i) => i.path)).toEqual(["commands[0].easing.args"]);
    });

    it("plays through the drawn curve, with no registration", () => {
        const evaluator = evaluatorFor(project([track("t", clip(BOWED))]));
        evaluator.stateAt(5);
        const rect = evaluator.currentCanvas!.children[0] as Node2D;
        expect(rect.x).toBeCloseTo(curveEase(BOWED)(0.5) * 100, 3);
        expect(rect.x).toBeGreaterThan(50);
    });
});

/** Rises to 1 at the midpoint, overshoots, and settles back to 1. */
const THREE: CurvePoint[] = [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }];

describe("auto handles", () => {
    it("steer a segment by the Catmull-Rom tangent, a sixth of the neighbours' span", () => {
        const [segment] = curveSegments(LINE);
        expect(segment.c1.x).toBeCloseTo(1 / 6, 12);
        expect(segment.c1.y).toBeCloseTo(1 / 6, 12);
        expect(segment.c2.x).toBeCloseTo(5 / 6, 12);
        expect(segment.c2.y).toBeCloseTo(5 / 6, 12);
    });

    it("leave a two-point curve exactly linear", () => {
        const ease = curveEase(LINE);
        for (const x of [0.1, 0.3, 0.9]) expect(ease(x)).toBeCloseTo(x, 6);
    });

    it("use the neighbour on each side where there is one, and the point itself at the ends", () => {
        const [first, second] = curveSegments(THREE);
        expect(first.c1).toEqual({ x: 0.5 / 6, y: 1 / 6 });
        expect(first.c2.x).toBeCloseTo(0.5 - 1 / 6, 12);
        expect(first.c2.y).toBeCloseTo(1 - 1 / 6, 12);
        expect(second.c1.x).toBeCloseTo(0.5 + 1 / 6, 12);
        expect(second.c1.y).toBeCloseTo(1 + 1 / 6, 12);
        expect(second.c2.x).toBeCloseTo(1 - 0.5 / 6, 12);
        expect(second.c2.y).toBe(1);
    });

    it("lose to an explicit handle, which is an offset from its own point", () => {
        const [segment] = curveSegments([
            { x: 0, y: 0, out: { x: 0.25, y: 0.5 } },
            { x: 1, y: 1, in: { x: -0.25, y: 0 } },
        ]);
        expect(segment.c1).toEqual({ x: 0.25, y: 0.5 });
        expect(segment.c2).toEqual({ x: 0.75, y: 1 });
    });
});

describe("a curve of several segments", () => {
    it("makes one Bezier segment per pair of points", () => {
        expect(curveSegments(THREE)).toHaveLength(2);
        expect(curveSegments([...THREE, { x: 1.5, y: 1 }])).toHaveLength(3);
    });

    it("passes through its interior points", () => {
        const ease = curveEase(THREE);
        expect(ease(0.5)).toBeCloseTo(1, 6);
    });

    it("follows each segment's own shape between them", () => {
        const ease = curveEase(THREE);
        // Pinned from the curve above: the numbers are a regression guard, not a derivation.
        expect(ease(0.1)).toBeCloseTo(0.226943607, 6);
        expect(ease(0.25)).toBeCloseTo(0.568531669, 6);
        expect(ease(0.75)).toBeCloseTo(1.068531670, 6);
        expect(ease(0.9)).toBeCloseTo(1.026943607, 6);
    });

    it("pins both ends, outside [0, 1] too", () => {
        const ease = curveEase(THREE);
        expect(ease(-1)).toBe(0);
        expect(ease(0)).toBe(0);
        expect(ease(1)).toBe(1);
        expect(ease(2)).toBe(1);
    });
});

describe("overshoot in y", () => {
    const OVERSHOOT: CurvePoint[] = [{ x: 0, y: 0, out: { x: 0.3, y: 1.5 } }, { x: 1, y: 1 }];

    it("is not clamped, so a move can pass its target and settle back", () => {
        const ease = curveEase(OVERSHOOT);
        const samples = Array.from({ length: 21 }, (_, i) => ease(i / 20));
        expect(Math.max(...samples)).toBeGreaterThan(1);
        expect(ease(0.7)).toBeCloseTo(1.004696371, 6);
        expect(ease(1)).toBe(1);
    });

    it("keeps the handle's y while clamping its x into the segment", () => {
        const [segment] = curveSegments([{ x: 0, y: 0, out: { x: 5, y: 3 } }, { x: 1, y: 1 }]);
        expect(segment.c1).toEqual({ x: 1, y: 3 });
    });
});

describe("a curve too short to draw", () => {
    it("has no segments for fewer than two points", () => {
        expect(curveSegments([])).toEqual([]);
        expect(curveSegments([{ x: 0, y: 0 }])).toEqual([]);
    });

    it("eases as the identity", () => {
        expect(curveEase([])(0.3)).toBe(0.3);
        expect(curveEase([{ x: 0, y: 0 }])(0.8)).toBe(0.8);
    });

    it("is not a curve a document may carry", () => {
        expect(isEaseCurve([])).toBe(false);
        expect(isEaseCurve([{ x: 0, y: 0 }])).toBe(false);
    });
});

describe("curve invariants", () => {
    // Only the points are checked for finiteness, so a NaN handle is a
    // "curve" whose every sample is NaN; and x is not required to ascend.
    it.todo("rejects a curve with a non-finite handle");
    it.todo("rejects points whose x does not ascend");
});
