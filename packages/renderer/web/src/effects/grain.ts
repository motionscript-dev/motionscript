import { Effects, type GrainEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<GrainEffect>({
    type: "grain",
    surface: "shader",
    // `animated` folds floor(time * 1000) into the seed; the harness renders at t = 0.
    params: { amount: "param", size: "param", seed: "param", colored: "param", animated: "param" },
    prepare: (e) => (e.amount > 0 ? {} : null),
    cases: () => [
        Effects.grain().list[0],
        Effects.grain({ amount: 0.5, size: 3, seed: 7, colored: true }).list[0],
        Effects.grain({ amount: 0.15, size: 2 }).list[0],
    ],
});
