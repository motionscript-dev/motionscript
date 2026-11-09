import { Effects, type RgbShiftEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<RgbShiftEffect>({
    type: "rgbShift",
    surface: "shader",
    params: { red: "param", green: "param", blue: "param" },
    prepare(e) {
        const { red, green, blue } = e;
        return !red.x && !red.y && !green.x && !green.y && !blue.x && !blue.y ? null : {};
    },
    extras: ({ red, green, blue }) => ({
        reach: Math.max(Math.abs(red.x), Math.abs(red.y), Math.abs(green.x), Math.abs(green.y), Math.abs(blue.x), Math.abs(blue.y)),
    }),
    cases: () => [
        Effects.rgbShift().list[0],
        Effects.rgbShift({ amount: 12 }).list[0],
        Effects.rgbShift({ red: { x: 6, y: -4 }, green: { x: -3, y: 5 }, blue: { x: 0, y: 9 } }).list[0],
    ],
});
