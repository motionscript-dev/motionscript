import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEffects, ramp, type AudioRequest } from "@motionscript/core";
import { WebAudioSink } from "../src/audio/player";
import { SAMPLE_RATE, levelAt, peakBetween, playLive, request, stepBuffer, toneBuffer, urlOf } from "./audio.fixtures";

/**
 * `WebAudioSink`, the live device, rendered through an offline context.
 *
 * An `OfflineAudioContext`'s clock sits at 0 until it renders, so whatever the
 * sink started or stopped while a case drives it is what the render hears, and a
 * source stopped at 0 is silence. After a `syncTo(s)`, context time `t` is clip
 * time `s + t`.
 */

const TONE = urlOf(toneBuffer(2, 0.5));
/** Four seconds, a level per second: which one sounds says where in the source the sink started. */
const STAIRS = urlOf(stepBuffer([0.1, 0.2, 0.3, 0.4], 1));

/** The sink and its context, for a case that has to render itself. */
function make(seconds = 1, channels = 2): { sink: WebAudioSink; context: OfflineAudioContext } {
    const context = new OfflineAudioContext(channels, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    return { sink: new WebAudioSink(context as unknown as AudioContext), context };
}

async function load(sink: WebAudioSink, ...srcs: string[]): Promise<void> {
    for (const src of srcs) await sink.append(src, await (await fetch(src)).arrayBuffer());
}

const disposables: WebAudioSink[] = [];
afterEach(() => {
    while (disposables.length) disposables.pop()!.dispose();
    vi.restoreAllMocks();
});

describe("the sync window", () => {
    it("plays a request whose window holds the clip time, from the point it has reached", async () => {
        const out = await playLive(0.5, (sink) => {
            sink.schedule([request(STAIRS, { endAt: 4 })]);
            sink.syncTo(2.25);
        }, [STAIRS]);

        // 2.25 s into the source is inside the third second, at 0.3.
        expect(levelAt(out, 0.1)).toBeCloseTo(0.3, 2);
    });

    it("includes the start and excludes the end of the window", async () => {
        const at = (time: number) => playLive(0.2, (sink) => {
            sink.schedule([request(TONE, { startAt: 1, endAt: 2 })]);
            sink.syncTo(time);
        }, [TONE]);

        expect(levelAt(await at(1), 0.05)).toBeCloseTo(0.5, 2);
        expect(levelAt(await at(1.999), 0.0005)).toBeCloseTo(0.5, 2);
        expect(peakBetween(await at(2), 0, 0.2)).toBe(0);
        expect(peakBetween(await at(0.999), 0, 0.2)).toBe(0);
    });

    it("plays an open clip, whose end is Infinity, from any time after its start", async () => {
        const out = await playLive(0.2, (sink) => {
            sink.schedule([request(TONE, { startAt: 0.5, endAt: Infinity })]);
            sink.syncTo(1.5);
        }, [TONE]);

        expect(levelAt(out, 0.1)).toBeCloseTo(0.5, 2);
    });

    it("starts a clip once, however many times the window is synced", async () => {
        const out = await playLive(0.2, (sink) => {
            sink.schedule([request(TONE)]);
            sink.syncTo(0.1);
            sink.syncTo(0.2);
            sink.syncTo(0.3);
        }, [TONE]);

        // Three sources would sum to 1.5: one is 0.5.
        expect(levelAt(out, 0.1)).toBeCloseTo(0.5, 2);
    });

    it("stops a source once the clip time leaves its window", async () => {
        const out = await playLive(0.5, (sink) => {
            sink.schedule([request(TONE, { endAt: 1 })]);
            sink.syncTo(0.5);
            sink.syncTo(1.5);
        }, [TONE]);

        expect(peakBetween(out, 0, 0.5)).toBe(0);
    });

    it("skips a clip whose source is not decoded yet, and starts it when a later sync finds it", async () => {
        const { sink, context } = make(0.5);
        disposables.push(sink);
        sink.schedule([request(TONE)]);

        expect(() => sink.syncTo(0.1)).not.toThrow();
        await load(sink, TONE);
        sink.syncTo(0.1);

        expect(levelAt(await context.startRendering(), 0.1)).toBeCloseTo(0.5, 2);
    });

    it("plays two clips that overlap together", async () => {
        const out = await playLive(0.2, (sink) => {
            sink.schedule([request(TONE, { id: "a", endAt: 2 }), request(TONE, { id: "b", endAt: 2 })]);
            sink.syncTo(0.5);
        }, [TONE]);

        expect(levelAt(out, 0.1)).toBeCloseTo(1, 2);
    });
});

describe("a mid-clip offset", () => {
    it("starts trimStart plus the elapsed time into the source", async () => {
        const out = await playLive(0.3, (sink) => {
            sink.schedule([request(STAIRS, { startAt: 1, endAt: 4, trimStart: 1 })]);
            // 1 s into the clip, 1 s of trim: 2 s into the source.
            sink.syncTo(2);
        }, [STAIRS]);

        expect(levelAt(out, 0.1)).toBeCloseTo(0.3, 2);
    });

    it("scales the elapsed time by a scalar speed", async () => {
        const out = await playLive(0.3, (sink) => {
            sink.schedule([request(STAIRS, { endAt: 2, speed: 2 })]);
            // 1 s into a clip playing twice as fast is 2 s into the source.
            sink.syncTo(1);
        }, [STAIRS]);

        expect(levelAt(out, 0.1)).toBeCloseTo(0.3, 2);
    });

    it("finds the source position under a speed curve by integrating it", async () => {
        const out = await playLive(0.3, (sink) => {
            // A flat curve of 2 over the 4 s source is the same as a speed of 2.
            sink.schedule([request(STAIRS, { endAt: 2, speed: ramp(2, 2, 4) })]);
            sink.syncTo(1);
        }, [STAIRS]);

        expect(levelAt(out, 0.1)).toBeCloseTo(0.3, 2);
    });

    it("plays at the clip's rate from the point it enters, so the rest of a sped-up clip ends early", async () => {
        const out = await playLive(1, (sink) => {
            sink.schedule([request(STAIRS, { endAt: 2, speed: 2 })]);
            sink.syncTo(1);
        }, [STAIRS]);

        // From 2 s into the source at twice the rate: the third second lasts half a second, then the fourth.
        expect(levelAt(out, 0.25)).toBeCloseTo(0.3, 2);
        expect(levelAt(out, 0.75)).toBeCloseTo(0.4, 2);
    });
});

describe("schedule", () => {
    it("stops a playing source whose request is no longer scheduled", async () => {
        const out = await playLive(0.5, (sink) => {
            sink.schedule([request(TONE, { id: "a" })]);
            sink.syncTo(0.5);
            sink.schedule([]);
        }, [TONE]);

        expect(peakBetween(out, 0, 0.5)).toBe(0);
    });

    it("keeps a playing source whose request is still scheduled", async () => {
        const out = await playLive(0.5, (sink) => {
            sink.schedule([request(TONE, { id: "a" })]);
            sink.syncTo(0.5);
            sink.schedule([request(TONE, { id: "a" }), request(TONE, { id: "b", startAt: 5, endAt: 6 })]);
        }, [TONE]);

        expect(levelAt(out, 0.1)).toBeCloseTo(0.5, 2);
    });

    it("replaces the whole list and takes a copy, so editing the caller's array changes nothing", async () => {
        const out = await playLive(0.5, (sink) => {
            const list: AudioRequest[] = [request(TONE, { id: "a" })];
            sink.schedule(list);
            list.length = 0;
            sink.syncTo(0.5);
        }, [TONE]);

        expect(levelAt(out, 0.1)).toBeCloseTo(0.5, 2);
    });
});

describe("retain", () => {
    it("drops the cached buffers of sources it is not told to keep", async () => {
        const { sink } = make();
        disposables.push(sink);
        await load(sink, TONE, STAIRS);
        expect(sink.has(TONE) && sink.has(STAIRS)).toBe(true);

        sink.retain(new Set([STAIRS]));

        expect(sink.has(TONE)).toBe(false);
        expect(sink.has(STAIRS)).toBe(true);
    });

    it("stops a playing source whose src is not kept", async () => {
        const out = await playLive(0.5, (sink) => {
            sink.schedule([request(TONE, { id: "a" }), request(STAIRS, { id: "b", endAt: 4 })]);
            sink.syncTo(0.5);
            sink.retain(new Set([STAIRS]));
        }, [TONE, STAIRS]);

        // Only the stairs are left: 0.1 for the first half second, not the tone's 0.5 on top.
        expect(levelAt(out, 0.1)).toBeCloseTo(0.1, 2);
    });
});

describe("append", () => {
    it("decodes a source once, whether callers are concurrent or later", async () => {
        const { sink, context } = make();
        disposables.push(sink);
        const decode = vi.spyOn(context, "decodeAudioData");
        const bytes = () => fetch(TONE).then((r) => r.arrayBuffer());

        await Promise.all([sink.append(TONE, await bytes()), sink.append(TONE, await bytes()), sink.append(TONE, await bytes())]);
        await sink.append(TONE, await bytes());

        expect(decode).toHaveBeenCalledTimes(1);
        expect(sink.has(TONE)).toBe(true);
    });

    it("shares one decode between callers that overlap", async () => {
        const { sink, context } = make();
        disposables.push(sink);
        const decode = vi.spyOn(context, "decodeAudioData");
        const first = await (await fetch(TONE)).arrayBuffer();
        const second = first.slice(0);

        await Promise.all([sink.append(TONE, first), sink.append(TONE, second)]);

        expect(decode).toHaveBeenCalledTimes(1);
        // decodeAudioData takes the bytes: the first caller's buffer is detached, the second's is not.
        expect(first.byteLength).toBe(0);
        expect(second.byteLength).toBeGreaterThan(0);
    });

    it("reports a source it has not decoded as absent", async () => {
        const { sink } = make();
        disposables.push(sink);

        expect(sink.has(TONE)).toBe(false);
        await load(sink, TONE);
        expect(sink.has(TONE)).toBe(true);
    });

    it("rejects for bytes it cannot decode, and does not cache them", async () => {
        const { sink } = make();
        disposables.push(sink);

        await expect(sink.append("bad", new ArrayBuffer(16))).rejects.toThrow();

        expect(sink.has("bad")).toBe(false);
        // The failed decode is forgotten, so a later append may try again.
        await expect(sink.append("bad", new ArrayBuffer(16))).rejects.toThrow();
    });
});

describe("master level", () => {
    it("holds mute and volume separately, so unmuting restores the level", async () => {
        const { sink, context } = make(1);
        disposables.push(sink);
        await load(sink, TONE);
        sink.schedule([request(TONE)]);
        sink.syncTo(0);

        sink.setVolume(0.5);
        sink.setMuted(true);
        sink.setMuted(false);

        expect(levelAt(await context.startRendering(), 0.5)).toBeCloseTo(0.25, 2);
    });

    it("silences everything while muted", async () => {
        const out = await playLive(0.5, (sink) => {
            sink.schedule([request(TONE)]);
            sink.syncTo(0);
            sink.setVolume(0.5);
            sink.setMuted(true);
        }, [TONE]);

        expect(peakBetween(out, 0, 0.5)).toBe(0);
    });

    it("floors a negative volume at silence and does not cap a loud one", async () => {
        const negative = await playLive(0.3, (sink) => {
            sink.schedule([request(TONE)]);
            sink.syncTo(0);
            sink.setVolume(-3);
        }, [TONE]);
        const loud = await playLive(0.3, (sink) => {
            sink.schedule([request(TONE)]);
            sink.syncTo(0);
            sink.setVolume(2);
        }, [TONE]);

        expect(peakBetween(negative, 0, 0.3)).toBe(0);
        expect(levelAt(loud, 0.1)).toBeCloseTo(1, 2);
    });

    it("applies the master to every clip, on top of each clip's own volume", async () => {
        const out = await playLive(0.3, (sink) => {
            sink.schedule([request(TONE, { volume: 0.5 })]);
            sink.syncTo(0);
            sink.setVolume(0.5);
        }, [TONE]);

        expect(levelAt(out, 0.1)).toBeCloseTo(0.125, 2);
    });
});

describe("a clip's own chain", () => {
    it("scales by the request's volume, and plays full level for one that is not finite", async () => {
        const quiet = await playLive(0.3, (sink) => {
            sink.schedule([request(TONE, { volume: 0.4 })]);
            sink.syncTo(0);
        }, [TONE]);
        const broken = await playLive(0.3, (sink) => {
            sink.schedule([request(TONE, { volume: NaN })]);
            sink.syncTo(0);
        }, [TONE]);

        expect(levelAt(quiet, 0.1)).toBeCloseTo(0.2, 2);
        expect(levelAt(broken, 0.1)).toBeCloseTo(0.5, 2);
    });

    it("builds the clip's effects between the source and its volume", async () => {
        const out = await playLive(0.3, (sink) => {
            sink.schedule([request(TONE, { volume: 0.5, effects: [...AudioEffects.gain(0.5)] })]);
            sink.syncTo(0);
        }, [TONE]);

        expect(levelAt(out, 0.1)).toBeCloseTo(0.125, 2);
    });

    it("runs a ramp-valued effect over the clip's length", async () => {
        const out = await playLive(0.5, (sink) => {
            // A fade over the whole 2 s clip, entered at 1 s: half-way up and still rising.
            sink.schedule([request(TONE, { effects: [...AudioEffects.gain(ramp(0, 1, 2))] })]);
            sink.syncTo(1);
        }, [TONE]);

        expect(levelAt(out, 0)).toBeCloseTo(0.25, 1);
        expect(levelAt(out, 0.4)).toBeCloseTo(0.35, 1);
    });

    it("falls back to the source length for an open clip, so a curve still resolves", async () => {
        const out = await playLive(1.5, (sink) => {
            // No end: the length the curve runs over is the 2 s source.
            sink.schedule([request(TONE, { endAt: Infinity, effects: [...AudioEffects.gain(ramp(0, 1, 2))] })]);
            sink.syncTo(0);
        }, [TONE]);

        expect(levelAt(out, 1)).toBeCloseTo(0.25, 1);
    });
});

describe("play and stop", () => {
    it("resumes a suspended context, then syncs to the time it was given", async () => {
        const { sink, context } = make(0.3);
        disposables.push(sink);
        await load(sink, STAIRS);
        sink.schedule([request(STAIRS, { endAt: 4 })]);
        const resume = vi.spyOn(context, "resume").mockResolvedValue(undefined);

        await sink.play(3, 1, false);

        expect(resume).toHaveBeenCalledTimes(1);
        expect(levelAt(await context.startRendering(), 0.1)).toBeCloseTo(0.4, 2);
    });

    it("does not resume a context that is running", async () => {
        const { sink, context } = make(0.3);
        disposables.push(sink);
        await load(sink, TONE);
        sink.schedule([request(TONE)]);
        Object.defineProperty(context, "state", { value: "running", configurable: true });
        const resume = vi.spyOn(context, "resume").mockResolvedValue(undefined);

        await sink.play(0, 1, false);

        expect(resume).not.toHaveBeenCalled();
    });

    it("stops every source and keeps the cache and the schedule, so the next sync plays again", async () => {
        const { sink, context } = make(0.5);
        disposables.push(sink);
        await load(sink, TONE);
        sink.schedule([request(TONE)]);
        sink.syncTo(0);

        sink.stop();

        expect(sink.has(TONE)).toBe(true);
        sink.syncTo(0.1);
        expect(levelAt(await context.startRendering(), 0.1)).toBeCloseTo(0.5, 2);
    });

    it("leaves nothing sounding after a stop", async () => {
        const out = await playLive(0.5, (sink) => {
            sink.schedule([request(TONE)]);
            sink.syncTo(0);
            sink.stop();
        }, [TONE]);

        expect(peakBetween(out, 0, 0.5)).toBe(0);
    });

    it("resumes a suspended context from unlock, and leaves a running one alone", () => {
        const { sink, context } = make();
        disposables.push(sink);
        const resume = vi.spyOn(context, "resume").mockResolvedValue(undefined);

        sink.unlock();
        expect(resume).toHaveBeenCalledTimes(1);

        Object.defineProperty(context, "state", { value: "running", configurable: true });
        sink.unlock();
        expect(resume).toHaveBeenCalledTimes(1);
    });
});

describe("the context", () => {
    it("hands back the context it was given", () => {
        const { sink, context } = make();
        disposables.push(sink);

        expect(sink.getContext()).toBe(context);
    });

    it("makes none until something needs one, and closes nothing it never made", () => {
        const made = vi.spyOn(globalThis, "AudioContext");
        const sink = new WebAudioSink();
        sink.setVolume(0.5);
        sink.setMuted(true);
        sink.schedule([]);
        sink.syncTo(1);
        sink.stop();
        sink.dispose();

        expect(made).not.toHaveBeenCalled();
        made.mockRestore();
    });

    it("applies the mute and volume set before its context existed", () => {
        const owned = new WebAudioSink();
        owned.setVolume(0.25);
        const context = owned.getContext();
        const gain = vi.spyOn(context, "createGain");
        owned.setMuted(false);
        // The master gain is built with the first sound; reach it the way a clip does.
        const master = (owned as unknown as { graph: { master: GainNode } }).graph.master;

        expect(gain).toHaveBeenCalled();
        expect(master.gain.value).toBeCloseTo(0.25, 6);
        owned.dispose();
    });

    it("makes its own when it is given none, and closes only that one on dispose", () => {
        const owned = new WebAudioSink();
        const close = vi.spyOn(owned.getContext(), "close");

        owned.dispose();
        owned.dispose();

        expect(close).toHaveBeenCalledTimes(1);
    });

    it("leaves a context it was handed open on dispose", () => {
        const { sink, context } = make();
        // An offline context has no `close`; a stand-in says whether the sink asked for one.
        const close = vi.fn();
        Object.defineProperty(context, "close", { value: close, configurable: true });

        sink.dispose();

        expect(close).not.toHaveBeenCalled();
    });
});

describe("dispose", () => {
    it("is safe twice, and drops the cache", async () => {
        const { sink } = make();
        await load(sink, TONE);

        sink.dispose();
        expect(() => sink.dispose()).not.toThrow();

        expect(sink.has(TONE)).toBe(false);
    });

    it("leaves nothing sounding", async () => {
        const { sink, context } = make(0.5);
        await load(sink, TONE);
        sink.schedule([request(TONE)]);
        sink.syncTo(0);

        sink.dispose();

        expect(peakBetween(await context.startRendering(), 0, 0.5)).toBe(0);
    });
});
