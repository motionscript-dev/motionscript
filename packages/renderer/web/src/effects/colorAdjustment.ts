import { Effects, type ColorAdjustmentEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

// The engine's composition.
const LR = 0.2126, LG = 0.7152, LB = 0.0722;

// outer × inner, both 4×5 with an implicit last row [0,0,0,0,1].
function multiply(outer: number[], inner: number[]): number[] {
    const out = new Array(20).fill(0);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 5; j++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += outer[i * 5 + k] * inner[k * 5 + j];
            if (j === 4) sum += outer[i * 5 + 4];
            out[i * 5 + j] = sum;
        }
    }
    return out;
}

const diag = (s: number, o: number) => [s, 0, 0, 0, o, 0, s, 0, 0, o, 0, 0, s, 0, o, 0, 0, 0, 1, 0];
const offsets = (r: number, g: number, b: number) => [1, 0, 0, 0, r, 0, 1, 0, 0, g, 0, 0, 1, 0, b, 0, 0, 0, 1, 0];

function saturation(s: number): number[] {
    const i = 1 - s;
    return [
        s + i * LR, i * LG, i * LB, 0, 0,
        i * LR, s + i * LG, i * LB, 0, 0,
        i * LR, i * LG, s + i * LB, 0, 0,
        0, 0, 0, 1, 0,
    ];
}

function hue(deg: number): number[] {
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    return [
        LR + c * (1 - LR) + s * -LR, LG + c * -LG + s * -LG, LB + c * -LB + s * (1 - LB), 0, 0,
        LR + c * -LR + s * 0.143, LG + c * (1 - LG) + s * 0.140, LB + c * -LB + s * -0.283, 0, 0,
        LR + c * -LR + s * -(1 - LR), LG + c * -LG + s * LG, LB + c * (1 - LB) + s * LB, 0, 0,
        0, 0, 0, 1, 0,
    ];
}

export default definePort<ColorAdjustmentEffect, { matrix: number[] }>({
    type: "colorAdjustment",
    surface: "filter",
    params: {
        matrix: {
            type: { array: 20, of: "f32" },
            uses: ["brightness", "contrast", "saturation", "hue", "vibrance", "temperature", "tint", "shadows", "highlights"],
            value: (_e, c) => c.matrix,
        },
    },
    prepare(e) {
        let mat = diag(1, 0);
        let any = false;
        const apply = (m: number[]) => { mat = multiply(m, mat); any = true; };
        const b = e.brightness ?? 0;
        if (b !== 0) apply(diag(1, b));
        const c = e.contrast ?? 1;
        if (c !== 1) apply(diag(c, 0.5 * (1 - c)));
        const s = e.saturation ?? 1;
        if (s !== 1) apply(saturation(s));
        const h = ((e.hue ?? 0) % 360 + 360) % 360;
        if (h !== 0) apply(hue(h));
        const v = e.vibrance ?? 0;
        if (v !== 0) apply(saturation(1 + v * 0.7));
        const t = e.temperature ?? 0;
        if (t !== 0) apply(offsets(t * 0.1, 0, -t * 0.1));
        const ti = e.tint ?? 0;
        if (ti !== 0) apply(offsets(ti * 0.05, -ti * 0.1, ti * 0.05));
        const sh = e.shadows ?? 0;
        if (sh !== 0) apply(diag(1 - 0.2 * sh, 0.2 * sh));
        const hi = e.highlights ?? 0;
        if (hi !== 0) apply(diag(1 + 0.2 * hi, -0.1 * hi));
        return any ? { matrix: mat } : null;
    },
    cases: () => [
        Effects.colorAdjustment({ brightness: 0.1, contrast: 1.3, saturation: 1.4 }).list[0],
        Effects.colorAdjustment({ hue: 120, vibrance: 0.5 }).list[0],
        Effects.colorAdjustment({ temperature: 0.6, tint: -0.4, shadows: 0.5, highlights: -0.5 }).list[0],
        Effects.colorAdjustment({ contrast: 0.6, saturation: 0 }).list[0],
    ],
});
