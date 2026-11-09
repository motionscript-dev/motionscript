import { Effects, type ScanlinesEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<ScanlinesEffect>({
    type: "scanlines",
    surface: "shader",
    params: {
        spacing: "param",
        thickness: "param",
        darkness: "param",
        offset: "param",
        direction: {
            type: "vec2f",
            uses: ["angle"],
            value(e) {
                const r = (e.angle * Math.PI) / 180;
                return [Math.cos(r), Math.sin(r)];
            },
        },
    },
    prepare: (e) => (e.darkness > 0 ? {} : null),
    cases: () => [
        Effects.scanlines().list[0],
        Effects.scanlines({ spacing: 7, thickness: 0.3, darkness: 0.8, offset: 2, angle: 30 }).list[0],
        Effects.scanlines({ spacing: 5, thickness: 0.7, angle: 90 }).list[0],
    ],
});
