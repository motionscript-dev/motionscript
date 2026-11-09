import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ALL_FORMATS,
    BufferSource,
    Input,
    MP3,
    MP4,
    WAVE,
    WEBM,
    type InputFormat,
} from "mediabunny";

import { ConcatMismatchError, concatVideoSegments } from "../src/concat";
import { createBrowserEngine } from "../src/engine";
import { exportAudio, NoAudioError, type ExportAudioParams } from "../src/export-audio";
import { EXPORT_FORMATS } from "../src/formats";
import { toneBuffer } from "./audio.fixtures";
import { requireAac } from "./encoders.fixtures";
import { render, solidProject, toneSource, withSound } from "./export-video.fixtures";

/**
 * Every format but MP4, written for real and read back with the library that
 * wrote it: the container, its tracks' codecs and their lengths.
 */

interface Read {
    format: InputFormat;
    video: { codec: string | null; frames: number } | null;
    audio: { codec: string | null; sampleRate: number; duration: number } | null;
}

async function read(bytes: Uint8Array): Promise<Read> {
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
        format: await input.getFormat(),
        video: video ? { codec: await video.getCodec(), frames: (await video.computePacketStats()).packetCount } : null,
        audio: audio
            ? { codec: await audio.getCodec(), sampleRate: await audio.getSampleRate(), duration: await audio.computeDuration() }
            : null,
    };
}

const exportBytes = (params: Omit<ExportAudioParams, "returnBytes">) =>
    exportAudio({ ...params, returnBytes: true }) as Promise<Uint8Array>;

const urls: string[] = [];
function tone(seconds: number) {
    const source = toneSource(seconds, 0.5);
    urls.push(source.src);
    return source;
}
afterEach(() => {
    while (urls.length) URL.revokeObjectURL(urls.pop()!);
    vi.restoreAllMocks();
});

describe("exportVideo — WebM", () => {
    it("writes VP9 into a WebM by default", async () => {
        const out = await read(await render({ document: solidProject("#00ff00", 3), format: "webm", video: {} }));

        expect(out.format).toBe(WEBM);
        expect(out.video).toEqual({ codec: "vp9", frames: 3 });
        expect(out.audio).toBeNull();
    });

    it("muxes the mix as 48 kHz Opus", async () => {
        const { src, manifest } = tone(1);
        const out = await read(await render({ document: withSound(src), manifest, format: "webm" }));

        expect(out.audio?.codec).toBe("opus");
        expect(out.audio?.sampleRate).toBe(48_000);
        expect(out.audio?.duration).toBeCloseTo(1, 1);
    });

    it("falls back to the container's default for a codec it cannot hold", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const out = await read(await render({ document: solidProject("#00ff00"), format: "webm", video: { codec: "avc" } }));

        expect(out.video?.codec).toBe("vp9");
        expect(warn).toHaveBeenCalledWith("[motionscript] WEBM cannot hold avc; exporting as VP9 instead.");
    });

    it("refuses an audio format", async () => {
        await expect(render({ document: solidProject("#00ff00"), format: "wav" as never })).rejects.toThrow(RangeError);
    });
});

describe("exportAudio", () => {
    it("writes 16-bit PCM WAV by default, as long as the timeline", async () => {
        const { src, manifest } = tone(1);
        const out = await read(await exportBytes({ document: withSound(src), manifest }));

        expect(out.format).toBe(WAVE);
        expect(out.video).toBeNull();
        expect(out.audio?.codec).toBe("pcm-s16");
        expect(out.audio?.duration).toBeCloseTo(1, 2);
    });

    it("places a cue at its track's start", async () => {
        const { src, manifest } = tone(0.5);
        const out = await read(await exportBytes({ document: withSound(src, { seconds: 1, startAt: 0.5 }), manifest }));

        expect(out.audio?.duration).toBeCloseTo(1, 2);
    });

    it("writes MP3 through the LAME encoder", async () => {
        const { src, manifest } = tone(1);
        const out = await read(await exportBytes({ document: withSound(src), manifest, format: "mp3" }));

        expect(out.format).toBe(MP3);
        expect(out.audio?.codec).toBe("mp3");
        expect(out.audio?.duration).toBeCloseTo(1, 1);
    });

    it("refuses a timeline with no sound instead of writing a silent file", async () => {
        await expect(exportBytes({ document: solidProject("#00ff00") })).rejects.toBeInstanceOf(NoAudioError);
    });

    it("refuses a video format", async () => {
        await expect(exportBytes({ document: solidProject("#00ff00"), format: "mp4" as never })).rejects.toThrow(RangeError);
    });

    describe("M4A", () => {
        requireAac("exportAudio — M4A");

        it("writes AAC in an MP4 container with no video track", async () => {
            const { src, manifest } = tone(1);
            const out = await read(await exportBytes({ document: withSound(src), manifest, format: "m4a" }));

            expect(out.format).toBe(MP4);
            expect(out.video).toBeNull();
            expect(out.audio?.codec).toBe("aac");
            expect(out.audio?.duration).toBeCloseTo(1, 1);
        });
    });
});

describe("session.export — format", () => {
    it("routes an audio format to the audio export", async () => {
        const { src, manifest } = tone(1);
        const engine = await createBrowserEngine({ manifest });
        try {
            const session = engine.open({ document: withSound(src) });
            const out = await read(await session.export({ encode: { format: "wav" } }) as Uint8Array);
            session.dispose();

            expect(out.format).toBe(WAVE);
            expect(out.video).toBeNull();
        } finally {
            engine.dispose();
        }
    });

    it("writes the video format it is given", async () => {
        const engine = await createBrowserEngine({});
        try {
            const session = engine.open({ document: solidProject("#00ff00") });
            const out = await read(await session.export({ encode: { format: "webm", supersample: 1 } }) as Uint8Array);
            session.dispose();

            expect(out.format).toBe(WEBM);
        } finally {
            engine.dispose();
        }
    });
});

describe("concatVideoSegments — WebM", () => {
    const segment = (fill: string, frames: number) =>
        render({ document: solidProject(fill, frames), format: "webm" });

    it("joins WebM segments into one WebM, frames in order", async () => {
        const joined = await read(await concatVideoSegments([await segment("#ff0000", 2), await segment("#0000ff", 3)]));

        expect(joined.format).toBe(WEBM);
        expect(joined.video).toEqual({ codec: "vp9", frames: 5 });
    });

    it("muxes one Opus track over the joined timeline", async () => {
        const mixed = toneBuffer(0.5, 0.5, 2);
        const joined = await read(await concatVideoSegments([await segment("#ff0000", 2), await segment("#0000ff", 3)], { audio: mixed }));

        expect(joined.audio?.codec).toBe("opus");
        expect(joined.audio?.duration).toBeCloseTo(0.5, 1);
    });

    it("refuses to join a WebM onto an MP4", async () => {
        const mp4 = await render({ document: solidProject("#ff0000", 2) });

        await expect(concatVideoSegments([mp4, await segment("#0000ff", 2)])).rejects.toBeInstanceOf(ConcatMismatchError);
    });
});

describe("EXPORT_FORMATS", () => {
    it("names each format's kind, extension and type", () => {
        expect(EXPORT_FORMATS.webm).toMatchObject({ kind: "video", extension: "webm", mimeType: "video/webm" });
        expect(EXPORT_FORMATS.mp3).toMatchObject({ kind: "audio", extension: "mp3", mimeType: "audio/mpeg" });
        expect(EXPORT_FORMATS.m4a).toMatchObject({ kind: "audio", extension: "m4a", mimeType: "audio/mp4" });
    });
});
