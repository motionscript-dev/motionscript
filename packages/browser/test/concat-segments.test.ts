import { describe, expect, it } from "vitest";
import {
    AudioBufferSource,
    BufferSource,
    canEncodeAudio,
    BufferTarget,
    CanvasSource,
    Input,
    MP4,
    Mp4OutputFormat,
    Output,
    type VideoCodec,
} from "mediabunny";
import { ConcatMismatchError, concatVideoSegments } from "../src/concat";
import { encoderOutcome, requireAac, requireAvc } from "./encoders.fixtures";

/**
 * What `concatVideoSegments` refuses, and the options `concat.test.ts` leaves
 * out. The segments here are VP9 wherever the case is not
 * about H.264, so only the cases that need an encoder ask for one.
 */

const WIDTH = 64;
const HEIGHT = 48;
const FPS = 10;

async function encodeSolid(
    color: string,
    frames: number,
    options: { codec?: VideoCodec; width?: number; height?: number; hardwareAcceleration?: "prefer-software" | "prefer-hardware"; bitrate?: number } = {},
): Promise<Uint8Array> {
    const canvas = document.createElement("canvas");
    canvas.width = options.width ?? WIDTH;
    canvas.height = options.height ?? HEIGHT;
    const ctx = canvas.getContext("2d")!;
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new CanvasSource(canvas, {
        codec: options.codec ?? "vp9",
        bitrate: options.bitrate ?? 1_000_000,
        hardwareAcceleration: options.hardwareAcceleration ?? "prefer-software",
        keyFrameInterval: 0.2,
    });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();
    for (let i = 0; i < frames; i++) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await source.add(i / FPS, 1 / FPS);
    }
    source.close();
    await output.finalize();
    return new Uint8Array(target.buffer!);
}

/** An MP4 with an AAC track and no video. */
async function encodeAudioOnly(seconds: number): Promise<Uint8Array> {
    const rate = 44100;
    const buffer = new AudioBuffer({ length: Math.round(seconds * rate), numberOfChannels: 2, sampleRate: rate });
    for (let c = 0; c < 2; c++) buffer.getChannelData(c).fill(0.25);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new AudioBufferSource({ codec: "aac", bitrate: 128_000 });
    output.addAudioTrack(source);
    await output.start();
    await source.add(buffer);
    source.close();
    await output.finalize();
    return new Uint8Array(target.buffer!);
}

/** White noise: what an AAC bitrate shows itself in the size of. */
function noise(seconds: number): AudioBuffer {
    const rate = 44100;
    const buffer = new AudioBuffer({ length: Math.round(seconds * rate), numberOfChannels: 2, sampleRate: rate });
    let seed = 1;
    for (let c = 0; c < 2; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            data[i] = ((seed / 0xffffffff) * 2 - 1) * 0.4;
        }
    }
    return buffer;
}

async function inspect(bytes: Uint8Array) {
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
        video: video ? { codec: await video.getCodec(), frames: (await video.computePacketStats()).packetCount, duration: await video.computeDuration() } : null,
        audio: audio ? { codec: await audio.getCodec(), bitrate: (await audio.computePacketStats()).averageBitrate } : null,
    };
}

describe("concatVideoSegments — nothing to join", () => {
    it("rejects an empty list with a plain error, not a mismatch", async () => {
        const failure = await concatVideoSegments([]).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBeInstanceOf(ConcatMismatchError);
        expect((failure as Error).message).toBe("concatVideoSegments: no segments");
    });

    it("hands a lone segment back untouched when there is no audio and no sink", async () => {
        const only = await encodeSolid("#ff0000", 3);

        expect(await concatVideoSegments([only])).toBe(only);
    });
});

describe("concatVideoSegments — the segments it refuses", () => {
    it("names a segment whose decoder configuration differs in size", async () => {
        const [a, b] = await Promise.all([encodeSolid("#ff0000", 3), encodeSolid("#00ff00", 3, { width: 32, height: 24 })]);

        const failure = await concatVideoSegments([a, b]).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(ConcatMismatchError);
        expect(failure).toMatchObject({ name: "ConcatMismatchError", segment: 1 });
        expect((failure as Error).message).toMatch(/^Segment 1 was encoded differently from segment 0 \(.+ 64x48 vs .+ 32x24\); joining them would decode as garbage\.$/);
    });

    it("names the first segment that differs, not the last", async () => {
        const [a, b, c, d] = await Promise.all([
            encodeSolid("#ff0000", 2), encodeSolid("#00ff00", 2), encodeSolid("#0000ff", 2, { width: 32, height: 24 }), encodeSolid("#ffffff", 2, { width: 16, height: 16 }),
        ]);

        await expect(concatVideoSegments([a, b, c, d])).rejects.toMatchObject({ segment: 2 });
    });

    it("joins segments of one configuration", async () => {
        const [a, b] = await Promise.all([encodeSolid("#ff0000", 3), encodeSolid("#00ff00", 2)]);

        const joined = await inspect(await concatVideoSegments([a, b]));

        expect(joined.video).toMatchObject({ codec: "vp9", frames: 5 });
        expect(joined.video!.duration).toBeCloseTo(0.5, 6);
        expect(joined.audio).toBeNull();
    });

    describe("a segment with no video track", () => {
        requireAac("a segment with no video track");

        it("is named, whether first or later", async () => {
            const [video, silent] = await Promise.all([encodeSolid("#ff0000", 3), encodeAudioOnly(0.3)]);

            await expect(concatVideoSegments([video, silent])).rejects.toMatchObject({
                name: "ConcatMismatchError", segment: 1, message: "Segment 1 has no video track.",
            });
            await expect(concatVideoSegments([silent, video])).rejects.toMatchObject({ segment: 0, message: "Segment 0 has no video track." });
        });
    });

    describe("a segment encoded with another codec", () => {
        requireAvc("a segment encoded with another codec");

        it("is refused, since the container holds one decoder configuration for the track", async () => {
            const [vp9, avc] = await Promise.all([encodeSolid("#ff0000", 3), encodeSolid("#00ff00", 3, { codec: "avc" })]);

            const failure = await concatVideoSegments([vp9, avc]).catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(ConcatMismatchError);
            expect((failure as ConcatMismatchError).segment).toBe(1);
        });

        it("is refused for a different bitrate too, which the encoder puts in the codec string's level", async () => {
            const [low, high] = await Promise.all([
                encodeSolid("#ff0000", 3, { codec: "avc", bitrate: 100_000 }),
                encodeSolid("#00ff00", 3, { codec: "avc", bitrate: 80_000_000 }),
            ]);

            await expect(concatVideoSegments([low, high])).rejects.toMatchObject({ name: "ConcatMismatchError", segment: 1 });
        });

        // `sameDecoderConfig` compares the avcC bytes after the codec string, and the string already carries the
        // profile and level, so a differing description under an equal string needs two encoders that agree on
        // both and differ in their parameter sets; no pair this suite can make does.
        it.todo("refuses segments whose parameter sets differ while the codec string and the size agree");
    });
});

describe("concatVideoSegments — a lone segment that has to be muxed after all", () => {
    it("is written to the sink, positions honoured, and resolves to nothing", async () => {
        const only = await encodeSolid("#ff0000", 4);
        const chunks: { data: Uint8Array; position: number }[] = [];
        const stream = new WritableStream<{ type: "write"; data: Uint8Array; position: number }>({
            write: (chunk) => { chunks.push({ data: chunk.data.slice(), position: chunk.position }); },
        });

        const returned = await concatVideoSegments([only], { stream });

        expect(returned).toHaveLength(0);
        const size = chunks.reduce((max, c) => Math.max(max, c.position + c.data.length), 0);
        const assembled = new Uint8Array(size);
        for (const chunk of chunks) assembled.set(chunk.data, chunk.position);
        expect((await inspect(assembled)).video).toMatchObject({ codec: "vp9", frames: 4 });
    });
});

describe("concatVideoSegments — the audio it adds", () => {
    requireAac("the audio concatVideoSegments adds");

    it("takes the AAC bitrate it is given, 192 kbps when it is not", async (context) => {
        // Windows' AAC encoder (Media Foundation) stops at 192 kbps, and the test needs a rate above the default.
        const above = await canEncodeAudio("aac", { bitrate: 256_000, numberOfChannels: 2, sampleRate: 44100 });
        const outcome = encoderOutcome(above, import.meta.env.REQUIRE_ENCODERS);
        if (outcome === "fail") throw new Error("This Chromium's AAC encoder has no 256 kbps, and REQUIRE_ENCODERS=1 asks for it.");
        if (outcome === "skip") {
            console.warn("[skipped] the AAC bitrate test needs a 256 kbps AAC encoder and this Chromium has none.");
            context.skip("needs a 256 kbps AAC encoder");
        }

        const [a, b] = await Promise.all([encodeSolid("#ff0000", 10), encodeSolid("#00ff00", 10)]);
        const audio = noise(2);

        const low = await inspect(await concatVideoSegments([a, b], { audio, audioBitrate: 96_000 }));
        const high = await inspect(await concatVideoSegments([a, b], { audio, audioBitrate: 256_000 }));
        const defaulted = await inspect(await concatVideoSegments([a, b], { audio }));

        expect(high.audio!.bitrate).toBeGreaterThan(low.audio!.bitrate * 1.5);
        // 192 kbps lies between the two it was compared with.
        expect(defaulted.audio!.bitrate).toBeGreaterThan(low.audio!.bitrate);
        expect(defaulted.audio!.bitrate).toBeLessThan(high.audio!.bitrate);
    });

    it("adds the track to a lone segment too, which a segment alone would not get", async () => {
        const only = await encodeSolid("#ff0000", 5);

        const out = await inspect(await concatVideoSegments([only], { audio: noise(0.5) }));

        expect(out.audio!.codec).toBe("aac");
        expect(out.video).toMatchObject({ frames: 5 });
    });

    it("ignores a null audio, as for a timeline that makes no sound", async () => {
        const [a, b] = await Promise.all([encodeSolid("#ff0000", 3), encodeSolid("#00ff00", 3)]);

        const out = await inspect(await concatVideoSegments([a, b], { audio: null }));

        expect(out.audio).toBeNull();
    });
});
