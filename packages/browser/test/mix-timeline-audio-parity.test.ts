import { afterEach, describe, expect, it, vi } from "vitest";
import { node, project, track } from "./document.fixtures";
import { mixTimelineAudio } from "../src/mix-timeline-audio";
import { requireAac } from "./encoders.fixtures";
import { FPS, VIEWPORT, fullBleed, render, toneSource } from "./export-video.fixtures";

/**
 * A split export mixes the whole timeline once with `mixTimelineAudio` and the
 * coordinator encodes that; a whole export mixes inside `exportVideo`. The two
 * have to be the same signal or a split export plays out of step with a whole one
 *. `AudioBufferSource` is wrapped to read the mixed buffer the exporter
 * hands the AAC encoder, which still encodes it.
 */

const handed = vi.hoisted(() => ({ buffers: [] as AudioBuffer[] }));

vi.mock("mediabunny", async (importOriginal) => {
    const actual = await importOriginal<typeof import("mediabunny")>();
    class SpyAudioBufferSource extends actual.AudioBufferSource {
        override add(buffer: AudioBuffer) {
            handed.buffers.push(buffer);
            return super.add(buffer);
        }
    }
    return { ...actual, AudioBufferSource: SpyAudioBufferSource };
});

afterEach(() => { handed.buffers.length = 0; });

function worstDifference(a: AudioBuffer, b: AudioBuffer): number {
    let worst = 0;
    for (let c = 0; c < a.numberOfChannels; c++) {
        const x = a.getChannelData(c);
        const y = b.getChannelData(c);
        for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]));
    }
    return worst;
}

describe("the mix an export encodes and the mix a split export makes", () => {
    requireAac("the audio an export encodes");

    const sound = (src: string, props: Record<string, unknown> = {}) =>
        ({ kind: "audio" as const, nodes: [node("s", "sound", { src, ...props })], commands: [] }) as never;

    it("are the same samples for one project", async () => {
        const a = toneSource(1, 0.4);
        const b = toneSource(0.5, 0.3);
        const manifest = { image: {}, video: {}, font: {}, audio: { ...a.manifest.audio, ...b.manifest.audio } };
        const doc = project([
            track("v", fullBleed("#ff0000"), { duration: 1.5 }),
            track("a", sound(a.src, { volume: 0.8 }), { duration: 1 }),
            track("b", sound(b.src), { startAt: 0.7, duration: 0.8 }),
        ], { fps: FPS, viewport: VIEWPORT });

        await render({ document: doc, manifest });
        const mixed = (await mixTimelineAudio({ document: doc, manifest }))!;

        expect(handed.buffers).toHaveLength(1);
        const encoded = handed.buffers[0];
        expect({ length: encoded.length, rate: encoded.sampleRate, channels: encoded.numberOfChannels })
            .toEqual({ length: mixed.length, rate: mixed.sampleRate, channels: mixed.numberOfChannels });
        expect(worstDifference(encoded, mixed)).toBe(0);
        // Not two silent buffers agreeing.
        expect(Math.max(...encoded.getChannelData(0))).toBeGreaterThan(0.3);
    });

    it("are the same at a mixdown rate other than the default", async () => {
        const { src, manifest } = toneSource(1, 0.5);
        const doc = project([
            track("v", fullBleed("#ff0000"), { duration: 1 }),
            track("a", sound(src), { duration: 1 }),
        ], { fps: FPS, viewport: VIEWPORT });

        await render({ document: doc, manifest, audio: { sampleRate: 48000 } });
        const mixed = (await mixTimelineAudio({ document: doc, manifest, sampleRate: 48000 }))!;

        expect(handed.buffers[0].sampleRate).toBe(48000);
        expect(worstDifference(handed.buffers[0], mixed)).toBe(0);
    });
});
