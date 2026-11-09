// core's resolved fills, strokes and shadows to the doc's paints, resolved
// against a shape's bounds.

import type { FillResolved, ShadowResolved } from "@motionscript/core";
import { isWgslShader } from "@motionscript/core";
import { computeImageMatrix } from "./geometry/image-matrix";
import type { ImageAsset, Mat, Paint, Shadow, Stop } from "../doc";

type Bounds = [number, number, number, number];

/** A normalized point to pixels: −1..1, y up (+1 = top). */
function norm(nx: number, ny: number, b: Bounds): [number, number] {
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    return [cx + nx * ((b[2] - b[0]) / 2), cy - ny * ((b[3] - b[1]) / 2)];
}

function stops(colors: readonly (readonly number[])[], at: readonly number[]): Stop[] {
    return colors.map((c, i) => ({ offset: at[i] ?? i / Math.max(1, colors.length - 1), color: [c[0], c[1], c[2], c[3]] }));
}

/** A fill layer as a doc paint, or null when this adapter doesn't map it yet. */
/** What a fill may need from the frame's doc. */
export interface PaintAssets {
    image(src: string): ImageAsset | null;
    /** A 3D scene rendered at `ratio` device px per logical px over `w`×`h`. */
    scene3d(scene: unknown, w: number, h: number, ratio: number): ImageAsset;
    /** The current device scale (canvas3d sizes its buffer by it). */
    deviceScale(): number;
    /** An image drawn `edge` device px along its long side (a vector may rasterize sharper). */
    imageEdge?(src: string, edge: number): void;
    /** A video fill's frame at the node's elapsed time (or at `time` s), or null while it decodes. */
    video(fill: unknown, time?: number): ImageAsset | null;
    /** The current node's elapsed seconds (a shader fill's `time`). */
    time?(): number;
    /** Sees each WGSL shader fill drawn, to check its uniforms against its `Params`. */
    checkShader?(fill: unknown): void;
}

export function fillPaint(f: FillResolved, bounds: Bounds, missing: Set<string>, assets?: PaintAssets): Paint | null {
    const any = f as any;
    const image = assets ? (src: string) => assets.image(src) : undefined;
    switch (any.type) {
        case "video": {
            const asset = assets?.video(any);
            if (!asset) {
                missing.add("fill:video-not-decoded");
                return null;
            }
            const r = computeImageMatrix(asset.width, asset.height, any, { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] });
            const fit = any.fit ?? "fill";
            const tile = fit === "tile" ? "repeat" : fit !== "fit" && (any.zoom ?? 1) >= 1 ? "clamp" : "decal";
            return { kind: "image", image: asset, box: [bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]], matrix: [r[0], r[3], r[1], r[4], r[2], r[5]], tile };
        }
        case "canvas3D": {
            if (!assets) return null;
            const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
            if (!(w > 0) || !(h > 0)) return null;
            // canvas3d.ts: min(maxPixelRatio ?? 2, max(deviceScale, 1)), stretched over the box.
            const ratio = Math.min(any.maxPixelRatio ?? 2, Math.max(assets.deviceScale(), 1));
            const asset = assets.scene3d(any.scene, w, h, ratio);
            return { kind: "image", image: asset, box: [bounds[0], bounds[1], w, h], fit: "stretch" };
        }
        case "image": {
            const asset = image?.(any.src);
            if (!asset) {
                missing.add("fill:image-not-loaded");
                return null;
            }
            // makeImageShader: computeImageMatrix places it; tile repeats, a
            // covering fit clamps, anything that may leave a gap is decal.
            const r = computeImageMatrix(asset.width, asset.height, any, { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] });
            const m: Mat = [r[0], r[3], r[1], r[4], r[2], r[5]];
            if (assets?.imageEdge) {
                const scale = assets.deviceScale();
                assets.imageEdge(any.src, Math.max(asset.width * Math.hypot(m[0], m[1]), asset.height * Math.hypot(m[2], m[3])) * scale);
            }
            const fit = any.fit ?? "fill";
            const tile = fit === "tile" ? "repeat" : fit !== "fit" && (any.zoom ?? 1) >= 1 ? "clamp" : "decal";
            return { kind: "image", image: asset, box: [bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]], matrix: m, tile };
        }
        case "solid":
            return { kind: "solid", color: [any.color[0], any.color[1], any.color[2], any.color[3]] };
        case "linear-gradient":
            return { kind: "linear", from: norm(any.start.x, any.start.y, bounds), to: norm(any.end.x, any.end.y, bounds), stops: stops(any.colors, any.stops) };
        case "conic-gradient": {
            // A sweep from startAngle over a full turn, clamped.
            const start = any.startAngle ?? 0;
            const even = any.stops.length === any.colors.length ? any.stops : [];
            return { kind: "sweep", center: norm(any.center.x, any.center.y, bounds), startAngle: start, endAngle: start + 360, stops: stops(any.colors, even) };
        }
        case "radial-gradient":
            return { kind: "radial", center: norm(any.center.x, any.center.y, bounds), radius: any.radius, stops: stops(any.colors, any.stops) };
        case "shader": {
            // Nothing to draw yet (a host's picker before a shader is chosen).
            if (!any.source?.trim()) return null;
            // WGSL only: a stored SkSL fill draws nothing (reported as fill:shader-sksl).
            if (!isWgslShader(any)) break;
            assets?.checkShader?.(any);
            const texture = any.textures?.[0] ? image?.(any.textures[0].src) : undefined;
            if (any.textures?.[0] && !texture) {
                missing.add("fill:image-not-loaded");
                return null;
            }
            return {
                kind: "shader", source: any.source, uniforms: any.uniforms ?? {}, time: assets?.time?.() ?? 0,
                box: [bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]], ...(texture ? { texture } : {}),
            };
        }
        case "dotGrid": case "grid": case "stripe": case "noise": case "fractalNoise":
            return { kind: "procedural", fill: any, box: [bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]] };
    }
    missing.add(any.type === "shader" ? "fill:shader-sksl" : `fill:${any.type}`);
    return null;
}

/** A drop shadow with one solid fill, as the doc's leaf shadows carry it. */
export function shadowOf(s: ShadowResolved, missing: Set<string>): Shadow | null {
    const f = s.fill[0] as any;
    const c = f?.type === "solid" ? f.color : [0, 0, 0, 1];
    // sigma = blur / 2; offset in y-up author space.
    return { dx: s.offset?.x ?? 0, dy: -(s.offset?.y ?? 0), sigma: s.blur / 2, spread: s.spread, color: [c[0], c[1], c[2], c[3] * (f?.opacity ?? 1)] };
}
