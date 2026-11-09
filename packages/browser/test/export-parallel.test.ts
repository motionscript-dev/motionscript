import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@motionscript/core";
import { project, track } from "./document.fixtures";
import { centres, FPS, fullBleed, inspect, render, toneSource, VIEWPORT, withSound } from "./export-video.fixtures";
import { requireAac } from "./encoders.fixtures";
import { exportVideoParallel, type ParallelExportParams } from "../src/parallel/export-parallel";
import { localLane, messagePortLane, serveExportLane } from "../src/parallel/lanes";

/**
 * `exportVideoParallel` against the single export it stands in for: the same
 * frames, the same length, layers composited, progress that only climbs. VP9 and
 * a software encoder, as in `export-video.test.ts`, so it runs on any Chromium.
 */

/** Red for three seconds, with blue over it for the middle one: a split that crosses a layer. */
const layered = (): ProjectDocument => project([
    track("under", fullBleed("#ff0000"), { duration: 3 }),
    track("over", fullBleed("#0000ff"), { startAt: 1, duration: 1 }),
], { fps: FPS, viewport: VIEWPORT });

function parallel(params: Omit<ParallelExportParams, "lanes"> & { lanes?: ParallelExportParams["lanes"] }) {
    return exportVideoParallel({
        supersample: 1,
        video: { codec: "vp9", hardwareAcceleration: "prefer-software" },
        chunkSeconds: 1,
        lanes: [localLane({})],
        ...params,
    });
}

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 12);

describe("exportVideoParallel", () => {
    it("draws the frames a single export draws, layers composited across the chunks", async () => {
        const document = layered();
        const [split, whole] = await Promise.all([
            parallel({ document }),
            render({ document, video: { codec: "vp9", hardwareAcceleration: "prefer-software" } }),
        ]);

        const [a, b] = [await inspect(split), await inspect(whole)];
        expect(a.video.frames).toBe(30);
        expect(a.video.frames).toBe(b.video.frames);
        expect(a.video.duration).toBeCloseTo(b.video.duration, 3);
        expect(a.video).toMatchObject({ codec: "vp9", width: VIEWPORT.width, height: VIEWPORT.height });

        const [pa, pb] = [await centres(split), await centres(whole)];
        pa.forEach((px, i) => expect(close(px, pb[i]), `frame ${i}: ${px} vs ${pb[i]}`).toBe(true));
        expect(close(pa[5], [255, 0, 0])).toBe(true);
        expect(close(pa[15], [0, 0, 255])).toBe(true);
        expect(close(pa[25], [255, 0, 0])).toBe(true);
    });

    it("starts every chunk on a key frame, as a single export's rhythm has them", async () => {
        const out = await inspect(await parallel({ document: layered() }));
        expect(out.video.keyFrames).toBe(3);
    });

    it("reports progress that only climbs and ends at one", async () => {
        const seen: number[] = [];
        await parallel({ document: layered(), onProgress: (p) => seen.push(p) });
        expect(seen.at(-1)).toBe(1);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
        // Lanes report every 100 ms; this tiny render takes about that long in all.
        expect(seen[0]).toBeLessThan(1);
    });

    it("renders through a lane on the far side of a message port", async () => {
        const { port1, port2 } = new MessageChannel();
        const stop = serveExportLane(port2, () => ({}));
        try {
            const bytes = await parallel({ document: layered(), lanes: [messagePortLane(port1)] });
            expect((await inspect(bytes)).video.frames).toBe(30);
            const px = await centres(bytes);
            expect(close(px[15], [0, 0, 255])).toBe(true);
        } finally {
            stop();
        }
    });

    it("streams the file to a sink, positions honoured", async () => {
        const parts: { data: Uint8Array; position: number }[] = [];
        const stream = new WritableStream<{ type: "write"; data: Uint8Array; position: number }>({
            write: (chunk) => { parts.push({ data: chunk.data.slice(), position: chunk.position }); },
        });
        const returned = await parallel({ document: layered(), stream });
        expect(returned).toHaveLength(0);
        const size = parts.reduce((max, c) => Math.max(max, c.position + c.data.length), 0);
        const file = new Uint8Array(size);
        for (const part of parts) file.set(part.data, part.position);
        expect((await inspect(file)).video.frames).toBe(30);
    });

    it("stops on abort", async () => {
        const controller = new AbortController();
        const run = parallel({ document: layered(), signal: controller.signal, onProgress: (p) => { if (p > 0.2) controller.abort(new Error("stop")); } });
        await expect(run).rejects.toThrow("stop");
    });

    it("refuses an audio format", async () => {
        await expect(parallel({ document: layered(), format: "wav" as never })).rejects.toThrow(RangeError);
    });

    describe("with sound", () => {
        requireAac("exportVideoParallel with sound");

        it("muxes one audio track mixed over the whole timeline", async () => {
            const { src, manifest } = toneSource(3, 0.5);
            const bytes = await parallel({ document: withSound(src, { seconds: 3 }), manifest, format: "mp4" });
            const out = await inspect(bytes);
            expect(out.tracks).toBe(2);
            expect(out.audio!.duration).toBeGreaterThan(2.9);
            expect(out.video.frames).toBe(30);
        });
    });
});
