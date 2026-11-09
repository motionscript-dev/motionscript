import { Effects, type InvertEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

const LR = 0.2126, LG = 0.7152, LB = 0.0722;
const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

// The engine's fully inverted matrix per channel.
function fullMatrix(channel: InvertEffect["channel"]): number[] {
    switch (channel) {
        case "red": return [-1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
        case "green": return [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
        case "blue": return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0];
        case "alpha": return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 1];
        case "hue": return [
            2 * LR - 1, 2 * LG, 2 * LB, 0, 0,
            2 * LR, 2 * LG - 1, 2 * LB, 0, 0,
            2 * LR, 2 * LG, 2 * LB - 1, 0, 0,
            0, 0, 0, 1, 0,
        ];
        case "luminance": return [
            1 - 2 * LR, -2 * LG, -2 * LB, 0, 1,
            -2 * LR, 1 - 2 * LG, -2 * LB, 0, 1,
            -2 * LR, -2 * LG, 1 - 2 * LB, 0, 1,
            0, 0, 0, 1, 0,
        ];
        default: return [-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0];
    }
}

export default definePort<InvertEffect, { matrix: number[] }>({
    type: "invert",
    surface: "filter",
    params: {
        matrix: { type: { array: 20, of: "f32" }, uses: ["channel", "strength"], value: (_e, c) => c.matrix },
    },
    prepare(e) {
        const s = Math.max(0, Math.min(1, e.strength));
        if (s === 0) return null;
        const target = fullMatrix(e.channel);
        return { matrix: IDENTITY.map((v, i) => v + (target[i] - v) * s) };
    },
    // An alpha invert turns transparent black opaque everywhere it is drawn,
    // not just over the content: reach
    // far enough to cover the canvas.
    extras: (_e, c) => (c.matrix[19] > 0 ? { reach: 4096 } : {}),
    cases: () => [
        Effects.invert().list[0],
        Effects.invert({ channel: "hue", strength: 0.7 }).list[0],
        Effects.invert({ channel: "luminance" }).list[0],
        Effects.invert({ channel: "alpha", strength: 0.5 }).list[0],
    ],
});
