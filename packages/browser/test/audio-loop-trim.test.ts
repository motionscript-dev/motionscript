import { describe, it, expect } from "vitest";
import type { AudioRequest } from "@motionscript/core";
import type { ScheduledAudioRequest } from "../src/frame-loop";
import { encodeWav, mixAudio } from "../src/audio/mixer";
import { WebAudioSink } from "../src/audio/player";

/**
 * A looping clip repeats its trimmed region, on the live device and in the mix.
 *
 * The source is a ramp whose sample value is `0.1 * t`, so the level at any point
 * of the output says which second of the source is sounding there: the whole
 * buffer wrapping (the old behaviour) and the region wrapping read differently.
 */

const SAMPLE_RATE = 44100;

function makeRamp(seconds: number): string {
    const frames = Math.round(seconds * SAMPLE_RATE);
    const ctx = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const buffer = ctx.createBuffer(1, frames, SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (0.1 * i) / SAMPLE_RATE;
    return URL.createObjectURL(new Blob([encodeWav(buffer)], { type: "audio/wav" }));
}

/** The source second sounding at output time `t`, read off the ramp. */
function sourceSecondAt(buffer: AudioBuffer, t: number): number {
    return buffer.getChannelData(0)[Math.floor(t * buffer.sampleRate)] / 0.1;
}

function loopRequest(src: string, over: Partial<AudioRequest> = {}): AudioRequest {
    return {
        id: "loop", src, startAt: 0, endAt: 6, trimStart: 1, trimEnd: 2, volume: 1, loop: true,
        ...over,
    };
}

async function mix(request: AudioRequest, seconds: number): Promise<AudioBuffer> {
    const scheduled: ScheduledAudioRequest[] = [{ request, globalOffset: 0 }];
    const buffer = await mixAudio(scheduled, seconds, { sampleRate: SAMPLE_RATE });
    if (!buffer) throw new Error("nothing mixed");
    return buffer;
}

async function live(request: AudioRequest, seconds: number, seekTo = 0): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    const sink = new WebAudioSink(ctx as unknown as AudioContext);
    await sink.append(request.src, await (await fetch(request.src)).arrayBuffer());
    sink.schedule([request]);
    sink.syncTo(seekTo);
    return ctx.startRendering();
}

describe("a looping clip repeats its trimmed region", () => {
    const src = makeRamp(4);

    it("in the offline mix", async () => {
        const out = await mix(loopRequest(src), 3.5);
        // Pass one plays 1 s..2 s of the source, then the region repeats.
        expect(sourceSecondAt(out, 0.25)).toBeCloseTo(1.25, 1);
        expect(sourceSecondAt(out, 0.75)).toBeCloseTo(1.75, 1);
        expect(sourceSecondAt(out, 1.25)).toBeCloseTo(1.25, 1);
        expect(sourceSecondAt(out, 2.75)).toBeCloseTo(1.75, 1);
    });

    it("on the live device", async () => {
        const out = await live(loopRequest(src), 3.5);
        expect(sourceSecondAt(out, 0.25)).toBeCloseTo(1.25, 1);
        expect(sourceSecondAt(out, 1.25)).toBeCloseTo(1.25, 1);
        expect(sourceSecondAt(out, 2.75)).toBeCloseTo(1.75, 1);
    });

    it("on the live device after a seek past the first pass", async () => {
        // 2.5 s into the clip is 2 passes and a half of a 1 s region.
        const out = await live(loopRequest(src), 1, 2.5);
        expect(sourceSecondAt(out, 0.1)).toBeCloseTo(1.6, 1);
    });

    it("without a trim, wraps the whole buffer as before", async () => {
        const out = await mix(loopRequest(src, { trimStart: 0, trimEnd: undefined }), 5);
        expect(sourceSecondAt(out, 3.5)).toBeCloseTo(3.5, 1);
        expect(sourceSecondAt(out, 4.5)).toBeCloseTo(0.5, 1);
    });
});
