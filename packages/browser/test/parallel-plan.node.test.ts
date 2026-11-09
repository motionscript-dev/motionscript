import { describe, expect, it } from "vitest";
import { LaneGovernor } from "../src/parallel/governor";
import { planChunks } from "../src/parallel/plan";

describe("planChunks", () => {
    it("covers the timeline exactly, in order, with no gaps", () => {
        const chunks = planChunks(1000, { fps: 30, keyFrameInterval: 1, lanes: 3 });
        expect(chunks[0].start).toBe(0);
        expect(chunks.at(-1)!.end).toBe(1000);
        chunks.forEach((chunk, i) => {
            expect(chunk.index).toBe(i);
            if (i > 0) expect(chunk.start).toBe(chunks[i - 1].end);
        });
    });

    it("starts every chunk on a key-frame boundary", () => {
        for (const chunk of planChunks(3600, { fps: 60, keyFrameInterval: 1, lanes: 4 })) {
            expect(chunk.start % 60).toBe(0);
        }
        for (const chunk of planChunks(900, { fps: 30, keyFrameInterval: 2, lanes: 2, chunkSeconds: 3 })) {
            expect(chunk.start % 60).toBe(0);
        }
    });

    it("keeps chunks between two and six seconds unless told otherwise", () => {
        const long = planChunks(60 * 600, { fps: 60, keyFrameInterval: 1, lanes: 3 });
        expect(long[0].end - long[0].start).toBe(6 * 60);
        const short = planChunks(60 * 10, { fps: 60, keyFrameInterval: 1, lanes: 3 });
        expect(short[0].end - short[0].start).toBe(2 * 60);
        expect(planChunks(600, { fps: 60, keyFrameInterval: 1, lanes: 3, chunkSeconds: 5 })[0].end).toBe(300);
    });

    it("folds a sliver of a last chunk into the one before", () => {
        const chunks = planChunks(130, { fps: 30, keyFrameInterval: 1, lanes: 1, chunkSeconds: 2 });
        expect(chunks.map((c) => [c.start, c.end])).toEqual([[0, 60], [60, 130]]);
    });

    it("plans one chunk for a timeline shorter than a chunk, and none for nothing", () => {
        expect(planChunks(10, { fps: 30, keyFrameInterval: 1, lanes: 4 })).toEqual([{ index: 0, start: 0, end: 10 }]);
        expect(planChunks(0, { fps: 30, keyFrameInterval: 1, lanes: 4 })).toEqual([]);
    });
});

/** Feeds a governor `frames` frames from each active lane at a steady rate, one sample per frame. */
function drive(governor: LaneGovernor, opts: { ms: number; fpsPerLane: (active: number) => number; waitShare: number }) {
    const changes: number[] = [];
    for (let t = 0; t < opts.ms; t += 10) {
        for (let lane = 0; lane < governor.active; lane++) {
            const frames = (opts.fpsPerLane(governor.active) * 10) / 1000;
            const changed = governor.record({
                lane, frames, at: t,
                busyMs: 10 * (1 - opts.waitShare), waitMs: 10 * opts.waitShare,
            });
            if (changed !== null) changes.push(changed);
        }
    }
    return changes;
}

describe("LaneGovernor", () => {
    it("stays on one lane when that lane is mostly waiting on the encoder", () => {
        const governor = new LaneGovernor({ lanes: 4 });
        expect(drive(governor, { ms: 5000, fpsPerLane: () => 200, waitShare: 0.65 })).toEqual([]);
        expect(governor.active).toBe(1);
        expect(governor.settled).toBe(true);
    });

    it("adds lanes while they raise throughput, and settles where they stop", () => {
        const governor = new LaneGovernor({ lanes: 4 });
        // Two lanes nearly double throughput; a third adds nothing.
        const perLane = (active: number) => (active === 1 ? 50 : active === 2 ? 45 : 30);
        const changes = drive(governor, { ms: 10_000, fpsPerLane: perLane, waitShare: 0.1 });
        expect(changes).toEqual([2, 3, 2]);
        expect(governor.active).toBe(2);
        expect(governor.settled).toBe(true);
    });

    it("drops the second lane when splitting made the export slower", () => {
        const governor = new LaneGovernor({ lanes: 2 });
        const changes = drive(governor, { ms: 6000, fpsPerLane: (a) => (a === 1 ? 100 : 40), waitShare: 0.2 });
        expect(changes).toEqual([2, 1]);
        expect(governor.active).toBe(1);
    });

    it("never counts the new lane's start-up against it", () => {
        const governor = new LaneGovernor({ lanes: 2, windowMs: 100, minFrames: 1, warmupMs: 0 });
        for (let t = 0; t <= 200; t += 10) governor.record({ lane: 0, frames: 1, busyMs: 10, waitMs: 0, at: t });
        expect(governor.active).toBe(2);
        // Lane 0 keeps drawing while lane 1 is still opening: no judgement yet.
        for (let t = 210; t <= 2000; t += 10) governor.record({ lane: 0, frames: 1, busyMs: 10, waitMs: 0, at: t });
        expect(governor.active).toBe(2);
        expect(governor.settled).toBe(false);
    });
});
