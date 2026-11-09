import { Effects, type SharpenEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<SharpenEffect>({
    type: "sharpen",
    surface: "shader",
    params: { amount: "param", radius: { type: "f32", value: (e) => Math.max(e.radius, 0) } },
    prepare: (e) => (e.amount === 0 ? null : {}),
    cases: () => [
        Effects.sharpen().list[0],
        Effects.sharpen({ amount: 2.5, radius: 3 }).list[0],
    ],
});
