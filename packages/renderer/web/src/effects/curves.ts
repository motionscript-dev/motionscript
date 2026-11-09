import { Effects, type CurvesEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

// The engine's resampling: the curve as
// 33 evenly spaced outputs over 0–1.
const SEGMENTS = 32;

function evalCurve(points: [number, number][], x: number): number {
    if (points.length === 0) return x;
    if (x <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 0; i < points.length - 1; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[i + 1];
        if (x >= x0 && x <= x1) return y0 + (y1 - y0) * (x1 === x0 ? 0 : (x - x0) / (x1 - x0));
    }
    return x;
}

function ramp(points: [number, number][]): number[] {
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    const out: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
        const y = evalCurve(sorted, i / SEGMENTS);
        out.push(Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : i / SEGMENTS);
    }
    return out;
}

const MASKS: Record<string, number[]> = { r: [1, 0, 0, 0], g: [0, 1, 0, 0], b: [0, 0, 1, 0], a: [0, 0, 0, 1] };

export default definePort<CurvesEffect, { values: number[] }>({
    type: "curves",
    surface: "shader",
    params: {
        mask: { type: "vec4f", uses: ["channel"], value: (e) => MASKS[e.channel ?? "rgb"] ?? [1, 1, 1, 0] },
        curve: { type: { array: SEGMENTS + 1, of: "f32" }, uses: ["points"], value: (_e, c) => c.values },
    },
    prepare(e) {
        const values = ramp(e.points ?? []);
        return values.every((y, i) => Math.abs(y - i / SEGMENTS) < 1e-4) ? null : { values };
    },
    cases: () => [
        Effects.curves({ points: [[0, 0], [0.25, 0.15], [0.75, 0.88], [1, 1]] }).list[0],
        Effects.curves({ points: [[0, 0.2], [0.5, 0.7], [1, 1]], channel: "r" }).list[0],
        Effects.curves({ points: [[0, 0], [0.6, 0.3], [1, 0.8]], channel: "a" }).list[0],
    ],
});
