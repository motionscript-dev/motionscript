import type { RenderIssue } from "@motionscript/core";
import { LaneGovernor, type GovernorOptions } from "./governor";
import type { ExportLane, LaneReport, LaneSession, SegmentSpec } from "./lane";
import type { ExportChunk } from "./plan";

interface RunLanesOptions {
    lanes: readonly ExportLane[];
    spec: SegmentSpec;
    chunks: readonly ExportChunk[];
    /** A finished range, in whatever order ranges finish. Once the governor settles, adjacent queued chunks are merged, so a range can span several planned chunks; it is named by the first. */
    onChunk: (chunk: ExportChunk, bytes: Uint8Array) => void;
    /** Frames drawn so far across every lane. Drops when a failed range's frames are discarded. */
    onFrames?: (frames: number) => void;
    /** The active lane count, each time it changes. */
    onActive?: (active: number) => void;
    /** A render issue a lane reported (a range retried elsewhere may report one twice). */
    onIssue?: (issue: RenderIssue) => void;
    governor?: Omit<GovernorOptions, "lanes">;
    now?: () => number;
    signal?: AbortSignal;
}

/** Tries a range gets before the run fails: once on its lane, once more on another. */
const ATTEMPTS = 2;

interface Job {
    chunk: ExportChunk;
    attempts: number;
}

/** Renders every chunk across the lanes the governor admits, pulling from one queue in timeline order so the join rarely waits. Small chunks let the governor measure early, but each costs a fresh encoder and scene build, so once it settles a lane takes its share of what is left as one merged range. A lane opens only once admitted. A failed range is retried once on another lane (its lane retired); a second failure, or the caller's abort, ends the run. */
export async function runLanes(options: RunLanesOptions): Promise<void> {
    const { lanes, spec, chunks, signal } = options;
    const now = options.now ?? (() => performance.now());
    if (lanes.length === 0) throw new Error("runLanes: no lanes");
    if (chunks.length === 0) return;

    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });

    const governor = new LaneGovernor({ lanes: lanes.length, ...options.governor });
    const queue: Job[] = chunks.map((chunk) => ({ chunk, attempts: 0 }));
    const inFlight = new Map<Job, number>();
    const dead = new Set<number>();
    let doneFrames = 0;
    let remaining = chunks.reduce((sum, c) => sum + (c.end - c.start), 0);
    let failure: unknown = null;

    let wake: () => void = () => {};
    let woken = new Promise<void>((resolve) => (wake = resolve));
    const notify = () => {
        const resolve = wake;
        woken = new Promise<void>((r) => (wake = r));
        resolve();
    };
    controller.signal.addEventListener("abort", notify, { once: true });

    const alive = () => lanes.length - dead.size;
    const admitted = (i: number) => {
        let rank = 0;
        for (let j = 0; j < i; j++) if (!dead.has(j)) rank++;
        return rank < governor.active;
    };
    const retire = (i: number) => {
        dead.add(i);
        governor.laneLost(alive());
        options.onActive?.(governor.active);
        notify();
    };
    const framesDrawn = () => {
        let frames = doneFrames;
        for (const f of inFlight.values()) frames += f;
        return frames;
    };
    const take = (): Job => {
        const job = queue.shift()!;
        if (!governor.settled || job.attempts > 0) return job;
        const queued = queue.reduce((sum, j) => sum + (j.chunk.end - j.chunk.start), job.chunk.end - job.chunk.start);
        const share = Math.ceil(queued / (governor.active === 1 ? 1 : governor.active * 2));
        let { end } = job.chunk;
        while (queue.length > 0 && queue[0].attempts === 0 && queue[0].chunk.start === end && end - job.chunk.start < share) {
            end = queue.shift()!.chunk.end;
        }
        return { chunk: { ...job.chunk, end }, attempts: 0 };
    };

    const runLane = async (i: number): Promise<void> => {
        while (!admitted(i) && remaining > 0 && !controller.signal.aborted && !dead.has(i)) await woken;
        if (remaining === 0 || controller.signal.aborted || dead.has(i)) return;

        let opened: LaneSession;
        try {
            opened = await lanes[i].open(spec, controller.signal);
        } catch (error) {
            if (controller.signal.aborted) return;
            if (alive() <= 1) throw error;
            console.warn(`[motionscript] export lane ${i} failed to open; continuing without it.`, error);
            retire(i);
            return;
        }
        try {
            for (;;) {
                controller.signal.throwIfAborted();
                if (remaining === 0) return;
                if (!admitted(i) || queue.length === 0) {
                    await woken;
                    continue;
                }
                const job = take();
                const frames = job.chunk.end - job.chunk.start;
                const reported: LaneReport = { frames: 0, busyMs: 0, waitMs: 0 };
                inFlight.set(job, 0);
                try {
                    const bytes = await opened.render(job.chunk, (report) => {
                        const changed = governor.record({
                            lane: i,
                            frames: report.frames - reported.frames,
                            busyMs: report.busyMs - reported.busyMs,
                            waitMs: report.waitMs - reported.waitMs,
                            at: now(),
                        });
                        for (const issue of report.issues ?? []) options.onIssue?.(issue);
                        Object.assign(reported, { frames: report.frames, busyMs: report.busyMs, waitMs: report.waitMs });
                        inFlight.set(job, report.frames);
                        options.onFrames?.(framesDrawn());
                        if (changed !== null) {
                            options.onActive?.(changed);
                            notify();
                        }
                    }, controller.signal);
                    inFlight.delete(job);
                    doneFrames += frames;
                    remaining -= frames;
                    options.onFrames?.(framesDrawn());
                    options.onChunk(job.chunk, bytes);
                    notify();
                } catch (error) {
                    inFlight.delete(job);
                    if (controller.signal.aborted) throw error;
                    if (++job.attempts >= ATTEMPTS || alive() <= 1) throw error;
                    console.warn(`[motionscript] export lane ${i} failed frames ${job.chunk.start} to ${job.chunk.end}; retrying on another lane.`, error);
                    queue.unshift(job);
                    options.onFrames?.(framesDrawn());
                    retire(i);
                    return;
                }
            }
        } finally {
            opened.close();
        }
    };

    try {
        await Promise.all(lanes.map((_, i) => runLane(i).catch((error: unknown) => {
            failure ??= error;
            controller.abort(error);
        })));
        if (failure) throw failure;
        if (remaining > 0) throw new Error(`runLanes: ${remaining} frames were never rendered.`);
    } finally {
        signal?.removeEventListener("abort", abort);
    }
}
