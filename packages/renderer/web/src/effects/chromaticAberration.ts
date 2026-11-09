import { Effects, type ChromaticAberrationEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

// The engine's ghost matrices.
const RED = [1.4, -0.2, -0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
const BLUE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.2, -0.2, 1.4, 0, 0, 0, 0, 0, 1, 0];

export default definePort<ChromaticAberrationEffect>({
    type: "chromaticAberration",
    surface: "filter",
    params: {
        red: { type: { array: 20, of: "f32" }, value: () => RED },
        blue: { type: { array: 20, of: "f32" }, value: () => BLUE },
        offset: {
            type: "vec2f",
            uses: ["amount", "angle"],
            value(e) {
                const rad = (e.angle * Math.PI) / 180;
                return [Math.cos(rad) * e.amount, Math.sin(rad) * e.amount];
            },
        },
    },
    prepare: (e) => (e.amount <= 0 ? null : {}),
    extras: (e) => ({ reach: e.amount }),
    cases: () => [
        Effects.chromaticAberration().list[0],
        Effects.chromaticAberration({ amount: 8, angle: 45 }).list[0],
        Effects.chromaticAberration({ amount: 2.5, angle: 200 }).list[0],
    ],
});
