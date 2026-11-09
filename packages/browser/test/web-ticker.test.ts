import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebTicker } from "../src/ticker";

/**
 * `WebTicker` against a hand-driven audio clock and animation-frame queue, so a
 * run of any length takes no wall-clock time and the display's step is a number
 * a case chooses. Nothing here is a mock of the ticker itself: the context is
 * the only thing standing in for the platform.
 */

class FakeContext {
    currentTime = 0;
    state: "running" | "suspended" = "running";
    sampleRate = 8000;
    destination = {};
    resumeCalls = 0;
    /** What `resume()` returns; a case swaps it for a promise that never settles. */
    resumeResult: () => Promise<void> = async () => {
        this.state = "running";
    };

    resume(): Promise<void> {
        this.resumeCalls++;
        return this.resumeResult();
    }
    async suspend(): Promise<void> {
        this.state = "suspended";
    }
    close = vi.fn();
    createBuffer = (_channels: number, length: number) => ({ length });
    createBufferSource = () => ({
        buffer: null as unknown,
        onended: null as unknown,
        connect() { },
        disconnect() { },
        start() { },
        stop() { },
    });
}

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let displayMs: number;

/** Move the audio clock on by `seconds` (the display by `display`, the same by default) and run the animation frames that were waiting. */
async function step(context: FakeContext, seconds: number, display = seconds): Promise<void> {
    context.currentTime += seconds;
    displayMs += display * 1000;
    const due = [...frames];
    frames.clear();
    for (const [, callback] of due) callback(displayMs);
    // The loop awaits its tick callbacks.
    for (let i = 0; i < 4; i++) await Promise.resolve();
}

beforeEach(() => {
    frames = new Map();
    nextId = 1;
    displayMs = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.set(nextId, callback);
        return nextId++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => void frames.delete(id));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function make(duration: number, fps: number) {
    const context = new FakeContext();
    const ticker = new WebTicker({ context: context as unknown as AudioContext, fps });
    ticker.setDuration(duration);
    const ticks: number[] = [];
    ticker.onTick(async (time) => void ticks.push(time));
    let pauses = 0;
    ticker.onPause(() => pauses++);
    return { context, ticker, ticks, pauses: () => pauses };
}

describe("WebTicker end of run", () => {
    it.each([24, 25, 30, 60])("keeps a looping host running through many wraps at %i fps", async (fps) => {
        const duration = 1;
        const { context, ticker } = make(duration, fps);
        const lastFrame = Math.round(duration * fps) - 1;
        let wraps = 0;
        // The shape of a host that loops: wrap from the time listener once the last frame is heard.
        ticker.onTime((time) => {
            if (Math.trunc(time * fps) >= lastFrame) {
                wraps++;
                ticker.seek(0);
            }
        });

        ticker.play(1, false);
        // Steps of 0.05, 0.25 and 0.3 s stalled after one to three wraps before the end was re-read.
        for (const dt of [1 / fps, 0.05, 0.25, 0.3]) {
            const before = wraps;
            for (let i = 0; i < 200; i++) await step(context, dt);
            expect(wraps).toBeGreaterThan(before + 1);
            expect(ticker.isPlaying).toBe(true);
            expect(frames.size).toBe(1);
        }
    });

    it("ticks and pauses at the end of a run whose last interval is shorter than a frame", async () => {
        const { context, ticker, ticks, pauses } = make(0.95, 10);

        ticker.play(1, false);
        await step(context, 0.45);
        await step(context, 0.45);
        expect(ticks).toHaveLength(2);
        expect(ticker.isPlaying).toBe(true);

        await step(context, 0.1);
        expect(ticks.at(-1)).toBe(0.95);
        expect(ticker.isPlaying).toBe(false);
        expect(pauses()).toBe(1);
        expect(frames.size).toBe(0);
    });

    it("pauses itself at the end of a run backwards", async () => {
        const { context, ticker, ticks } = make(1, 10);
        ticker.seek(1);

        ticker.play(1, true);
        await step(context, 0.5);
        await step(context, 0.6);

        expect(ticks.at(-1)).toBe(0);
        expect(ticker.isPlaying).toBe(false);
    });
});

describe("WebTicker pacing", () => {
    it("reports every frame when the audio clock moves in bursts", async () => {
        const fps = 60;
        const { context, ticker, ticks } = make(10, fps);
        // Chromium hands over 512-sample blocks at 48 kHz: 10.67 or 21.33 ms per 16.67 ms frame.
        const burst = 512 / 48000;
        const audioAt = (n: number) => Math.floor((n / fps) / burst) * burst;

        ticker.play(1, false);
        for (let n = 1; n <= 120; n++) await step(context, audioAt(n) - context.currentTime, 1 / fps);

        expect(ticks.length).toBeGreaterThanOrEqual(118);
        const frameNumbers = ticks.map((t) => Math.floor(t * fps + 1e-6));
        for (let i = 1; i < frameNumbers.length; i++) expect(frameNumbers[i] - frameNumbers[i - 1]).toBe(1);
        expect(Math.abs(ticker.currentTime - context.currentTime)).toBeLessThan(0.02);
    });

    it("follows the audio clock when it stalls", async () => {
        const { context, ticker } = make(10, 30);

        ticker.play(1, false);
        for (let i = 0; i < 10; i++) await step(context, 1 / 30);
        for (let i = 0; i < 10; i++) await step(context, 0, 1 / 30);

        expect(Math.abs(ticker.currentTime - context.currentTime)).toBeLessThanOrEqual(0.05);
    });
});

describe("WebTicker's context", () => {
    it("takes a getter and calls it on the first play, not for a seek", async () => {
        const context = new FakeContext();
        const getter = vi.fn(() => context as unknown as AudioContext);
        const ticker = new WebTicker({ context: getter, fps: 30 });
        ticker.setDuration(2);

        ticker.seek(1);
        ticker.pause();
        expect(getter).not.toHaveBeenCalled();

        ticker.play(1, false);
        await step(context, 0.5);
        expect(getter).toHaveBeenCalledTimes(1);
        expect(ticker.currentTime).toBeCloseTo(1.5, 6);
        ticker.dispose();
        expect(context.close).not.toHaveBeenCalled();
    });
});

describe("WebTicker.play", () => {
    it("starts the clock in the same turn, so a pause right after it stops it", async () => {
        const { context, ticker, ticks } = make(1, 30);
        context.state = "suspended";
        context.resumeResult = () => new Promise(() => { });

        expect(ticker.play(1, false)).toBeUndefined();
        expect(ticker.isPlaying).toBe(true);
        ticker.pause();

        expect(ticker.isPlaying).toBe(false);
        expect(frames.size).toBe(0);
        await step(context, 0.5);
        expect(ticks).toEqual([]);
    });

    it("lets a seek in the same turn as the play land first, then pause", async () => {
        const { context, ticker } = make(2, 30);
        context.state = "suspended";
        context.resumeResult = () => new Promise(() => { });

        ticker.play(1, false);
        ticker.pause();
        ticker.seek(1);
        ticker.play(1, false);
        ticker.pause();

        expect(ticker.isPlaying).toBe(false);
        expect(ticker.currentTime).toBe(1);
    });

    it("suspends a context whose resume lands after the pause", async () => {
        const { context, ticker } = make(1, 30);
        context.state = "suspended";
        let land!: () => void;
        context.resumeResult = () => new Promise<void>((resolve) => {
            land = () => {
                context.state = "running";
                resolve();
            };
        });

        ticker.play(1, false);
        ticker.pause();
        land();
        await Promise.resolve();
        await Promise.resolve();

        expect(context.state).toBe("suspended");
    });

    it("stops and reports when the context cannot resume", async () => {
        const { context, ticker, pauses } = make(1, 30);
        const error = vi.spyOn(console, "error").mockImplementation(() => { });
        context.state = "suspended";
        context.resumeResult = () => Promise.reject(new Error("blocked"));

        ticker.play(1, false);
        await Promise.resolve();
        await Promise.resolve();

        expect(error).toHaveBeenCalled();
        expect(ticker.isPlaying).toBe(false);
        expect(pauses()).toBe(1);
    });
});
