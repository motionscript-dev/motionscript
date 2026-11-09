import { Effects, resolveEffectColor, type VignetteEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<VignetteEffect>({
    type: "vignette",
    surface: "shader",
    params: { color: "param", amount: "param", radius: "param", softness: "param" },
    prepare: (e) => (e.amount <= 0 || resolveEffectColor(e.color)[3] <= 0 ? null : {}),
    cases: () => [
        Effects.vignette().list[0],
        Effects.vignette({ amount: 0.9, radius: 0.4, softness: 0.3 }).list[0],
        Effects.vignette({ amount: 0.7, color: "#ff8800", radius: 0.6, softness: 0.8 }).list[0],
    ],
});
