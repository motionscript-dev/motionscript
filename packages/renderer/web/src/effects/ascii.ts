import { Effects, resolveAsciiCharset, type AsciiEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

// The atlas is baked with the 2D canvas, in a face the page has loaded into
// document.fonts. The module neither fetches faces nor awaits at top level: a
// published module that did would request URLs from the host's origin, and an
// IIFE bundle of it would not build.
const FALLBACK_FAMILY = "Inter";
const available = (family: string) => typeof document !== "undefined" && document.fonts.check(`12px "${family}"`);

// glyph-atlas.ts: cell = clamp(round(max(8, size * 2)), 4, 64); at most 256 glyphs.
const bakedCell = (size: number) => Math.max(4, Math.min(64, Math.round(Math.max(8, size * 2))));

// Supersampling factor for the bake. 1 draws at the atlas size; larger values were tried
// (unsnapped baseline, box-filtered) and rendered the glyphs too thin.
const SS = 1;

function bake(charset: string, family: string, cell: number) {
    const glyphs = [...charset].slice(0, 256);
    const big = cell * SS;
    const canvas = new OffscreenCanvas(big * glyphs.length, big);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = `${cell * 0.8 * SS}px "${family}"`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fontKerning = "none";
    glyphs.forEach((g, i) => {
        const advance = ctx.measureText(g).width;
        ctx.fillText(g, i * big + (big - advance) / 2, big * 0.78);
    });
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const width = cell * glyphs.length;
    const pixels = new Uint8ClampedArray(width * cell * 4);
    for (let y = 0; y < cell; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) sum += src[((y * SS + dy) * canvas.width + x * SS + dx) * 4];
            const v = sum / (SS * SS);
            const o = (y * width + x) * 4;
            pixels[o] = pixels[o + 1] = pixels[o + 2] = v;
            pixels[o + 3] = 255;
        }
    }
    return { glyphs: glyphs.length, pixels, width };
}

export default definePort<AsciiEffect, { family: string; cell: number; charset: string; atlas: ReturnType<typeof bake> }>({
    type: "ascii",
    surface: "shader",
    params: {
        size: "param",
        glyphs: { type: "f32", uses: ["charset", "fontFamily"], value: (_e, c) => c.atlas.glyphs },
        cell: { type: "f32", value: (_e, c) => c.cell },
        ink: "param",
        background: "param",
        colored: "param",
    },
    prepare(e) {
        const charset = resolveAsciiCharset(e.charset);
        if (charset.length === 0) return null;
        // The engine falls back to the first registered family for one it lacks ("monospace").
        const family = available(e.fontFamily) ? e.fontFamily : FALLBACK_FAMILY;
        const cell = bakedCell(e.size);
        return { family, cell, charset, atlas: bake(charset, family, cell) };
    },
    extras: (_e, c) => ({
        aux: { key: `ascii|${c.family}|${c.cell}|${c.charset}`, width: c.atlas.width, height: c.cell, pixels: c.atlas.pixels },
    }),
    cases: () => [
        Effects.ascii().list[0],
        Effects.ascii({ size: 10, charset: "hex", fontFamily: "Fira Mono", ink: "#6f6", background: "#001", colored: false }).list[0],
        Effects.ascii({ size: 14, colored: true, background: "transparent", ink: "white" }).list[0],
        Effects.ascii({ size: 8, ink: "black", background: "white", charset: " .oO@" }).list[0],
    ],
});
