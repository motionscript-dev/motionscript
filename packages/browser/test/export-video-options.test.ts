import { afterEach, describe, expect, it, vi } from "vitest";
import { project, track } from "./document.fixtures";
import { exportVideo, motionGraphicsBitrate } from "../src/exporter";
import { requireAac, requireAvc } from "./encoders.fixtures";
import { FPS, VIEWPORT, centres, fullBleed, inspect, render, solidProject, toneSource, withSound } from "./export-video.fixtures";

/**
 * `exportVideo`'s options, each against the MP4 it writes: the output size, the
 * container, the audio track, delivery, progress and abort.
 * `export-video.test.ts` covers the theme and the undrawable-frame rejection,
 * `export-video-encoder.test.ts` what reaches the encoder.
 */

const canvasesOnPage = () => [...document.body.querySelectorAll("canvas")];

afterEach(() => vi.restoreAllMocks());

describe("exportVideo — output size", () => {
    it("rounds an odd size up to even, since a block codec pads an odd edge", async () => {
        const { video } = await inspect(await render({ document: solidProject("#ff0000", 2, { viewport: { width: 101, height: 57 } }) }));

        expect({ width: video.width, height: video.height }).toEqual({ width: 102, height: 58 });
    });

    it("leaves an even size alone", async () => {
        const { video } = await inspect(await render({ document: solidProject("#ff0000", 2, { viewport: { width: 100, height: 56 } }) }));

        expect({ width: video.width, height: video.height }).toEqual({ width: 100, height: 56 });
    });

    it("multiplies by the scale and rounds, so 1.5 of 101×57 is 152×86", async () => {
        const doc = solidProject("#ff0000", 2, { viewport: { width: 101, height: 57 } });

        const { video } = await inspect(await render({ document: doc, scale: 1.5 }));

        // 151.5 and 85.5 round up to 152 and 86, which are even.
        expect({ width: video.width, height: video.height }).toEqual({ width: 152, height: 86 });
    });

    it("rounds a scaled odd size up to even too", async () => {
        const { video } = await inspect(await render({ document: solidProject("#ff0000", 2, { viewport: { width: 33, height: 20 } }), scale: 1 }));

        expect({ width: video.width, height: video.height }).toEqual({ width: 34, height: 20 });
    });
});

describe("exportVideo — the container", () => {
    it("is one video track at the project's frame rate and length, and no audio for a silent project", async () => {
        const out = await inspect(await render({ document: solidProject("#ff0000", 4) }));

        expect(out.tracks).toBe(1);
        expect(out.audio).toBeNull();
        expect(out.video.codec).toBe("vp9");
        expect(out.video.frames).toBe(4);
        expect(out.video.duration).toBeCloseTo(4 / FPS, 6);
        expect(out.video.frameRate).toBeCloseTo(FPS, 6);
    });

    it("has one key frame when the export is shorter than the key-frame interval", async () => {
        const out = await inspect(await render({ document: solidProject("#ff0000", 5) }));

        expect(out.video.keyFrames).toBe(1);
    });

    it("puts a key frame every interval", async () => {
        const out = await inspect(await render({
            document: solidProject("#ff0000", 12),
            video: { codec: "vp9", keyFrameInterval: 0.5 },
        }));

        // 12 frames at 10 fps is 1.2 s, with a key frame at 0, 0.5 and 1.0.
        expect(out.video.keyFrames).toBe(3);
    });

    it("reports the frame rate of a project that sets its own", async () => {
        const doc = project([track("t", fullBleed("#ff0000"), { duration: 6 / 20 })], { fps: 20, viewport: VIEWPORT });

        const out = await inspect(await render({ document: doc }));

        expect(out.video.frameRate).toBeCloseTo(20, 6);
        expect(out.video.duration).toBeCloseTo(6 / 20, 6);
    });
});

describe("exportVideo — the default codec", () => {
    requireAvc("the default codec");

    it("is H.264 when none is asked for", async () => {
        const { video } = await inspect(await render({ document: solidProject("#ff0000", 2), video: {} }));

        expect(video.codec).toBe("avc");
    });
});

describe("exportVideo — a project with nothing to export, and one already cancelled", () => {
    it("resolves to nothing for a project with no tracks, drawing nothing", async () => {
        const before = canvasesOnPage();

        const result = await exportVideo({ document: project([], { fps: FPS, viewport: VIEWPORT }), returnBytes: true });

        expect(result).toBeUndefined();
        expect(canvasesOnPage()).toEqual(before);
    });

    it("rejects with an AbortError before any work when the signal is already aborted", async () => {
        const before = canvasesOnPage();
        const appended = vi.spyOn(document.body, "appendChild");
        const controller = new AbortController();
        controller.abort();

        const failure = await render({ document: solidProject("#ff0000"), signal: controller.signal }).catch((error: unknown) => error);

        expect((failure as DOMException).name).toBe("AbortError");
        expect(appended).not.toHaveBeenCalled();
        expect(canvasesOnPage()).toEqual(before);
    });

    it("rejects with the abort reason a caller gave", async () => {
        const controller = new AbortController();
        controller.abort(new RangeError("stop"));

        await expect(render({ document: solidProject("#ff0000"), signal: controller.signal })).rejects.toThrow(RangeError);
    });
});

describe("exportVideo — progress", () => {
    it("reports values in [0, 1] that never decrease and end at 1", async () => {
        const seen: number[] = [];

        await render({ document: solidProject("#ff0000", 6), onProgress: (p) => void seen.push(p) });

        expect(seen.length).toBeGreaterThan(2);
        for (const value of seen) expect(value).toBeGreaterThanOrEqual(0);
        for (const value of seen) expect(value).toBeLessThanOrEqual(1);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
        expect(seen.at(-1)).toBe(1);
    });

    it("reports each frame's share of the whole when there is no audio, then the finish", async () => {
        const seen: number[] = [];

        await render({ document: solidProject("#ff0000", 8), onProgress: (p) => void seen.push(p) });

        expect(seen).toEqual([...Array.from({ length: 8 }, (_, i) => (i + 1) / 8), 1]);
    });
});

describe("exportVideo — cancelling a running export", () => {
    it("rejects with an AbortError and leaves no canvas behind when aborted from a progress callback", async () => {
        const before = canvasesOnPage();
        const controller = new AbortController();

        const failure = await render({
            document: solidProject("#ff0000", 20),
            signal: controller.signal,
            onProgress: (progress) => { if (progress > 0.2) controller.abort(); },
        }).catch((error: unknown) => error);

        expect((failure as DOMException).name).toBe("AbortError");
        expect(canvasesOnPage()).toEqual(before);
    });

    it("does not report progress after it was aborted", async () => {
        const controller = new AbortController();
        const seen: number[] = [];

        await render({
            document: solidProject("#ff0000", 20),
            signal: controller.signal,
            onProgress: (progress) => {
                seen.push(progress);
                if (seen.length === 3) controller.abort();
            },
        }).catch(() => undefined);

        expect(seen.length).toBeLessThanOrEqual(4);
    });
});

describe("exportVideo — delivery", () => {
    function stubDownload() {
        const clicks: { download: string; href: string; attached: boolean }[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            clicks.push({ download: this.download, href: this.href, attached: this.isConnected });
        });
        const revoked: string[] = [];
        const revoke = URL.revokeObjectURL.bind(URL);
        vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => { revoked.push(url); revoke(url); });
        return { clicks, revoked };
    }

    it("returns the bytes and downloads nothing under returnBytes", async () => {
        const { clicks } = stubDownload();

        const bytes = await exportVideo({
            document: solidProject("#ff0000"), supersample: 1, video: { codec: "vp9" }, returnBytes: true,
        });

        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(clicks).toEqual([]);
    });

    it("downloads through a temporary anchor otherwise, named by `filename`, and resolves to nothing", async () => {
        const { clicks, revoked } = stubDownload();
        const anchors = document.body.querySelectorAll("a").length;

        const result = await exportVideo({
            document: solidProject("#ff0000"), supersample: 1, video: { codec: "vp9" }, filename: "reel.mp4",
        });

        expect(result).toBeUndefined();
        expect(clicks).toHaveLength(1);
        expect(clicks[0].download).toBe("reel.mp4");
        expect(clicks[0].href).toMatch(/^blob:/);
        // Attached while it was clicked, gone and revoked after.
        expect(clicks[0].attached).toBe(true);
        expect(document.body.querySelectorAll("a")).toHaveLength(anchors);
        expect(revoked).toEqual([clicks[0].href]);
    });

    it("names the download export.mp4 by default", async () => {
        const { clicks } = stubDownload();

        await exportVideo({ document: solidProject("#ff0000"), supersample: 1, video: { codec: "vp9" } });

        expect(clicks[0].download).toBe("export.mp4");
    });

    it("downloads a file that is the same MP4 the bytes path returns", async () => {
        const blobs: Blob[] = [];
        const create = URL.createObjectURL.bind(URL);
        vi.spyOn(URL, "createObjectURL").mockImplementation((object) => { blobs.push(object as Blob); return create(object); });
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { });

        await exportVideo({ document: solidProject("#ff0000"), supersample: 1, video: { codec: "vp9" } });

        expect(blobs).toHaveLength(1);
        expect(blobs[0].type).toBe("video/mp4");
        expect((await inspect(new Uint8Array(await blobs[0].arrayBuffer()))).video.frames).toBe(2);
    });
});

describe("exportVideo — the audio track", () => {
    requireAac("the audio track");

    it("is AAC at 44.1 kHz stereo by default", async () => {
        const { src, manifest } = toneSource(1, 0.5);

        const { audio } = await inspect(await render({ document: withSound(src), manifest }));

        expect(audio).toMatchObject({ codec: "aac", sampleRate: 44100, channels: 2 });
        // The mix is the timeline's second, plus the encoder's priming padding.
        expect(audio!.duration).toBeGreaterThan(0.9);
        expect(audio!.duration).toBeLessThan(1.3);
    });

    it("takes the mixdown rate from `audio.sampleRate`", async () => {
        const { src, manifest } = toneSource(1, 0.5);

        // 48 kHz: a rate every AAC encoder takes, unlike the lower rates, which this Chromium refuses
        // at the default bitrate with an error from inside the encoder.
        const { audio } = await inspect(await render({ document: withSound(src), manifest, audio: { sampleRate: 48000 } }));

        expect(audio!.sampleRate).toBe(48000);
    });

    it("keeps the last 15% of the progress for the mix and the finish when there is audio", async () => {
        const { src, manifest } = toneSource(1, 0.5);
        const seen: number[] = [];

        await render({ document: withSound(src), manifest, onProgress: (p) => void seen.push(p) });

        // Ten frames reach 0.85, then the mix reports 0.97 and the finalised file 1.
        expect(seen).toHaveLength(12);
        expect(seen.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => expect.closeTo(((i + 1) / 10) * 0.85, 9)));
        expect(seen.slice(10)).toEqual([0.97, 1]);
    });

    it("writes no audio track, and mixes nothing, under includeAudio: false", async () => {
        const { src, manifest } = toneSource(1, 0.5);
        const fetched: string[] = [];
        const real = globalThis.fetch;
        vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
            fetched.push(String(input));
            return real(input, init);
        });

        const out = await inspect(await render({ document: withSound(src), manifest, includeAudio: false }));

        expect(out.audio).toBeNull();
        expect(out.tracks).toBe(1);
        expect(fetched).not.toContain(src);
    });

    // Today a sound whose source the manifest does not describe drops out of the export without a word: no
    // audio track, no warning.
    it.todo("reports an audio source the manifest does not describe, instead of exporting without it");

    it("writes no audio track for a project that makes no sound, though audio is on", async () => {
        const out = await inspect(await render({ document: solidProject("#ff0000"), includeAudio: true }));

        expect(out.audio).toBeNull();
    });
});

describe("motionGraphicsBitrate", () => {
    it("is 0.2 bits per pixel per frame", () => {
        expect(motionGraphicsBitrate(1920, 1080, 60)).toBe(24_883_200);
        expect(motionGraphicsBitrate(1920, 1080, 30)).toBe(12_441_600);
        expect(motionGraphicsBitrate(1280, 720, 24)).toBe(4_423_680);
    });

    it("doubles with the frame rate, which a resolution-only quality level would not", () => {
        expect(motionGraphicsBitrate(1920, 1080, 60)).toBe(2 * motionGraphicsBitrate(1920, 1080, 30));
    });

    it("floors at 2 Mbps so a tiny viewport still gets enough bits", () => {
        expect(motionGraphicsBitrate(64, 64, 10)).toBe(2_000_000);
        expect(motionGraphicsBitrate(1, 1, 1)).toBe(2_000_000);
    });

    it("is capped at 100 Mbps, which 4K at 60 fps is already near", () => {
        expect(motionGraphicsBitrate(3840, 2160, 60)).toBe(99_532_800);
        expect(motionGraphicsBitrate(3840, 2160, 120)).toBe(100_000_000);
        expect(motionGraphicsBitrate(7680, 4320, 60)).toBe(100_000_000);
    });

    it("rounds to a whole number of bits", () => {
        expect(Number.isInteger(motionGraphicsBitrate(1366, 768, 29.97))).toBe(true);
    });
});

describe("exportVideo — several tracks", () => {
    it("exports one frame for each of three one-frame tracks laid end to end", async () => {
        const doc = project([
            track("a", fullBleed("#ff0000"), { duration: 1 / FPS }),
            track("b", fullBleed("#00ff00"), { startAt: 1 / FPS, duration: 1 / FPS }),
            track("c", fullBleed("#0000ff"), { startAt: 2 / FPS, duration: 1 / FPS }),
        ], { fps: FPS, viewport: VIEWPORT });

        const { video } = await inspect(await render({ document: doc }));

        expect(video.frames).toBe(3);
        expect(video.duration).toBeCloseTo(0.3, 6);
    });
});

describe("exportVideo — a frame range", () => {
    /** Two frames each of red, green and blue. */
    const strip = () => project([
        track("r", fullBleed("#ff0000"), { duration: 2 / FPS }),
        track("g", fullBleed("#00ff00"), { startAt: 2 / FPS, duration: 2 / FPS }),
        track("b", fullBleed("#0000ff"), { startAt: 4 / FPS, duration: 2 / FPS }),
    ], { fps: FPS, viewport: VIEWPORT });

    const hues = async (bytes: Uint8Array) =>
        (await centres(bytes)).map(([r, g, b]) => (r > g && r > b ? "red" : g > b ? "green" : "blue"));

    it("encodes those frames alone, as a file of their own from 0", async () => {
        const bytes = await render({ document: strip(), frames: { start: 1, end: 5 } });

        const { video } = await inspect(bytes);
        expect(video.frames).toBe(4);
        expect(video.duration).toBeCloseTo(0.4, 6);
        expect(video.keyFrames).toBe(1);
        expect(await hues(bytes)).toEqual(["red", "green", "green", "blue"]);
    });

    it("is silent although the project makes sound", async () => {
        const { src, manifest } = toneSource(1, 0.5);

        const out = await inspect(await render({ document: withSound(src), manifest, frames: { start: 0, end: 10 } }));

        expect(out.audio).toBeNull();
        expect(out.tracks).toBe(1);
    });

    it.each([[-1, 2], [3, 3], [4, 2], [0, 7], [0.5, 2]])("refuses frames %d to %d, which are not a range inside the timeline", async (start, end) => {
        await expect(render({ document: strip(), frames: { start, end } })).rejects.toThrow(RangeError);
    });
});
