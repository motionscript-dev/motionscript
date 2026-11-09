import { Effects, resolveEffectColor, type DuotoneEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

const LR = 0.2126, LG = 0.7152, LB = 0.0722;

export default definePort<DuotoneEffect>({
    type: "duotone",
    surface: "filter",
    params: {
        // The engine's duotone matrix.
        matrix: {
            type: { array: 20, of: "f32" },
            uses: ["amount", "shadows", "highlights"],
            value(e) {
                const a = Math.max(0, Math.min(1, e.amount));
                const shadows = resolveEffectColor(e.shadows);
                const highlights = resolveEffectColor(e.highlights);
                const row = (i: number) => {
                    const d = (highlights[i] - shadows[i]) * a;
                    const r = [d * LR, d * LG, d * LB, 0, shadows[i] * a];
                    r[i] += 1 - a;
                    return r;
                };
                return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0];
            },
        },
    },
    prepare: (e) => (e.amount <= 0 ? null : {}),
    cases: () => [
        Effects.duotone().list[0],
        Effects.duotone({ shadows: "#1a0b3d", highlights: "#ffcc66" }).list[0],
        Effects.duotone({ amount: 0.5, shadows: "#003344", highlights: "#ff6699" }).list[0],
    ],
});
