import { describe, it, expect, beforeAll } from "vitest";
import { AudioEffects, hold, ramp, type AudioBusStop, type AudioRequest } from "@motionscript/core";
import type { ScheduledAudioRequest } from "../src/frame-loop";
import { encodeWav, mixAudio } from "../src/audio/mixer";
import { WebAudioSink } from "../src/audio/player";

/**
 * Buses, through the offline mixer.
 *
 * The mixer is the honest place to pin them: it is a real Web Audio graph
 * rendered to samples, so what these assert is what a viewer hears — and unlike
 * the live device it needs no user gesture and is deterministic.
 *
 * The property under test throughout is that a bus is a *shared* chain. Two
 * clips naming one bus reach the same nodes, which is what makes a bus gain one
 * edit and a bus effect one tail. Flattening the gain into per-clip processing
 * would pass the level tests here and fail the echo one.
 *
 * The live device is pinned the same way, rendered through an offline context
 * (`playLive`), and held to what the mixer gives for the same request.
 */

const SAMPLE_RATE = 44100;

/** A constant-amplitude mono tone, as a WAV blob URL. */
function makeTone(seconds: number, amplitude: number): string {
    const frames = Math.round(seconds * SAMPLE_RATE);
    const ctx = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const buffer = ctx.createBuffer(1, frames, SAMPLE_RATE);
    buffer.getChannelData(0).fill(amplitude);
    return URL.createObjectURL(new Blob([encodeWav(buffer)], { type: "audio/wav" }));
}

function peakBetween(buffer: AudioBuffer, from: number, to: number): number {
    const start = Math.floor(from * buffer.sampleRate);
    const end = Math.min(Math.floor(to * buffer.sampleRate), buffer.length);
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    return peak;
}

/** The level of a constant tone around `t`: its peak over the next 10 ms. */
const levelAt = (buffer: AudioBuffer, t: number): number => peakBetween(buffer, t, t + 0.01);

const bus = (id: string, over: Partial<AudioBusStop> = {}): AudioBusStop =>
    ({ id, volume: 1, pan: 0, mute: false, startAt: 0, endAt: 2, ...over });

function clip(src: string, over: Partial<AudioRequest> = {}): AudioRequest {
    return {
        id: over.id ?? `${src}|${over.startAt ?? 0}`,
        src, startAt: 0, endAt: 2, trimStart: 0, volume: 1, loop: false,
        ...over,
    };
}

function request(src: string, over: Partial<AudioRequest> = {}, globalOffset = 0): ScheduledAudioRequest {
    return { request: clip(src, over), globalOffset };
}

/**
 * What the live device plays, rendered rather than heard.
 *
 * An `OfflineAudioContext` stands in for the device's context. Its clock sits at
 * 0 until it renders, so after a `syncTo(s)` in `drive`, context time `t` in the
 * result is clip time `s + t`: a seek that lands at `s` and plays on.
 */
async function playLive(
    seconds: number,
    drive: (sink: WebAudioSink) => void,
    srcs: readonly string[],
): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    const sink = new WebAudioSink(ctx as unknown as AudioContext);
    for (const src of new Set(srcs)) await sink.append(src, await (await fetch(src)).arrayBuffer());
    drive(sink);
    return ctx.startRendering();
}

let tone: string;
beforeAll(() => { tone = makeTone(2, 0.5); });

describe("bus levels", () => {
    it("scales a clip by its bus's gain", async () => {
        const plain = await mixAudio([request(tone)], 2, { sampleRate: SAMPLE_RATE });
        const bussed = await mixAudio(
            [request(tone, { bus: [bus("music", { volume: 0.5 })] })], 2, { sampleRate: SAMPLE_RATE },
        );

        expect(peakBetween(plain!, 0.5, 1.5)).toBeCloseTo(0.5, 2);
        expect(peakBetween(bussed!, 0.5, 1.5)).toBeCloseTo(0.25, 2);
    });

    it("multiplies down a chain of buses, source-adjacent first", async () => {
        const mixed = await mixAudio(
            [request(tone, { bus: [bus("dialogue", { volume: 0.5 }), bus("master", { volume: 0.5 })] })],
            2, { sampleRate: SAMPLE_RATE },
        );
        expect(peakBetween(mixed!, 0.5, 1.5)).toBeCloseTo(0.125, 2);
    });

    it("silences everything under a muted bus", async () => {
        const mixed = await mixAudio(
            [
                request(tone, { id: "a", bus: [bus("sfx", { mute: true })] }),
                request(tone, { id: "b", bus: [bus("sfx", { mute: true })] }),
            ],
            2, { sampleRate: SAMPLE_RATE },
        );
        expect(peakBetween(mixed!, 0.5, 1.5)).toBeCloseTo(0, 3);
    });

    it("leaves a clip with no bus alone", async () => {
        const mixed = await mixAudio([request(tone)], 2, { sampleRate: SAMPLE_RATE });
        expect(peakBetween(mixed!, 0.5, 1.5)).toBeCloseTo(0.5, 2);
    });
});

describe("a bus is one shared chain", () => {
    it("applies a group gain once to every clip on it", async () => {
        const mixed = await mixAudio(
            [
                request(tone, { id: "a", bus: [bus("music", { volume: 0.5 })] }),
                request(tone, { id: "b", bus: [bus("music", { volume: 0.5 })] }),
            ],
            2, { sampleRate: SAMPLE_RATE },
        );
        // Two 0.5 tones at 0.5 bus gain sum to 0.5, not 0.25 or 1.
        expect(peakBetween(mixed!, 0.5, 1.5)).toBeCloseTo(0.5, 2);
    });

    it("routes two clips to independent buses independently", async () => {
        const mixed = await mixAudio(
            [
                request(tone, { id: "a", bus: [bus("loud", { volume: 1 })] }),
                request(tone, { id: "b", bus: [bus("quiet", { volume: 0 })] }),
            ],
            2, { sampleRate: SAMPLE_RATE },
        );
        expect(peakBetween(mixed!, 0.5, 1.5)).toBeCloseTo(0.5, 2);
    });

    it("gives a bus effect one tail, not one per clip", async () => {
        // A 1s clip into a bus carrying a 0.5s echo. Past the source's end only
        // the echo sounds, and its level is what distinguishes a shared tail from
        // two stacked copies of it.
        const short = makeTone(1, 0.5);
        const echo = AudioEffects.echo({ delay: 0.5, feedback: 0, mix: 1 });

        const one = await mixAudio(
            [request(short, { id: "a", endAt: 1, bus: [bus("verb", { effects: [...echo] })] })],
            2, { sampleRate: SAMPLE_RATE },
        );
        const two = await mixAudio(
            [
                request(short, { id: "a", endAt: 1, bus: [bus("verb", { effects: [...echo] })] }),
                request(short, { id: "b", endAt: 1, bus: [bus("verb", { effects: [...echo] })] }),
            ],
            2, { sampleRate: SAMPLE_RATE },
        );

        const tailOne = peakBetween(one!, 1.1, 1.4);
        const tailTwo = peakBetween(two!, 1.1, 1.4);
        expect(tailOne).toBeGreaterThan(0.1);
        // Two clips into one shared tail is twice the signal, not four times —
        // which is what a per-clip echo of a doubled source would give.
        expect(tailTwo).toBeCloseTo(tailOne * 2, 1);
    });
});

/**
 * A curve on a bus runs over the bus's own presence span — `startAt` to
 * `endAt` on the stop, in the request's seconds — the way a curve on a clip runs
 * over the clip's. Not over a clip's: a bus outlives the clips that feed it, and
 * one curve has to mean one thing to all of them.
 */
describe("bus curves", () => {
    const mix = (requests: ScheduledAudioRequest[], seconds: number) =>
        mixAudio(requests, seconds, { sampleRate: SAMPLE_RATE }).then((b) => b!);

    it("fades a bus in from its start", async () => {
        // `.hold()` keeps the fade at the start: a curve's last segment lands on the end.
        const mixed = await mix([request(tone, { bus: [bus("dialogue", { effects: [...AudioEffects.gain(ramp(0, 1, 1).hold())] })] })], 2);
        expect(levelAt(mixed, 0)).toBeLessThan(0.02);
        expect(levelAt(mixed, 0.5)).toBeCloseTo(0.25, 1);
        expect(levelAt(mixed, 1.5)).toBeCloseTo(0.5, 2);
    });

    it("fades a bus out at its end", async () => {
        const mixed = await mix([request(tone, { bus: [bus("dialogue", { effects: [...AudioEffects.gain(hold().ramp(1, 0, 1))] })] })], 2);
        expect(levelAt(mixed, 0.5)).toBeCloseTo(0.5, 2);
        expect(levelAt(mixed, 1.5)).toBeCloseTo(0.25, 1);
        expect(levelAt(mixed, 1.98)).toBeLessThan(0.02);
    });

    it("schedules a curve-valued bus volume", async () => {
        const mixed = await mix([request(tone, { bus: [bus("dialogue", { volume: hold().ramp(1, 0, 1) })] })], 2);
        expect(levelAt(mixed, 0.5)).toBeCloseTo(0.5, 2);
        expect(levelAt(mixed, 1.5)).toBeCloseTo(0.25, 1);
        expect(levelAt(mixed, 1.98)).toBeLessThan(0.02);
    });

    it("anchors to the bus's span, not to the clip that feeds it", async () => {
        // The bus ramps up over [0, 4); the clip enters halfway through it.
        const swell = bus("music", { endAt: 4, effects: [...AudioEffects.gain(ramp(0, 1, 4))] });
        const mixed = await mix([request(tone, { startAt: 2, endAt: 4, bus: [swell] })], 4);
        expect(levelAt(mixed, 2)).toBeCloseTo(0.25, 1);
        expect(levelAt(mixed, 3)).toBeCloseTo(0.375, 1);
    });

    it("anchors in project time, by its track's offset", async () => {
        const fading = bus("dialogue", { effects: [...AudioEffects.gain(ramp(0, 1, 1).hold())] });
        const mixed = await mix([request(tone, { bus: [fading] }, 1)], 3);
        expect(levelAt(mixed, 1)).toBeLessThan(0.02);
        expect(levelAt(mixed, 1.5)).toBeCloseTo(0.25, 1);
        expect(levelAt(mixed, 2.5)).toBeCloseTo(0.5, 2);
    });

    it("plays each clip through the bus it declared, not the first one to name it", async () => {
        const mixed = await mix([
            request(tone, { id: "a", endAt: 1, bus: [bus("music", { volume: 1 })] }),
            request(tone, { id: "b", startAt: 1, endAt: 2, bus: [bus("music", { volume: 0.25 })] }),
        ], 2);
        expect(levelAt(mixed, 0.5)).toBeCloseTo(0.5, 2);
        expect(levelAt(mixed, 1.5)).toBeCloseTo(0.125, 2);
    });
});

describe("the live device's buses", () => {
    it("fades a bus from where a seek lands, as the mix does", async () => {
        const fading = bus("dialogue", { effects: [...AudioEffects.gain(hold().ramp(1, 0, 1))] });
        const req = clip(tone, { bus: [fading] });
        const mixed = await mixAudio([{ request: req, globalOffset: 0 }], 2, { sampleRate: SAMPLE_RATE });
        const live = await playLive(1, (sink) => {
            sink.schedule([req]);
            sink.syncTo(1);
        }, [tone]);

        // Live context time t is clip time 1 + t.
        for (const t of [0.05, 0.5, 0.9]) {
            expect(levelAt(live, t)).toBeCloseTo(levelAt(mixed!, 1 + t), 2);
        }
        expect(levelAt(live, 0.5)).toBeCloseTo(0.25, 1);
    });

    it("anchors a bus a clip enters partway through, as the mix does", async () => {
        const swell = bus("music", { endAt: 4, effects: [...AudioEffects.gain(ramp(0, 1, 4))] });
        const req = clip(tone, { startAt: 2, endAt: 4, bus: [swell] });
        const mixed = await mixAudio([{ request: req, globalOffset: 0 }], 4, { sampleRate: SAMPLE_RATE });
        const live = await playLive(2, (sink) => {
            sink.schedule([req]);
            sink.syncTo(2);
        }, [tone]);

        for (const t of [0.05, 1, 1.9]) {
            expect(levelAt(live, t)).toBeCloseTo(levelAt(mixed!, 2 + t), 2);
        }
        expect(levelAt(live, 1)).toBeCloseTo(0.375, 1);
    });

    it("picks a clip's own ramp up where a seek lands inside it", async () => {
        const req = clip(tone, { effects: [...AudioEffects.gain(ramp(0, 1, 2))] });
        const live = await playLive(1, (sink) => {
            sink.schedule([req]);
            sink.syncTo(1);
        }, [tone]);
        expect(levelAt(live, 0)).toBeCloseTo(0.25, 1);
        expect(levelAt(live, 0.5)).toBeCloseTo(0.375, 1);
    });

    it("rebuilds a bus whose level changed under a playing clip", async () => {
        const live = await playLive(1, (sink) => {
            sink.schedule([clip(tone, { id: "a", bus: [bus("music", { volume: 1 })] })]);
            sink.syncTo(0);
            // An edit re-keys the request, which stops the old source and starts a new one.
            sink.schedule([clip(tone, { id: "b", bus: [bus("music", { volume: 0.25 })] })]);
            sink.syncTo(0);
        }, [tone]);
        expect(levelAt(live, 0.5)).toBeCloseTo(0.125, 2);
    });

    it("anchors a bus again after a pause, rather than keeping the last run's schedule", async () => {
        const fading = bus("dialogue", { effects: [...AudioEffects.gain(hold().ramp(1, 0, 1))] });
        const req = clip(tone, { bus: [fading] });
        const live = await playLive(1, (sink) => {
            sink.schedule([req]);
            sink.syncTo(0);
            sink.stop();
            // Resumed at 1s: the fade is already under way.
            sink.syncTo(1);
        }, [tone]);
        expect(levelAt(live, 0.5)).toBeCloseTo(0.25, 1);
    });
});
