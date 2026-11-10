import { describe, expect, it } from "vitest";
import type { ExportLane, LaneReport, LaneSession, SegmentSpec } from "../src/parallel/lane";
import { planChunks, type ExportChunk } from "../src/parallel/plan";
import { runLanes } from "../src/parallel/run-lanes";

const SPEC = {} as SegmentSpec;

interface FakeOptions {
    /** ms of drawing per frame. */
    msPerFrame?: number;
    /** Chunk indices this lane fails on. */
    failOn?: Set<number>;
    openFails?: boolean;
    openDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A lane that "renders" a chunk to bytes naming its frames, reporting as it goes. */
function fakeLane(name: string, log: string[], opts: FakeOptions = {}): ExportLane & { opened: number; closed: number } {
    const lane = {
        opened: 0,
        closed: 0,
        async open(): Promise<LaneSession> {
            lane.opened++;
            if (opts.openDelayMs) await sleep(opts.openDelayMs);
            if (opts.openFails) throw new Error(`${name} cannot open`);
            return {
                async render(chunk: ExportChunk, onReport: (r: LaneReport) => void, signal: AbortSignal) {
                    log.push(`${name}:${chunk.index}`);
                    let frames = 0;
                    for (let f = chunk.start; f < chunk.end; f += 10) {
                        signal.throwIfAborted();
                        await sleep(opts.msPerFrame ?? 0);
                        frames = Math.min(chunk.end - chunk.start, frames + 10);
                        onReport({ frames, busyMs: frames, waitMs: 0 });
                        if (opts.failOn?.has(chunk.index) && frames >= 10) throw new Error(`${name} broke on ${chunk.index}`);
                    }
                    return new Uint8Array([chunk.index]);
                },
                close: () => { lane.closed++; },
            };
        },
    };
    return lane;
}

describe("runLanes", () => {
    const chunks = planChunks(300, { fps: 30, keyFrameInterval: 1, lanes: 1, chunkSeconds: 2 });

    /** The ranges handed over, sorted, must tile the timeline exactly. */
    const tiles = (ranges: ExportChunk[]) => {
        const sorted = [...ranges].sort((x, y) => x.start - y.start);
        let at = 0;
        for (const r of sorted) {
            expect(r.start).toBe(at);
            at = r.end;
        }
        expect(at).toBe(300);
        return sorted;
    };
    /** Admits the second lane after a few frames and keeps it. Without warmupMs, the 300 ms default outlasts a fake run on Linux, whose 1 ms timers are exact. */
    const eager = { windowMs: 20, minFrames: 10, minGain: 0, warmupMs: 0 };

    it("renders every frame once, in ranges that tile the timeline", async () => {
        const got: ExportChunk[] = [];
        await runLanes({ lanes: [fakeLane("a", [])], spec: SPEC, chunks, onChunk: (chunk) => got.push(chunk) });
        tiles(got);
    });

    it("renders one lane's whole timeline as one range: no chunk pays its own start-up", async () => {
        const got: ExportChunk[] = [];
        await runLanes({ lanes: [fakeLane("a", [])], spec: SPEC, chunks, onChunk: (chunk) => got.push(chunk) });
        expect(got).toEqual([{ index: 0, start: 0, end: 300 }]);
    });

    it("reports frames that climb to the total and never jump by more than a report's worth", async () => {
        const seen: number[] = [];
        await runLanes({
            lanes: [fakeLane("a", [])], spec: SPEC, chunks,
            onChunk: () => {}, onFrames: (f) => seen.push(f),
        });
        expect(seen.at(-1)).toBe(300);
        for (let i = 1; i < seen.length; i++) {
            expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
            expect(seen[i] - seen[i - 1]).toBeLessThanOrEqual(10);
        }
    });

    it("starts on the first lane alone and admits the next once it pays", async () => {
        const log: string[] = [];
        const actives: number[] = [];
        const many = planChunks(3000, { fps: 30, keyFrameInterval: 1, lanes: 2, chunkSeconds: 2 });
        await runLanes({
            lanes: [fakeLane("a", log, { msPerFrame: 1 }), fakeLane("b", log, { msPerFrame: 1 })],
            spec: SPEC, chunks: many, onChunk: () => {}, onActive: (a) => actives.push(a),
            governor: { windowMs: 30, minFrames: 10, minGain: 1.05, warmupMs: 0 },
        });
        expect(log[0]).toBe("a:0");
        expect(actives[0]).toBe(2);
        expect(log.some((entry) => entry.startsWith("b:"))).toBe(true);
    });

    it("never opens a lane the governor does not admit", async () => {
        const b = fakeLane("b", []);
        await runLanes({ lanes: [fakeLane("a", []), b], spec: SPEC, chunks, onChunk: () => {}, governor: { windowMs: 1e9 } });
        expect(b.opened).toBe(0);
    });

    it("retries a failed range on another lane and retires the one that failed", async () => {
        const log: string[] = [];
        const got: ExportChunk[] = [];
        await runLanes({
            lanes: [fakeLane("a", log, { failOn: new Set([0]), msPerFrame: 1 }), fakeLane("b", log, { msPerFrame: 1 })],
            spec: SPEC, chunks, onChunk: (c) => got.push(c), governor: { windowMs: 1e9 },
        });
        tiles(got);
        // The retried range runs alone; the rest, merged, follows it on the same lane.
        expect(log).toEqual(["a:0", "b:0", "b:1"]);
    });

    it("fails when the only lane fails", async () => {
        await expect(runLanes({
            lanes: [fakeLane("a", [], { failOn: new Set([0]) })], spec: SPEC, chunks, onChunk: () => {},
        })).rejects.toThrow("a broke on 0");
    });

    it("carries on without an admitted lane that cannot open", async () => {
        const got: ExportChunk[] = [];
        const b = fakeLane("b", [], { openFails: true });
        await runLanes({
            lanes: [fakeLane("a", [], { msPerFrame: 1 }), b], spec: SPEC, chunks,
            onChunk: (c) => got.push(c), governor: eager,
        });
        expect(b.opened).toBe(1);
        tiles(got);
    });

    it("splits what is left between the lanes it settled on", async () => {
        const log: string[] = [];
        const got: ExportChunk[] = [];
        const many = planChunks(3000, { fps: 30, keyFrameInterval: 1, lanes: 2, chunkSeconds: 2 });
        await runLanes({
            lanes: [fakeLane("a", log, { msPerFrame: 1 }), fakeLane("b", log, { msPerFrame: 1 })],
            spec: SPEC, chunks: many, onChunk: (c) => got.push(c),
            governor: { windowMs: 30, minFrames: 10, minGain: 0, maxWaitShare: 1, warmupMs: 0 },
        });
        expect(got.length).toBeLessThan(many.length);
        const sorted = [...got].sort((x, y) => x.start - y.start);
        expect(sorted.at(-1)!.end).toBe(3000);
        expect(log.some((e) => e.startsWith("b:"))).toBe(true);
    });

    it("stops every lane on abort and closes their sessions", async () => {
        const controller = new AbortController();
        const a = fakeLane("a", [], { msPerFrame: 2 });
        const run = runLanes({
            lanes: [a], spec: SPEC, chunks, signal: controller.signal,
            onChunk: () => controller.abort(new Error("stop")),
        });
        await expect(run).rejects.toThrow("stop");
        expect(a.closed).toBe(1);
    });
});
