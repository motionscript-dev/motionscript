import { Effects, type VintageEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<VintageEffect>({
    type: "vintage",
    surface: "filter",
    params: {
        // The engine's 4×5 matrix.
        matrix: {
            type: { array: 20, of: "f32" },
            uses: ["amount", "warmth"],
            value(e) {
                const a = Math.max(0, Math.min(1, e.amount));
                const w = Math.max(-1, Math.min(1, e.warmth));
                const lerp = (identity: number, sepia: number) => identity + (sepia - identity) * a;
                const warmR = w > 0 ? w * 0.15 : 0;
                const warmB = w < 0 ? -w * 0.15 : 0;
                const coolR = w < 0 ? -w * 0.05 : 0;
                const coolB = w > 0 ? w * 0.05 : 0;
                return [
                    lerp(1, 0.393), lerp(0, 0.769), lerp(0, 0.189), 0, warmR - coolR,
                    lerp(0, 0.349), lerp(1, 0.686), lerp(0, 0.168), 0, 0,
                    lerp(0, 0.272), lerp(0, 0.534), lerp(1, 0.131), 0, -warmB + coolB,
                    0, 0, 0, 1, 0,
                ];
            },
        },
    },
    prepare: (e) => (e.amount <= 0 && e.warmth === 0 ? null : {}),
    cases: () => [
        Effects.vintage().list[0],
        Effects.vintage({ amount: 0.5, warmth: -0.8 }).list[0],
        Effects.vintage({ amount: 0, warmth: 1 }).list[0],
    ],
});
