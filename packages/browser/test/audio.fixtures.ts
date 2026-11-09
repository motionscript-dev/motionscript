import type { AudioRequest } from "@motionscript/core";
import type { ScheduledAudioRequest } from "../src/frame-loop";
import { encodeWav } from "../src/audio/mixer";
import { WebAudioSink } from "../src/audio/player";

/**
 * Audio made in the page, rendered to samples instead of heard.
 *
 * A source whose level is a known function of time says, in the rendered output,
 * which part of it sounded and how it was processed, and an `OfflineAudioContext`
 * needs no user gesture and is deterministic. `audio-bus.test.ts` and
 * `audio-loop-trim.test.ts` carry their own copies of the smaller helpers.
 */

export const SAMPLE_RATE = 44100;

/** A buffer whose channels hold `fill(frame, channel)`. */
export function bufferOf(seconds: number, fill: (t: number, channel: number) => number, channels = 1, rate = SAMPLE_RATE): AudioBuffer {
    const length = Math.round(seconds * rate);
    const buffer = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: rate });
    for (let c = 0; c < channels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < length; i++) data[i] = fill(i / rate, c);
    }
    return buffer;
}

/** Constant amplitude for `seconds`. */
export const toneBuffer = (seconds: number, amplitude: number, channels = 1): AudioBuffer =>
    bufferOf(seconds, () => amplitude, channels);

/** Constant amplitude per slice: `levels[i]` for `[i * each, (i + 1) * each)`, so a level says which slice sounded. */
export const stepBuffer = (levels: readonly number[], each: number, channels = 1): AudioBuffer =>
    bufferOf(levels.length * each, (t) => levels[Math.min(levels.length - 1, Math.floor(t / each + 1e-9))], channels);

export const sineBuffer = (seconds: number, hz: number, amplitude: number): AudioBuffer =>
    bufferOf(seconds, (t) => amplitude * Math.sin(2 * Math.PI * hz * t));

/** The buffer as a WAV blob URL, the form a request's `src` takes. */
export function urlOf(buffer: AudioBuffer): string {
    return URL.createObjectURL(new Blob([encodeWav(buffer)], { type: "audio/wav" }));
}

export function peakBetween(buffer: AudioBuffer, from: number, to: number): number {
    const start = Math.max(0, Math.floor(from * buffer.sampleRate));
    const end = Math.min(Math.floor(to * buffer.sampleRate), buffer.length);
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    return peak;
}

/** The level of a constant tone around `t`: its peak over the next 10 ms. */
export const levelAt = (buffer: AudioBuffer, t: number): number => peakBetween(buffer, t, t + 0.01);

/** The smallest absolute sample around `t`, over `span` seconds: where an oscillating level troughs. */
export function troughBetween(buffer: AudioBuffer, from: number, to: number): number {
    const data = buffer.getChannelData(0);
    let low = Infinity;
    for (let i = Math.floor(from * buffer.sampleRate); i < Math.min(Math.floor(to * buffer.sampleRate), buffer.length); i++) {
        low = Math.min(low, Math.abs(data[i]));
    }
    return low;
}

export function request(src: string, over: Partial<AudioRequest> = {}): AudioRequest {
    return {
        id: over.id ?? `${src}|${over.startAt ?? 0}`,
        src, startAt: 0, endAt: 2, trimStart: 0, volume: 1, loop: false,
        ...over,
    };
}

export const scheduled = (req: AudioRequest, globalOffset = 0): ScheduledAudioRequest => ({ request: req, globalOffset });

/**
 * What the live device plays, rendered rather than heard: an `OfflineAudioContext`
 * stands in for the device's, whose clock sits at 0 until it renders, so after a
 * `syncTo(s)` in `drive`, context time `t` in the result is clip time `s + t`.
 */
export async function playLive(
    seconds: number,
    drive: (sink: WebAudioSink, context: OfflineAudioContext) => void | Promise<void>,
    srcs: readonly string[] = [],
    channels = 2,
): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    const sink = new WebAudioSink(ctx as unknown as AudioContext);
    for (const src of new Set(srcs)) await sink.append(src, await (await fetch(src)).arrayBuffer());
    await drive(sink, ctx);
    return ctx.startRendering();
}
