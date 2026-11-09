import { Effects, resolveEffectColor, type OutlineEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

const POSITION = { outside: 0, inside: 1, center: 2 };

export default definePort<OutlineEffect, { position: number }>({
    type: "outline",
    surface: "shader",
    params: {
        width: "param",
        position: { type: "f32", value: (_e, c) => c.position },
        color: "param",
    },
    prepare(e) {
        if (!(e.width > 0) || resolveEffectColor(e.color)[3] <= 0) return null;
        return { position: POSITION[e.position] ?? 0 };
    },
    extras: (e, c) => ({ reach: c.position === 1 ? 0 : c.position === 2 ? e.width / 2 : e.width }),
    cases: () => [
        Effects.outline().list[0],
        Effects.outline({ width: 8, color: "#f80", position: "inside" }).list[0],
        Effects.outline({ width: 6, color: "#0cf", position: "center" }).list[0],
    ],
});
