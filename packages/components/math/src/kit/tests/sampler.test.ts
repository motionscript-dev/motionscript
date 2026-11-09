import { describe, expect, it } from "vitest";
import type { Extents, Vector2 } from "@motionscript/sdk";
import { sampleCurve, type CurveProjection } from "../sampler";

const CLIP: Extents = { minX: -400, minY: -200, maxX: 400, maxY: 200 };

/** `y = f(x)` over x in [-4, 4], at 100 px a unit. */
function graph(f: (x: number) => number): CurveProjection {
    return (u, out) => {
        const x = -4 + 8 * u;
        const y = f(x);
        if (!Number.isFinite(y)) return false;
        out.x = x * 100;
        out.y = y * 100;
        return true;
    };
}

const sample = (f: (x: number) => number) => sampleCurve(graph(f), 0, 1, CLIP, { seeds: 100, minStep: 0.5 / 800 });

function tallest(runs: Vector2[][]): number {
    let jump = 0;
    for (const run of runs) {
        for (let i = 1; i < run.length; i++) jump = Math.max(jump, Math.abs(run[i].y - run[i - 1].y));
    }
    return jump;
}

describe("sampling a curve", () => {
    it("draws a straight line as one run of very few points", () => {
        const runs = sample((x) => x / 4);
        expect(runs).toHaveLength(1);
        expect(runs[0][0]).toEqual({ x: -400, y: -100 });
        expect(runs[0].at(-1)).toEqual({ x: 400, y: 100 });
    });

    it("spends its points on the bends", () => {
        const [run] = sample((x) => Math.sin(4 * x));
        const far = run.filter((p) => Math.abs(p.x) > 300).length;
        expect(run.length).toBeGreaterThan(200);
        expect(far).toBeGreaterThan(20);
        for (const p of run) expect(Math.abs(p.y - Math.sin((4 * p.x) / 100) * 100)).toBeLessThan(0.5);
    });

    it("breaks at an asymptote instead of drawing a line through it", () => {
        const runs = sample((x) => 1 / x);
        expect(runs).toHaveLength(2);
        // No segment crosses the frame from bottom to top.
        expect(tallest(runs)).toBeLessThan(200);
        expect(runs[0].at(-1)!.x).toBeLessThan(0);
        expect(runs[1][0].x).toBeGreaterThan(0);
    });

    it("breaks every period of tan", () => {
        const runs = sample(Math.tan);
        expect(runs.length).toBeGreaterThanOrEqual(3);
        expect(tallest(runs)).toBeLessThan(200);
    });

    it("keeps a steep line that really does cross the frame", () => {
        const runs = sample((x) => 50 * x);
        expect(runs).toHaveLength(1);
        expect(runs[0][0].y).toBe(-200);
        expect(runs[0].at(-1)!.y).toBe(200);
    });

    it("stops where the curve's domain does", () => {
        const [run, ...rest] = sample(Math.sqrt);
        expect(rest).toHaveLength(0);
        expect(Math.abs(run[0].x)).toBeLessThan(1);
        expect(Math.abs(run[0].y)).toBeLessThan(5);
    });

    it("clips to the frame, and is empty off it", () => {
        for (const run of sample((x) => x * x)) {
            for (const p of run) expect(p.y).toBeLessThanOrEqual(200);
        }
        expect(sample(() => 50)).toEqual([]);
    });

    it("draws nothing for an empty or backwards range", () => {
        expect(sampleCurve(graph((x) => x), 1, 1, CLIP)).toEqual([]);
        expect(sampleCurve(graph((x) => x), 1, 0, CLIP)).toEqual([]);
    });
});
