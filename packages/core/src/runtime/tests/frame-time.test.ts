import { describe, expect, it } from "vitest";

import { clipFrameToTime, clipTimeToFrame, frameSpecAtTime } from "@/runtime/frame-time";
import { frameTime, placeTracks, spanFrames, trackFrameCount } from "@/runtime/placement";
import { comp, node, openController, probeRegistry, project, track } from "@/runtime/document.fixtures";

const RATES = [24, 25, 30, 60] as const;

describe("clipTimeToFrame / clipFrameToTime", () => {
    it.each(RATES)("round-trips every frame of a ten-minute clip at %i fps", (fps) => {
        for (let frame = 0; frame < fps * 600; frame++) {
            expect(clipTimeToFrame(clipFrameToTime(frame, fps), fps)).toBe(frame);
        }
    });

    it("reads the product that lands one ulp under a frame as that frame", () => {
        expect(123 * (1 / 60) * 60).toBeLessThan(123);
        expect(clipTimeToFrame(123 * (1 / 60), 60)).toBe(123);
    });

    it("leaves a time between two frames alone", () => {
        expect(clipTimeToFrame(1.01, 30)).toBeCloseTo(30.3, 10);
        expect(clipTimeToFrame(0.5 / 60, 60)).toBe(0.5);
    });

    it("names the whole frame nearest a time", () => {
        expect(frameSpecAtTime(2.5, 60)).toEqual({ kind: "frame", frame: 150 });
        expect(frameSpecAtTime(1 / 3, 30)).toEqual({ kind: "frame", frame: 10 });
        expect(frameSpecAtTime(123 * (1 / 60), 60)).toEqual({ kind: "frame", frame: 123 });
    });
});

describe("trackFrameCount", () => {
    it("does not gain a frame when a length on a frame boundary lands one ulp high", () => {
        expect(4.15 * 60).toBeGreaterThan(249);
        expect(trackFrameCount(4.15, 60)).toBe(249);
        expect(trackFrameCount(8.3, 30)).toBe(249);
        expect(trackFrameCount(0.28, 25)).toBe(7);
    });

    it("still covers the last partial frame of a length off a boundary", () => {
        expect(trackFrameCount(0.281, 25)).toBe(8);
    });

    it("counts a deck summed in floats as the frames it states", () => {
        expect(1.4 + 2 * (0.8 + 1.4)).not.toBe(5.8);
        expect(trackFrameCount(1.4 + 2 * (0.8 + 1.4), 60)).toBe(348);
        expect(9.700000000000001).not.toBe(9.7);
        expect(trackFrameCount(9.700000000000001, 60)).toBe(582);
    });

    it.each(RATES)("agrees with exact millisecond lengths at %i fps", (fps) => {
        for (let ms = 1; ms <= 20_000; ms++) {
            const exact = Math.ceil((ms * fps) / 1000);
            expect(trackFrameCount(ms / 1000, fps)).toBe(Math.max(1, exact));
        }
    });
});

describe("track spans", () => {
    it.each(RATES)("place a start on a frame boundary on that frame at %i fps", (fps) => {
        for (let frame = 0; frame < fps * 30; frame++) {
            const [span] = placeTracks([{ id: "a", clip: { kind: "still", nodes: [] }, duration: 1, startAt: clipFrameToTime(frame, fps) }], fps);
            expect(span.startFrame).toBe(frame);
        }
    });

    it.each(RATES)("report a node present from a frame boundary from that frame at %i fps", (fps) => {
        for (let frame = 0; frame < fps * 10; frame++) {
            const span = { start: clipFrameToTime(frame, fps), end: Infinity };
            expect(spanFrames(span, fps, fps * 20)?.startFrame).toBe(frame);
            expect(frameTime(frame, fps, Infinity)).toBe(clipFrameToTime(frame, fps));
        }
    });
});

describe("PlaybackController frames", () => {
    describe.each(RATES)("at %i fps", (fps) => {
        const seconds = 2;
        const doc = project([track("a", comp([node("p", "probe", { width: 10, height: 10 })], [], seconds))], { fps });

        it("reads the frame it was sought to, and a document swap repaints that same frame", async () => {
            const { registry } = probeRegistry();
            const painted: number[] = [];
            const { controller } = openController(doc, { registry });
            controller.onFramePainted = (frame) => void painted.push(frame);
            const frames = fps * seconds;

            for (let frame = 0; frame < frames; frame++) {
                await controller.seek(frame);
                expect(controller.currentFrame).toBe(frame);

                painted.length = 0;
                controller.setProject(project([track("a", comp([node("p", "probe", { width: 10, height: 10 })], [], seconds))], { fps }));
                await controller.whenReplaced();
                expect(painted.at(-1)).toBe(frame);
            }
            controller.dispose();
        });
    });
});
