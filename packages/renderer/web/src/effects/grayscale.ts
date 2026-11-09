import { Effects, type GrayscaleEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

const LR = 0.2126, LG = 0.7152, LB = 0.0722;

export default definePort<GrayscaleEffect>({
    type: "grayscale",
    surface: "filter",
    params: {
        // The engine's 4×5 matrix.
        matrix: {
            type: { array: 20, of: "f32" },
            uses: ["amount"],
            value(e) {
                const a = Math.max(0, Math.min(1, e.amount));
                return [
                    1 - a + a * LR, a * LG, a * LB, 0, 0,
                    a * LR, 1 - a + a * LG, a * LB, 0, 0,
                    a * LR, a * LG, 1 - a + a * LB, 0, 0,
                    0, 0, 0, 1, 0,
                ];
            },
        },
    },
    cases: () => [Effects.grayscale(1).list[0], Effects.grayscale(0.5).list[0]],
});
