import { Effects, type BitCrushEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

// The engine's hardware palettes.
const PALETTES: Record<string, readonly string[]> = {
    gameboy: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
    cga: ["#000000", "#55ffff", "#ff55ff", "#ffffff"],
    nes: [
        "#000000", "#fcfcfc", "#bcbcbc", "#7c7c7c",
        "#0000fc", "#0078f8", "#3cbcfc", "#a4e4fc",
        "#b8f818", "#00b800", "#005800", "#f83800",
        "#e40058", "#f878f8", "#f8b800", "#503000",
    ],
};

// The engine bakes each channel as a 4-decimal literal.
const channels = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [16, 8, 0].map((s) => Number((((n >> s) & 0xff) / 255).toFixed(4)));
};

export default definePort<BitCrushEffect, { palette: readonly string[] }>({
    type: "bitCrush",
    surface: "shader",
    params: {
        bits: "param",
        amount: "param",
        count: { type: "f32", uses: ["palette"], value: (_e, c) => c.palette.length },
        palette: { type: { array: 16, of: "vec3f" }, value: (_e, c) => c.palette.flatMap(channels) },
    },
    prepare(e) {
        if (!(e.amount > 0)) return null;
        if (e.palette === "none" && e.bits >= 8) return null;
        return { palette: e.palette === "none" ? [] : PALETTES[e.palette] };
    },
    cases: () => [
        Effects.bitCrush().list[0],
        Effects.bitCrush({ palette: "gameboy" }).list[0],
        Effects.bitCrush({ palette: "nes", amount: 0.7 }).list[0],
        Effects.bitCrush({ palette: "cga" }).list[0],
    ],
});
