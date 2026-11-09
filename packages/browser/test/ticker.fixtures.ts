import { vi, type Mock } from "vitest";

/**
 * A hand-driven audio clock and animation-frame queue, so a run of any length
 * takes no wall-clock time and the display's step is a number a case chooses.
 * `web-ticker.test.ts` carries its own copy; a ticker under test is the only
 * real object, the context standing in for the platform.
 */

export class FakeContext {
    currentTime = 0;
    state: "running" | "suspended" = "running";
    sampleRate = 8000;
    destination = {};
    resumeCalls = 0;
    suspendCalls = 0;
    /** The silent sources the ticker started, so a case can read what each was asked. */
    sources: { buffer: { length: number } | null; started: boolean; stopped: boolean; disconnected: boolean }[] = [];
    /** What `resume()` returns; a case swaps it for a promise that never settles. */
    resumeResult: () => Promise<void> = async () => {
        this.state = "running";
    };

    resume(): Promise<void> {
        this.resumeCalls++;
        return this.resumeResult();
    }
    async suspend(): Promise<void> {
        this.suspendCalls++;
        this.state = "suspended";
    }
    close: Mock<() => void> = vi.fn();
    createBuffer = (_channels: number, length: number) => ({ length });
    createBufferSource = () => {
        const record = { buffer: null as { length: number } | null, started: false, stopped: false, disconnected: false };
        this.sources.push(record);
        return {
            set buffer(value: { length: number } | null) { record.buffer = value; },
            get buffer() { return record.buffer; },
            onended: null as unknown,
            connect() { },
            disconnect() { record.disconnected = true; },
            start() { record.started = true; },
            stop() { record.stopped = true; },
        };
    };
}

export interface FrameQueue {
    frames: Map<number, FrameRequestCallback>;
}

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let displayMs: number;

/** Replace `requestAnimationFrame` and `cancelAnimationFrame` with a queue the case runs by hand. */
export function stubAnimationFrames(): { pending: () => number; cancelled: () => number[] } {
    frames = new Map();
    nextId = 1;
    displayMs = 0;
    const cancelled: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.set(nextId, callback);
        return nextId++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
        cancelled.push(id);
        frames.delete(id);
    });
    return { pending: () => frames.size, cancelled: () => cancelled };
}

/** Move the audio clock on by `seconds` (the display by `display`, the same by default) and run the animation frames that were waiting. */
export async function step(context: FakeContext, seconds: number, display = seconds): Promise<void> {
    context.currentTime += seconds;
    displayMs += display * 1000;
    const due = [...frames];
    frames.clear();
    for (const [, callback] of due) callback(displayMs);
    // The loop awaits its tick callbacks.
    for (let i = 0; i < 4; i++) await Promise.resolve();
}
