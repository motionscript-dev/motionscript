import { describe, expect, it } from "vitest";
import { AudioEffects, ramp, type AudioRequest } from "@motionscript/core";
import { mixAudio } from "../src/audio/mixer";
import { SAMPLE_RATE, peakBetween, playLive, request, scheduled, sineBuffer, stepBuffer, urlOf } from "./audio.fixtures";

/**
 * The live device and the mix sound the same for the same request.
 *
 * Both build a clip's chain with `buildAudioEffectGraph` and its speed with the
 * same scheduler, so an export sounds like the preview. What is compared here is
 * the samples: the request is played through `WebAudioSink` from a clean start
 * and through `mixAudio`, and the two buffers are held to one another, along
 * with a check that each is not silent, since two silent buffers agree.
 * `audio-bus.test.ts` does the same for buses and seeks.
 *
 * No request here is cut short by its own `endAt`: the live device stops
 * a clip when a `syncTo` next finds its window passed, which is a clock tick later
 * than `endAt`, where the mix cuts exactly at it, so that is the one case the two
 * do not share.
 */

const SECONDS = 2;
/** A source with a different level each half second and a 440 Hz tone riding on it, so level, pitch and position all show. */
const SOURCE = urlOf(((): AudioBuffer => {
    const steps = stepBuffer([0.2, 0.4, 0.6, 0.8], 0.5);
    const tone = sineBuffer(2, 440, 0.1);
    const out = new AudioBuffer({ length: steps.length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
    const a = steps.getChannelData(0);
    const b = tone.getChannelData(0);
    const data = out.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = a[i] + b[i];
    return out;
})());

async function bothSound(req: AudioRequest, seconds = SECONDS): Promise<{ live: AudioBuffer; mixed: AudioBuffer }> {
    const live = await playLive(seconds, (sink) => {
        sink.schedule([req]);
        sink.syncTo(req.startAt);
    }, [req.src]);
    const mixed = (await mixAudio([scheduled(req)], seconds, { sampleRate: SAMPLE_RATE }))!;
    return { live, mixed };
}

function worstDifference(a: AudioBuffer, b: AudioBuffer): number {
    expect(a.length).toBe(b.length);
    expect(a.numberOfChannels).toBe(b.numberOfChannels);
    let worst = 0;
    for (let c = 0; c < a.numberOfChannels; c++) {
        const x = a.getChannelData(c);
        const y = b.getChannelData(c);
        for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]));
    }
    return worst;
}

const cases: [string, Partial<AudioRequest>][] = [
    ["a plain clip", {}],
    ["a request volume", { volume: 0.4 }],
    ["a trim", { trimStart: 0.5, endAt: 1.5 }],
    ["a loop over a trimmed region", { loop: true, trimStart: 0.5, trimEnd: 1, endAt: 2 }],
    ["a gain", { effects: [...AudioEffects.gain(0.5)] }],
    ["a gain curve", { effects: [...AudioEffects.gain(ramp(0, 1, 2))] }],
    ["a low-pass", { effects: [...AudioEffects.lowpass({ frequency: 300, q: 4 })] }],
    ["a high-pass", { effects: [...AudioEffects.highpass(1000)] }],
    ["a tremolo", { effects: [...AudioEffects.tremolo({ rate: 6, depth: 0.8 })] }],
    ["an echo", { effects: [...AudioEffects.echo({ delay: 0.25, feedback: 0.5, mix: 0.6 })] }],
    ["a chain of effects", { effects: [...AudioEffects.gain(0.8).lowpass(2000).tremolo({ rate: 3 }).echo({ delay: 0.1 })] }],
    ["a scalar speed", { endAt: 1, speed: 2 }],
    ["a slow speed", { endAt: 2, speed: 0.75 }],
    ["a speed curve", { endAt: 1.4, speed: ramp(1, 2, 2) }],
    ["a speed ramp and a gain", { endAt: 1.4, speed: ramp(1.5, 3, 2), effects: [...AudioEffects.gain(0.5)] }],
    ["a volume ramp", { volume: ramp(1, 0.2, 2) }],
    ["transitions in and out", { transitionIn: { duration: 0.5 }, transitionOut: { duration: 0.7, curve: { kind: "out", args: "quad" } } }],
];

describe("a request through the live device and through the mix", () => {
    it.each(cases)("sounds the same with %s", async (_label, over) => {
        const { live, mixed } = await bothSound(request(SOURCE, { id: "r", endAt: SECONDS, ...over }));

        expect(peakBetween(live, 0, SECONDS)).toBeGreaterThan(0.05);
        expect(worstDifference(live, mixed)).toBeLessThan(1e-3);
    });

    it("is not a comparison of silence: a different request does sound different", async () => {
        const plain = await bothSound(request(SOURCE, { id: "r", endAt: SECONDS }));
        const filtered = await bothSound(request(SOURCE, { id: "r", endAt: SECONDS, effects: [...AudioEffects.lowpass(300)] }));

        expect(worstDifference(plain.mixed, filtered.mixed)).toBeGreaterThan(0.05);
        expect(worstDifference(plain.live, filtered.live)).toBeGreaterThan(0.05);
    });
});
