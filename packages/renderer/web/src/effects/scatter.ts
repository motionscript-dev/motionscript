import { Effects, resolveEffectAxis, type ScatterEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<ScatterEffect>({
    type: "scatter",
    surface: "shader",
    params: {
        offset: {
            type: "vec2f",
            uses: ["strength", "axis"],
            value(e) {
                const axis = resolveEffectAxis(e.axis);
                return [e.strength * axis.x, e.strength * axis.y];
            },
        },
    },
    prepare: (e) => (e.strength > 0 ? {} : null),
    extras(e) {
        const axis = resolveEffectAxis(e.axis);
        return { reach: e.strength * Math.max(Math.abs(axis.x), Math.abs(axis.y)) };
    },
    cases: () => [
        Effects.scatter().list[0],
        Effects.scatter({ strength: 24, axis: "x" }).list[0],
        Effects.scatter({ strength: 6, axis: "y" }).list[0],
    ],
});
