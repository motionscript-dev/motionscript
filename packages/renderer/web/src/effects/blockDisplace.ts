import { Effects, resolveEffectAxis, type BlockDisplaceEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<BlockDisplaceEffect>({
    type: "blockDisplace",
    surface: "shader",
    params: { amount: "param", size: "param", density: "param", seed: "param", axis: "param" },
    prepare(e) {
        if (!(e.amount > 0) || !(e.density > 0)) return null;
        const axis = resolveEffectAxis(e.axis);
        return axis.x === 0 && axis.y === 0 ? null : {};
    },
    extras(e) {
        const axis = resolveEffectAxis(e.axis);
        return { reach: e.amount * Math.max(Math.abs(axis.x), Math.abs(axis.y)) };
    },
    cases: () => [
        Effects.blockDisplace().list[0],
        Effects.blockDisplace({ amount: 40, size: 10, density: 0.6, seed: 3 }).list[0],
        Effects.blockDisplace({ amount: 30, size: 24, axis: "y", seed: 1 }).list[0],
    ],
});
