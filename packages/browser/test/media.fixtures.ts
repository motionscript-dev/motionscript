import type { AssetManifest } from "@motionscript/core";
import { setAssetByteSource } from "../src/asset-bytes";

/**
 * Media made in the page, so decode-level suites need no fixture files and can
 * choose patterns whose pixels say which level drew them.
 */

export type Frame = { pixels: Uint8Array; width: number; height: number };
export type RGBA = [number, number, number, number];

async function pngOf(size: number, paint: (ctx: OffscreenCanvasRenderingContext2D) => void, height = size): Promise<Blob> {
    const canvas = new OffscreenCanvas(size, height);
    const ctx = canvas.getContext("2d")!;
    paint(ctx);
    return canvas.convertToBlob({ type: "image/png" });
}

/** Red top-left, green top-right, blue bottom-left, white bottom-right. */
export function quadrantPng(size: number): Promise<Blob> {
    return pngOf(size, (ctx) => {
        const h = size / 2;
        ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, h, h);
        ctx.fillStyle = "#00ff00"; ctx.fillRect(h, 0, h, h);
        ctx.fillStyle = "#0000ff"; ctx.fillRect(0, h, h, h);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(h, h, h, h);
    });
}

/** Vertical black/white stripes `period` px wide — mid-grey at any level too small to hold them. */
export function stripesPng(size: number, period: number): Promise<Blob> {
    return pngOf(size, (ctx) => {
        ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = "#ffffff";
        for (let x = 0; x < size; x += period * 2) ctx.fillRect(x, 0, period, size);
    });
}

/** A vector with an intrinsic size and hard vertical stripes at 1 intrinsic px. */
export function stripesSvg(width: number, height: number): Blob {
    const bars = Array.from({ length: Math.floor(width / 2) }, (_, i) => `<rect x="${i * 2}" y="0" width="1" height="${height}" fill="#fff"/>`).join("");
    return new Blob(
        [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><rect width="${width}" height="${height}" fill="#000"/>${bars}</svg>`],
        { type: "image/svg+xml" },
    );
}

/** Answer the adapter's fetches for these sources from memory. Cleared with `setAssetByteSource(null)`. */
export function serve(blobs: Record<string, Blob>): string[] {
    const asked: string[] = [];
    setAssetByteSource(async (src) => {
        asked.push(src);
        return blobs[src] ?? null;
    });
    return asked;
}

export function imageManifest(images: Record<string, { width: number; height: number }>): AssetManifest {
    return {
        image: Object.fromEntries(Object.entries(images).map(([src, size]) => [src, { src, ...size, sizeBytes: 0 }])),
        video: {},
        audio: {},
        font: {},
    };
}

export function at(frame: Frame, fx: number, fy: number): RGBA {
    const x = Math.min(frame.width - 1, Math.floor(fx * frame.width));
    const y = Math.min(frame.height - 1, Math.floor(fy * frame.height));
    const i = (y * frame.width + x) * 4;
    return [frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2], frame.pixels[i + 3]];
}

/** Spread between the darkest and lightest red channel along the middle row. */
export function rowContrast(frame: Frame, from = 0.25, to = 0.75): number {
    const y = Math.floor(frame.height / 2);
    let lo = 255;
    let hi = 0;
    for (let x = Math.floor(from * frame.width); x < Math.floor(to * frame.width); x++) {
        const v = frame.pixels[(y * frame.width + x) * 4];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
    }
    return hi - lo;
}

/** Whether a colour is within `tolerance` of `expected` on every channel. */
export function near(actual: RGBA, expected: RGBA, tolerance = 8): boolean {
    return actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
}
