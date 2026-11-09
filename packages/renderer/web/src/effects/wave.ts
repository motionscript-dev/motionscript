import { Effects, type WaveEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<WaveEffect>({
    type: "wave",
    surface: "shader",
    params: {
        amplitude: "param",
        wavelength: { type: "f32", value: (e) => Math.max(e.wavelength, 0.01) },
        phase: { type: "f32", value: (e) => (((e.phase % 360) + 360) % 360) * Math.PI / 180 },
        direction: {
            type: "vec2f",
            uses: ["angle"],
            value(e) {
                const radians = (e.angle * Math.PI) / 180;
                return [Math.cos(radians), Math.sin(radians)];
            },
        },
        shape: "param",
        center: "param",
    },
    prepare: (e) => (e.amplitude.x === 0 && e.amplitude.y === 0 ? null : {}),
    extras: (e) => ({ reach: Math.max(Math.abs(e.amplitude.x), Math.abs(e.amplitude.y)) }),
    cases: () => [
        Effects.wave().list[0],
        Effects.wave({ amplitude: { x: 8, y: 14 }, wavelength: 60, phase: 70, angle: 35 }).list[0],
        Effects.wave({ amplitude: 16, shape: "radial", wavelength: 80, center: { x: 0.4, y: 0.6 } }).list[0],
    ],
});
