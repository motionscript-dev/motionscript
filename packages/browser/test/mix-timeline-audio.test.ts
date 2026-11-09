import { describe, expect, it } from "vitest";
import { node, project, still, track } from "./document.fixtures";
import { mixTimelineAudio } from "../src/mix-timeline-audio";
import { levelAt, peakBetween } from "./audio.fixtures";
import { FPS, VIEWPORT, fullBleed, toneSource } from "./export-video.fixtures";

/**
 * `mixTimelineAudio`: a timeline's audio mixed without drawing a frame, for the
 * coordinator of a split export. Sound is read off what each
 * clip declares, so no canvas, surface or encoder is involved.
 */

const sound = (src: string, props: Record<string, unknown> = {}) =>
    ({ kind: "audio" as const, nodes: [node("s", "sound", { src, ...props })], commands: [] }) as never;

describe("mixTimelineAudio", () => {
    it("is a stereo buffer the length of the timeline at 44.1 kHz by default", async () => {
        const { src, manifest } = toneSource(1, 0.5);
        const doc = project([track("a", sound(src), { duration: 1.5 })], { fps: FPS, viewport: VIEWPORT });

        const mixed = await mixTimelineAudio({ document: doc, manifest });

        expect(mixed!.numberOfChannels).toBe(2);
        expect(mixed!.sampleRate).toBe(44100);
        expect(mixed!.length).toBe(Math.ceil(1.5 * 44100));
    });

    it("sounds the clip where its track puts it, and is silent either side of it", async () => {
        const { src, manifest } = toneSource(1, 0.5);
        const doc = project([track("a", sound(src), { startAt: 0.5, duration: 1 })], { fps: FPS, viewport: VIEWPORT });

        const mixed = (await mixTimelineAudio({ document: doc, manifest }))!;

        // The timeline is the furthest a track reaches: 1.5 s.
        expect(mixed.length).toBe(Math.ceil(1.5 * 44100));
        expect(peakBetween(mixed, 0, 0.49)).toBe(0);
        expect(levelAt(mixed, 0.6)).toBeCloseTo(0.5, 2);
        expect(levelAt(mixed, 1.4)).toBeCloseTo(0.5, 2);
    });

    it("mixes sounds of overlapping tracks together", async () => {
        const a = toneSource(1, 0.2);
        const b = toneSource(1, 0.3);
        const doc = project([
            track("a", sound(a.src), { duration: 1 }),
            track("b", sound(b.src), { duration: 1 }),
        ], { fps: FPS, viewport: VIEWPORT });

        const mixed = (await mixTimelineAudio({
            document: doc,
            manifest: { image: {}, video: {}, font: {}, audio: { ...a.manifest.audio, ...b.manifest.audio } },
        }))!;

        expect(levelAt(mixed, 0.5)).toBeCloseTo(0.5, 2);
    });

    it("carries a clip's own volume", async () => {
        const { src, manifest } = toneSource(1, 0.5);
        const doc = project([track("a", sound(src, { volume: 0.5 }), { duration: 1 })], { fps: FPS, viewport: VIEWPORT });

        const mixed = (await mixTimelineAudio({ document: doc, manifest }))!;

        expect(levelAt(mixed, 0.5)).toBeCloseTo(0.25, 2);
    });

    it("is null for a project that makes no sound", async () => {
        const doc = project([track("v", fullBleed("#ff0000"), { duration: 1 })], { fps: FPS, viewport: VIEWPORT });

        expect(await mixTimelineAudio({ document: doc })).toBeNull();
    });

    // A sound whose source the manifest does not describe is dropped and the mix answers null as if the
    // project were silent.
    it.todo("reports an audio source the manifest does not describe, rather than answering null");

    it("is null for a project with no tracks", async () => {
        expect(await mixTimelineAudio({ document: project([], { fps: FPS, viewport: VIEWPORT }) })).toBeNull();
    });

    it("mixes at the sample rate it is given", async () => {
        const { src, manifest } = toneSource(1, 0.5);
        const doc = project([track("a", sound(src), { duration: 1 })], { fps: FPS, viewport: VIEWPORT });

        const mixed = (await mixTimelineAudio({ document: doc, manifest, sampleRate: 22050 }))!;

        expect(mixed.sampleRate).toBe(22050);
        expect(mixed.length).toBe(22050);
    });

    it("takes a lone clip as the one track of one", async () => {
        const { src, manifest } = toneSource(1, 0.5);

        const mixed = await mixTimelineAudio({
            document: { kind: "composition", nodes: [{ ...node("s", "sound", { src }), startAt: 0 }], commands: [], duration: 1 } as never,
            manifest,
            fps: FPS,
            viewport: VIEWPORT,
        });

        expect(levelAt(mixed!, 0.5)).toBeCloseTo(0.5, 2);
    });

    it("draws nothing and makes no canvas, since only what each clip declares is needed", async () => {
        const { src, manifest } = toneSource(1, 0.5);
        const doc = project([
            track("v", still(node("r", "rect", { width: 10, height: 10 })), { duration: 1 }),
            track("a", sound(src), { duration: 1 }),
        ], { fps: FPS, viewport: VIEWPORT });
        const before = document.body.querySelectorAll("canvas").length;

        await mixTimelineAudio({ document: doc, manifest });

        expect(document.body.querySelectorAll("canvas")).toHaveLength(before);
    });
});
