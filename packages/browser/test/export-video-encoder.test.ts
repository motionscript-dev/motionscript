import { afterEach, describe, expect, it, vi } from "vitest";
import { QUALITY_HIGH, QUALITY_LOW, type VideoCodec } from "mediabunny";
import { Fills, setTheme, type Theme } from "@motionscript/core";
import { createStillRenderer } from "../src/still";
import { motionGraphicsBitrate } from "../src/exporter";
import { requireAac, requireAvc } from "./encoders.fixtures";
import { FPS, VIEWPORT, inspect, render, solidProject, toneSource, withSound } from "./export-video.fixtures";
import { node, project, still, track } from "./document.fixtures";

/**
 * What reaches the encoder, read off the objects the
 * exporter hands mediabunny rather than off the file, because a file at a few
 * frames of a flat colour looks the same at any bitrate.
 *
 * `CanvasSource`, `AudioBufferSource` and `canEncodeVideo` are wrapped, not
 * replaced: each still does its real work, so every case also encodes a real MP4.
 */

const seen = vi.hoisted(() => ({
    video: [] as { canvas: HTMLCanvasElement; config: Record<string, unknown> }[],
    audio: [] as Record<string, unknown>[],
    frames: [] as ImageData[],
    mixed: [] as AudioBuffer[],
    probes: [] as { codec: string; options: Record<string, unknown> | undefined }[],
    probeAnswer: null as ((codec: string) => boolean | Error) | null,
}));

vi.mock("mediabunny", async (importOriginal) => {
    const actual = await importOriginal<typeof import("mediabunny")>();

    class SpyCanvasSource extends actual.CanvasSource {
        constructor(canvas: HTMLCanvasElement, config: ConstructorParameters<typeof actual.CanvasSource>[1]) {
            super(canvas, config);
            seen.video.push({ canvas, config: { ...config } });
            this.watched = canvas;
        }
        private readonly watched: HTMLCanvasElement;
        override async add(timestamp: number, duration?: number) {
            // Read back before the encoder takes the frame: the pixels it is about to be given.
            const scratch = document.createElement("canvas");
            scratch.width = this.watched.width;
            scratch.height = this.watched.height;
            const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(this.watched, 0, 0);
            seen.frames.push(ctx.getImageData(0, 0, scratch.width, scratch.height));
            return super.add(timestamp, duration);
        }
    }

    class SpyAudioBufferSource extends actual.AudioBufferSource {
        constructor(config: ConstructorParameters<typeof actual.AudioBufferSource>[0]) {
            super(config);
            seen.audio.push({ ...config });
        }
        override add(buffer: AudioBuffer) {
            seen.mixed.push(buffer);
            return super.add(buffer);
        }
    }

    const canEncodeVideo = vi.fn(async (codec: VideoCodec, options?: Record<string, unknown>) => {
        seen.probes.push({ codec, options });
        const answer = seen.probeAnswer?.(codec);
        if (answer instanceof Error) throw answer;
        if (answer !== undefined && answer !== null) return answer;
        return (actual.canEncodeVideo as (codec: VideoCodec, options?: Record<string, unknown>) => Promise<boolean>)(codec, options);
    });

    return { ...actual, CanvasSource: SpyCanvasSource, AudioBufferSource: SpyAudioBufferSource, canEncodeVideo };
});

afterEach(() => {
    seen.video.length = 0;
    seen.audio.length = 0;
    seen.frames.length = 0;
    seen.mixed.length = 0;
    seen.probes.length = 0;
    seen.probeAnswer = null;
    setTheme(undefined);
    vi.restoreAllMocks();
});

const lastVideo = () => seen.video.at(-1)!;

describe("the video encoder's configuration", () => {
    it("takes its defaults from the output size and frame rate", async () => {
        await render({ document: solidProject("#ff0000") });

        expect(lastVideo().config).toMatchObject({
            codec: "vp9",
            bitrate: motionGraphicsBitrate(VIEWPORT.width, VIEWPORT.height, FPS),
            hardwareAcceleration: "no-preference",
            keyFrameInterval: 1,
            latencyMode: "quality",
            contentHint: "detail",
        });
        expect(lastVideo().config).not.toHaveProperty("bitrateMode");
    });

    it("sizes the default bitrate from the size actually encoded, rounded to even and scaled", async () => {
        const doc = solidProject("#ff0000", 2, { viewport: { width: 1001, height: 501 } });

        await render({ document: doc, scale: 1 });

        expect(lastVideo().config.bitrate).toBe(motionGraphicsBitrate(1002, 502, FPS));
    });

    it("passes a numeric bitrate through", async () => {
        await render({ document: solidProject("#ff0000"), video: { codec: "vp9", bitrate: 3_000_000 } });

        expect(lastVideo().config.bitrate).toBe(3_000_000);
    });

    it("passes a quality level through as it is, for the encoder to size", async () => {
        await render({ document: solidProject("#ff0000"), video: { codec: "vp9", bitrate: QUALITY_HIGH } });
        expect(lastVideo().config.bitrate).toBe(QUALITY_HIGH);

        await render({ document: solidProject("#ff0000"), video: { codec: "vp9", bitrate: QUALITY_LOW } });
        expect(lastVideo().config.bitrate).toBe(QUALITY_LOW);
    });

    it("passes the key-frame interval, the hardware preference, latency mode, content hint and bitrate mode", async () => {
        await render({
            document: solidProject("#ff0000"),
            video: {
                codec: "vp9",
                keyFrameInterval: 0.25,
                hardwareAcceleration: "prefer-software",
                latencyMode: "realtime",
                contentHint: "motion",
                bitrateMode: "constant",
            },
        });

        expect(lastVideo().config).toMatchObject({
            keyFrameInterval: 0.25,
            hardwareAcceleration: "prefer-software",
            latencyMode: "realtime",
            contentHint: "motion",
            bitrateMode: "constant",
        });
    });
});

describe("supersampling", () => {
    it("draws on a canvas a multiple of the output and has the encoder scale it down", async () => {
        await render({ document: solidProject("#ff0000"), supersample: 2 });

        const { canvas, config } = lastVideo();
        expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 128, height: 128 });
        expect(config.transform).toEqual({ width: 64, height: 64, fit: "fill" });
    });

    it("asks for no scaling at all when it is off", async () => {
        await render({ document: solidProject("#ff0000"), supersample: 1 });

        const { canvas, config } = lastVideo();
        expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 64, height: 64 });
        expect(config).not.toHaveProperty("transform");
    });

    it("supersamples by 2 unless told otherwise", async () => {
        await render({ document: solidProject("#ff0000"), supersample: undefined });

        expect(lastVideo().canvas.width).toBe(128);
    });

    it("rounds a fractional factor and treats less than 1 as 1", async () => {
        await render({ document: solidProject("#ff0000"), supersample: 2.6 });
        expect(lastVideo().canvas.width).toBe(192);

        await render({ document: solidProject("#ff0000"), supersample: 0.2 });
        expect(lastVideo().canvas.width).toBe(64);
    });

    it("reduces the factor so the longest axis stays inside 8192 pixels", async () => {
        // A wide, short frame: 4096 × 4 reaches the limit at a factor of 2.
        const doc = solidProject("#ff0000", 1, { viewport: { width: 4096, height: 4 } });
        const controller = new AbortController();
        // Only the canvas is wanted, not a 8192-wide encode: stop before the first frame.
        const abandoned = render({ document: doc, supersample: 8, signal: controller.signal, onProgress: () => controller.abort() });
        await abandoned.catch(() => undefined);

        const { canvas, config } = lastVideo();
        expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 8192, height: 8 });
        expect(config.transform).toEqual({ width: 4096, height: 4, fit: "fill" });
    });

    it("keeps a factor that fits exactly on the limit, and falls to 1 when even 2 does not fit", async () => {
        const fits = solidProject("#ff0000", 1, { viewport: { width: 4096, height: 4 } });
        const controller = new AbortController();
        await render({ document: fits, supersample: 2, signal: controller.signal, onProgress: () => controller.abort() }).catch(() => undefined);
        expect(lastVideo().canvas.width).toBe(8192);

        const tooWide = solidProject("#ff0000", 1, { viewport: { width: 5000, height: 4 } });
        const again = new AbortController();
        await render({ document: tooWide, supersample: 2, signal: again.signal, onProgress: () => again.abort() }).catch(() => undefined);
        expect(lastVideo().canvas.width).toBe(5000);
    });
});

describe("the codec", () => {
    it("is probed when it is not H.264, and kept when the platform can encode it", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        seen.probeAnswer = () => true;

        await render({ document: solidProject("#ff0000"), video: { codec: "vp9" } });

        expect(seen.probes).toHaveLength(1);
        expect(seen.probes[0].codec).toBe("vp9");
        expect(seen.probes[0].options).toEqual({ width: 64, height: 64, bitrate: motionGraphicsBitrate(64, 64, FPS) });
        expect(lastVideo().config.codec).toBe("vp9");
        expect(warn).not.toHaveBeenCalled();
    });

    describe("falling back", () => {
        requireAvc("the H.264 fallback");

        it("is not probed for H.264, which is the fallback and has nothing to fall back to", async () => {
            await render({ document: solidProject("#ff0000"), video: { codec: "avc" } });

            expect(seen.probes).toEqual([]);
            expect(lastVideo().config.codec).toBe("avc");
        });

        it("warns and writes H.264 when the platform has no encoder for the codec", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
            seen.probeAnswer = () => false;

            const out = await inspect(await render({ document: solidProject("#ff0000"), video: { codec: "av1" } }));

            expect(warn).toHaveBeenCalledWith("[motionscript] No av1 encoder available; exporting as H.264 instead.");
            expect(lastVideo().config.codec).toBe("avc");
            expect(out.video.codec).toBe("avc");
        });

        it("treats a probe that throws as one that answered no", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
            seen.probeAnswer = () => new Error("probe blew up");

            const out = await inspect(await render({ document: solidProject("#ff0000"), video: { codec: "hevc" } }));

            expect(warn).toHaveBeenCalledWith("[motionscript] No hevc encoder available; exporting as H.264 instead.");
            expect(out.video.codec).toBe("avc");
        });
    });
});

describe("the audio encoder's configuration", () => {
    requireAac("the audio encoder's configuration");

    it("is AAC at 192 kbps unless told otherwise", async () => {
        const { src, manifest } = toneSource(1, 0.5);

        await render({ document: withSound(src), manifest });

        expect(seen.audio).toEqual([{ codec: "aac", bitrate: 192_000 }]);
    });

    it("takes the bitrate it is given", async () => {
        const { src, manifest } = toneSource(1, 0.5);

        await render({ document: withSound(src), manifest, audio: { bitrate: 128_000 } });

        expect(seen.audio).toEqual([{ codec: "aac", bitrate: 128_000 }]);
    });

    it("is not created at all when the project makes no sound, or audio is off", async () => {
        const { src, manifest } = toneSource(1, 0.5);

        await render({ document: solidProject("#ff0000") });
        await render({ document: withSound(src), manifest, includeAudio: false });

        expect(seen.audio).toEqual([]);
        expect(seen.mixed).toEqual([]);
    });
});

describe("what is drawn before it is encoded", () => {
    /** A scene with an edge, a stroke, a rotation and a gradient, so a difference has somewhere to show. */
    const scene = (fill: string) => project([track("t", still(
        node("bg", "rect", { width: "fill", height: "fill", fill }),
        node("a", "rect", { width: 30, height: 18, rotation: 25, x: -8, y: 6, fill: "#ffcc00", stroke: { weight: 3, fill: "#101820" }, cornerRadius: 4 }, null, 1),
        node("b", "ellipse", { width: 20, height: 20, x: 14, y: -10, fill: Fills.linearGradient(["#ff0066", "#3300ff"]) }, null, 2),
    ), { duration: 2 / FPS })], { fps: FPS, viewport: VIEWPORT });

    const BRAND: Theme = { colors: { brand: "#2a9d8f" } };

    async function stillPixels(doc: ReturnType<typeof scene>, frame: number): Promise<Uint8ClampedArray> {
        const renderer = await createStillRenderer({ viewport: VIEWPORT, fps: FPS });
        try {
            await renderer.render(doc, { frame });
            const bitmap = await createImageBitmap(await renderer.toBlob());
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(bitmap, 0, 0);
            return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        } finally {
            renderer.dispose();
        }
    }

    function differing(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
        expect(a.length).toBe(b.length);
        let count = 0;
        for (let i = 0; i < a.length; i += 4) {
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count++;
        }
        return count;
    }

    it("is, frame for frame, what a still of the same frame draws", async () => {
        const doc = scene("#223344");

        await render({ document: doc });

        expect(seen.frames).toHaveLength(2);
        for (const [frame, pixels] of seen.frames.entries()) {
            expect(differing(pixels.data, await stillPixels(doc, frame))).toBe(0);
        }
    });

    it("is the same for a themed document, whatever the global theme was", async () => {
        setTheme({ colors: { brand: "#ff00ff" } });
        const doc = { ...scene("brand"), theme: BRAND };

        await render({ document: doc });

        const [first] = seen.frames;
        expect(differing(first.data, await stillPixels(doc, 0))).toBe(0);
        // And it drew the document's colour: the corner is the theme's teal.
        expect([...first.data.slice(0, 3)]).toEqual([0x2a, 0x9d, 0x8f]);
    });

    it("is not blank: the scene's own colours are on the canvas", async () => {
        await render({ document: scene("#223344") });

        const pixels = seen.frames[0].data;
        const colours = new Set<string>();
        for (let i = 0; i < pixels.length; i += 4) colours.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        expect(colours.size).toBeGreaterThan(10);
    });
});
