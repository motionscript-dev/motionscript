import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEffects, ManifestAssetCatalog, ramp, type AssetManifest } from "@motionscript/core";
import { setAssetByteSource } from "../src/asset-bytes";
import { DEFAULT_SAMPLE_RATE, WebAudioMixer, mixAudio } from "../src/audio/mixer";
import { SAMPLE_RATE, levelAt, request, scheduled, sineBuffer, stepBuffer, toneBuffer, urlOf } from "./audio.fixtures";

/**
 * `mixAudio`'s options, one at a time, each against a source whose level says
 * which part of it sounded and where.
 *
 * Sources are blob URLs, and the addresses the mix asked for are read off `fetch`,
 * which is also what shows a catalog's resolution at work.
 */

let fetched: string[];

beforeEach(() => {
    fetched = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        fetched.push(input instanceof Request ? input.url : String(input));
        return real(input, init);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    setAssetByteSource(null);
});

async function mix(
    requests: ReturnType<typeof scheduled>[],
    seconds: number,
    options: Parameters<typeof mixAudio>[2] = {},
): Promise<AudioBuffer> {
    const out = await mixAudio(requests, seconds, { sampleRate: SAMPLE_RATE, ...options });
    if (!out) throw new Error("nothing was mixed");
    return out;
}

const TONE = urlOf(toneBuffer(2, 0.5));
/** Two seconds of source: 0.2 for the first second, 0.6 for the second. */
const STEPS = urlOf(stepBuffer([0.2, 0.6], 1));

describe("mixAudio — what it returns", () => {
    it("is null for no requests", async () => {
        expect(await mixAudio([], 2)).toBeNull();
    });

    it("is null for a duration that has no frames", async () => {
        expect(await mixAudio([scheduled(request(TONE))], 0)).toBeNull();
        expect(await mixAudio([scheduled(request(TONE))], -3)).toBeNull();
        expect(fetched).toEqual([]);
    });

    it("is a stereo buffer of the timeline's length at the sample rate asked for", async () => {
        const out = await mix([scheduled(request(TONE))], 1.5, { sampleRate: 22050 });

        expect(out.numberOfChannels).toBe(2);
        expect(out.sampleRate).toBe(22050);
        expect(out.length).toBe(Math.ceil(1.5 * 22050));
    });

    it("mixes at 44.1 kHz when no rate is given", async () => {
        const out = await mixAudio([scheduled(request(TONE))], 0.5);

        expect(DEFAULT_SAMPLE_RATE).toBe(44100);
        expect(out!.sampleRate).toBe(44100);
        expect(out!.length).toBe(Math.ceil(0.5 * 44100));
    });
});

describe("mixAudio — where a clip sits", () => {
    it("starts a clip at its track's offset plus its own start", async () => {
        const out = await mix([scheduled(request(TONE, { startAt: 0.5, endAt: 1.5 }), 1)], 3);

        expect(levelAt(out, 1.25)).toBeCloseTo(0, 2);
        expect(levelAt(out, 1.75)).toBeCloseTo(0.5, 2);
        expect(levelAt(out, 2.25)).toBeCloseTo(0.5, 2);
        expect(levelAt(out, 2.75)).toBeCloseTo(0, 2);
    });

    it("cuts a clip that outlasts the timeline at the timeline's end", async () => {
        const out = await mix([scheduled(request(TONE, { endAt: 10 }))], 1);

        expect(out.length).toBe(SAMPLE_RATE);
        expect(levelAt(out, 0.95)).toBeCloseTo(0.5, 2);
    });

    it("bounds an open clip by the timeline, since its end is Infinity", async () => {
        const out = await mix([scheduled(request(TONE, { endAt: Infinity }))], 1.5);

        expect(levelAt(out, 1.4)).toBeCloseTo(0.5, 2);
    });

    it("skips a clip that starts at or after the end, or that ends before it starts", async () => {
        const out = await mix([
            scheduled(request(TONE, { id: "late", startAt: 2, endAt: 3 })),
            scheduled(request(TONE, { id: "backwards", startAt: 1.5, endAt: 1 })),
            scheduled(request(TONE, { id: "empty", startAt: 0.5, endAt: 0.5 })),
        ], 2);

        expect(out.length).toBe(2 * SAMPLE_RATE);
        expect(levelAt(out, 0.75)).toBe(0);
        expect(levelAt(out, 1.25)).toBe(0);
        expect(levelAt(out, 1.75)).toBe(0);
    });

    it("sums clips that overlap", async () => {
        const out = await mix([
            scheduled(request(urlOf(toneBuffer(1, 0.2)), { id: "a", endAt: 1 })),
            scheduled(request(urlOf(toneBuffer(1, 0.3)), { id: "b", endAt: 1 })),
        ], 1);

        expect(levelAt(out, 0.5)).toBeCloseTo(0.5, 2);
    });
});

describe("mixAudio — what part of a source plays", () => {
    it("starts at trimStart", async () => {
        const out = await mix([scheduled(request(STEPS, { trimStart: 1, endAt: 1 }))], 1);

        expect(levelAt(out, 0.1)).toBeCloseTo(0.6, 2);
        expect(levelAt(out, 0.9)).toBeCloseTo(0.6, 2);
    });

    it("plays from the start of the source and cuts it where the clip ends", async () => {
        const out = await mix([scheduled(request(STEPS, { endAt: 1.5 }))], 2);

        expect(levelAt(out, 0.5)).toBeCloseTo(0.2, 2);
        expect(levelAt(out, 1.25)).toBeCloseTo(0.6, 2);
        expect(levelAt(out, 1.75)).toBe(0);
    });

    it("plays a source that is shorter than its clip once, then goes quiet", async () => {
        const out = await mix([scheduled(request(urlOf(toneBuffer(0.5, 0.5)), { endAt: 2 }))], 2);

        expect(levelAt(out, 0.25)).toBeCloseTo(0.5, 2);
        expect(levelAt(out, 1)).toBe(0);
    });

    it("repeats the source when it loops", async () => {
        const out = await mix([scheduled(request(urlOf(stepBuffer([0.2, 0.6], 0.5)), { loop: true, endAt: 3 }))], 3);

        expect(levelAt(out, 0.25)).toBeCloseTo(0.2, 2);
        expect(levelAt(out, 0.75)).toBeCloseTo(0.6, 2);
        expect(levelAt(out, 1.25)).toBeCloseTo(0.2, 2);
        expect(levelAt(out, 2.75)).toBeCloseTo(0.6, 2);
    });

    it("plays a source twice as fast at a speed of 2, which also halves its length", async () => {
        const out = await mix([scheduled(request(STEPS, { endAt: 2, speed: 2 }))], 2);

        expect(levelAt(out, 0.25)).toBeCloseTo(0.2, 2);
        expect(levelAt(out, 0.75)).toBeCloseTo(0.6, 2);
        expect(levelAt(out, 1.25)).toBe(0);
    });

    it("plays it at half speed at a speed of 0.5", async () => {
        const out = await mix([scheduled(request(STEPS, { endAt: 4, speed: 0.5 }))], 4);

        expect(levelAt(out, 1.9)).toBeCloseTo(0.2, 2);
        expect(levelAt(out, 2.1)).toBeCloseTo(0.6, 2);
    });

    it("follows a speed curve, which a flat one makes the same as the scalar", async () => {
        const out = await mix([scheduled(request(STEPS, { endAt: 2, speed: ramp(2, 2, 2) }))], 2);

        expect(levelAt(out, 0.4)).toBeCloseTo(0.2, 2);
        expect(levelAt(out, 0.6)).toBeCloseTo(0.6, 2);
        expect(levelAt(out, 1.1)).toBe(0);
    });

});

describe("mixAudio — transitions", () => {
    /** The RMS over a short window: what a listener hears as loudness, whatever the two tones' phases. */
    function rmsAt(buffer: AudioBuffer, t: number, span = 0.05): number {
        const data = buffer.getChannelData(0);
        const from = Math.floor(t * buffer.sampleRate);
        const to = Math.min(data.length, from + Math.floor(span * buffer.sampleRate));
        let sum = 0;
        for (let i = from; i < to; i++) sum += data[i] * data[i];
        return Math.sqrt(sum / Math.max(1, to - from));
    }

    const linear = { kind: "linear" } as const;

    it("fades a clip in over its first seconds and out over its last", async () => {
        const out = await mix([scheduled(request(TONE, {
            endAt: 2, transitionIn: { duration: 1, curve: linear }, transitionOut: { duration: 0.5, curve: linear },
        }))], 2);

        expect(levelAt(out, 0)).toBeLessThan(0.02);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.25, 1);
        expect(levelAt(out, 1.2)).toBeCloseTo(0.5, 2);
        expect(levelAt(out, 1.75)).toBeCloseTo(0.25, 1);
    });

    it("multiplies a transition on top of the clip's volume ramp", async () => {
        const out = await mix([scheduled(request(TONE, {
            endAt: 2, volume: 0.5, transitionIn: { duration: 1, curve: linear },
        }))], 2);

        expect(levelAt(out, 0.5)).toBeCloseTo(0.125, 1);
        expect(levelAt(out, 1.5)).toBeCloseTo(0.25, 2);
    });

    it("holds the loudness steady through an equal-power cross-fade of two overlapping clips", async () => {
        // A out over 1–2 s, B in over the same second: two unrelated tones, so power adds.
        const a = urlOf(sineBuffer(2, 440, 0.5));
        const b = urlOf(sineBuffer(2, 660, 0.5));
        const out = await mix([
            scheduled(request(a, { id: "a", startAt: 0, endAt: 2, transitionOut: { duration: 1 } })),
            scheduled(request(b, { id: "b", startAt: 1, endAt: 3, transitionIn: { duration: 1 } })),
        ], 3);

        const steady = rmsAt(out, 0.5);
        for (const t of [1.1, 1.3, 1.5, 1.7, 1.9]) expect(rmsAt(out, t) / steady).toBeCloseTo(1, 1);
    });

    it("dips in the middle of a linear cross-fade, which is why equal power is the default", async () => {
        const a = urlOf(sineBuffer(2, 440, 0.5));
        const b = urlOf(sineBuffer(2, 660, 0.5));
        const out = await mix([
            scheduled(request(a, { id: "a", startAt: 0, endAt: 2, transitionOut: { duration: 1, curve: linear } })),
            scheduled(request(b, { id: "b", startAt: 1, endAt: 3, transitionIn: { duration: 1, curve: linear } })),
        ], 3);

        expect(rmsAt(out, 1.475) / rmsAt(out, 0.5)).toBeCloseTo(Math.SQRT1_2, 1);
    });
});

describe("mixAudio — gain", () => {
    it("scales a clip by its own volume", async () => {
        const out = await mix([scheduled(request(TONE, { endAt: 1, volume: 0.5 }))], 1);

        expect(levelAt(out, 0.5)).toBeCloseTo(0.25, 2);
    });

    it("gives each request its own volume", async () => {
        const out = await mix([
            scheduled(request(TONE, { id: "quiet", endAt: 1, volume: 0.2 })),
            scheduled(request(TONE, { id: "loud", startAt: 1, endAt: 2, volume: 1 })),
        ], 2);

        expect(levelAt(out, 0.5)).toBeCloseTo(0.1, 2);
        expect(levelAt(out, 1.5)).toBeCloseTo(0.5, 2);
    });

    it("plays a volume that is not a number at full level", async () => {
        const out = await mix([scheduled(request(TONE, { endAt: 1, volume: NaN }))], 1);

        expect(levelAt(out, 0.5)).toBeCloseTo(0.5, 2);
    });

    it("applies the clip's effects and its volume together", async () => {
        const out = await mix([scheduled(request(TONE, { endAt: 1, volume: 0.5, effects: [...AudioEffects.gain(0.5)] }))], 1);

        expect(levelAt(out, 0.5)).toBeCloseTo(0.125, 2);
    });
});

describe("mixAudio — where a source is fetched from", () => {
    const manifest = (over: Partial<AssetManifest>): AssetManifest => ({ image: {}, video: {}, audio: {}, font: {}, ...over });

    it("fetches a source once however many requests name it", async () => {
        await mix([
            scheduled(request(TONE, { id: "a", endAt: 1 })),
            scheduled(request(TONE, { id: "b", startAt: 1, endAt: 2 })),
            scheduled(request(TONE, { id: "c", startAt: 2, endAt: 3 }), 1),
        ], 4);

        expect(fetched).toEqual([TONE]);
    });

    it("fetches each distinct source", async () => {
        await mix([
            scheduled(request(TONE, { id: "a", endAt: 1 })),
            scheduled(request(STEPS, { id: "b", endAt: 1 })),
        ], 1);

        expect([...fetched].sort()).toEqual([STEPS, TONE].sort());
    });

    it("fetches at the address the catalog's audio entry gives", async () => {
        const catalog = new ManifestAssetCatalog(manifest({ audio: { music: { src: TONE, duration: 2, sizeBytes: 0 } } }));

        const out = await mix([scheduled(request("music", { endAt: 1 }))], 1, { catalog });

        expect(fetched).toEqual([TONE]);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.5, 2);
    });

    it("falls back to the video entry, whose own soundtrack is requested under the video's key", async () => {
        const catalog = new ManifestAssetCatalog(manifest({
            video: { clip: { src: TONE, width: 4, height: 4, duration: 2, sizeBytes: 0 } },
        }));

        await mix([scheduled(request("clip", { endAt: 1 }))], 1, { catalog });

        expect(fetched).toEqual([TONE]);
    });

    it("prefers the audio entry when a key is in both", async () => {
        const catalog = new ManifestAssetCatalog(manifest({
            audio: { both: { src: TONE, duration: 2, sizeBytes: 0 } },
            video: { both: { src: STEPS, width: 4, height: 4, duration: 2, sizeBytes: 0 } },
        }));

        await mix([scheduled(request("both", { endAt: 1 }))], 1, { catalog });

        expect(fetched).toEqual([TONE]);
    });

    it("fetches a source the catalog does not know as it is written", async () => {
        const catalog = new ManifestAssetCatalog(manifest({}));

        await mix([scheduled(request(TONE, { endAt: 1 }))], 1, { catalog });

        expect(fetched).toEqual([TONE]);
    });

    it("fetches an entry with no address as it is written too", async () => {
        const catalog = new ManifestAssetCatalog(manifest({ audio: { [TONE]: { src: "", duration: 2, sizeBytes: 0 } } }));

        await mix([scheduled(request(TONE, { endAt: 1 }))], 1, { catalog });

        expect(fetched).toEqual([TONE]);
    });

    it("asks the host's byte source before the network, as every other audio read does", async () => {
        const held = new Blob([await (await fetch(TONE)).arrayBuffer()], { type: "audio/wav" });
        fetched.length = 0;
        setAssetByteSource(async (src) => (src === "held/tone.wav" ? held : null));

        const out = await mix([scheduled(request("held/tone.wav", { endAt: 1 }))], 1);

        expect(fetched).toEqual([]);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.5, 2);
    });

    it("asks the byte source with the address the catalog resolves, as the adapter does", async () => {
        const held = new Blob([await (await fetch(TONE)).arrayBuffer()], { type: "audio/wav" });
        fetched.length = 0;
        const asked: string[] = [];
        setAssetByteSource(async (src) => {
            asked.push(src);
            return src === "https://cdn.test/music.wav?token=t" ? held : null;
        });
        const catalog = new ManifestAssetCatalog(manifest({
            audio: { music: { src: "https://cdn.test/music.wav?token=t", duration: 2, sizeBytes: 0 } },
        }));

        const out = await mix([scheduled(request("music", { endAt: 1 }))], 1, { catalog });

        expect(asked).toEqual(["https://cdn.test/music.wav?token=t"]);
        expect(fetched).toEqual([]);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.5, 2);
    });

    it("falls through to the network when the byte source has nothing", async () => {
        setAssetByteSource(async () => null);

        await mix([scheduled(request(TONE, { endAt: 1 }))], 1);

        expect(fetched).toEqual([TONE]);
    });
});

describe("WebAudioMixer", () => {
    it("mixes through mixAudio at the sample rate it was built with", async () => {
        const out = await new WebAudioMixer(22050).mix([scheduled(request(TONE, { endAt: 1 }))], 1);

        expect(out!.sampleRate).toBe(22050);
        expect(out!.length).toBe(22050);
        expect(levelAt(out!, 0.5)).toBeCloseTo(0.5, 2);
    });

    it("mixes at 44.1 kHz by default", async () => {
        const out = await new WebAudioMixer().mix([scheduled(request(TONE, { endAt: 1 }))], 1);

        expect(out!.sampleRate).toBe(DEFAULT_SAMPLE_RATE);
    });

    it("resolves a source through the catalog it was built with", async () => {
        const catalog = new ManifestAssetCatalog({
            image: {}, video: {}, font: {},
            audio: { music: { src: TONE, duration: 2, sizeBytes: 0 } },
        });

        await new WebAudioMixer(SAMPLE_RATE, catalog).mix([scheduled(request("music", { endAt: 1 }))], 1);

        expect(fetched).toEqual([TONE]);
    });

    it("answers null where mixAudio does", async () => {
        expect(await new WebAudioMixer().mix([], 3)).toBeNull();
    });
});

describe("mixAudio — a source that holds no audio", () => {
    /** Bytes no decoder takes for sound, which is what a video with no audio track is to `decodeAudioData`. */
    const SILENT = URL.createObjectURL(new Blob([new Uint8Array(64)], { type: "video/mp4" }));

    it("leaves an optional request out when its source holds no audio, and mixes the rest", async () => {
        const out = await mix([scheduled(request(SILENT, { optional: true })), scheduled(request(TONE))], 1);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.5, 2);
    });

    it("renders silence when a picture's own sound is all there was", async () => {
        const out = await mix([scheduled(request(SILENT, { optional: true }))], 1);
        expect(levelAt(out, 0.5)).toBe(0);
    });

    it("still fails for a request that asked for that sound, alone or beside an optional one", async () => {
        const options = { sampleRate: SAMPLE_RATE };
        await expect(mixAudio([scheduled(request(SILENT))], 1, options)).rejects.toBeDefined();
        await expect(
            mixAudio([scheduled(request(SILENT, { optional: true })), scheduled(request(SILENT))], 1, options),
        ).rejects.toBeDefined();
    });
});
