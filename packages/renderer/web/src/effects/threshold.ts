import { Effects, type ThresholdEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<ThresholdEffect>({
    type: "threshold",
    surface: "shader",
    params: { level: "param", smoothness: "param" },
    cases: () => [
        Effects.threshold().list[0],
        Effects.threshold({ level: 0.3, smoothness: 0 }).list[0],
        Effects.threshold({ level: 0.6, smoothness: 0.4 }).list[0],
    ],
});
