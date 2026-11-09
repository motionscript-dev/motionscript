import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebTicker } from "../src/ticker";
import { FakeContext, stubAnimationFrames, step } from "./ticker.fixtures";

/**
 * `WebTicker`'s transport: the playhead as a function of the audio clock, what
 * `play`, `pause` and `seek` leave behind, when listeners hear about it, who owns
 * the context, and what `dispose` clears. `web-ticker.test.ts`
 * covers the end of a run and a pause that races a pending resume.
 */

let queue: ReturnType<typeof stubAnimationFrames>;

beforeEach(() => {
    queue = stubAnimationFrames();
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
    const times: number[] = [];
    const plays: [number, number, boolean][] = [];
    let pauses = 0;
    ticker.onTick(async (time) => void ticks.push(time));
    ticker.onTime((time) => void times.push(time));
    ticker.onPlay((time, speed, reverse) => void plays.push([time, speed, reverse]));
    ticker.onPause(() => pauses++);
    return { context, ticker, ticks, times, plays, pauses: () => pauses };
}

describe("play", () => {
    it("reports the time, speed and direction to play listeners, and is playing before it returns", () => {
        const { ticker, plays } = make(4, 30);
        ticker.seek(1.5);

        ticker.play(2, true);

        expect(ticker.isPlaying).toBe(true);
        expect(plays).toEqual([[1.5, 2, true]]);
    });

    it("defaults to forwards at normal speed", () => {
        const { ticker, plays } = make(4, 30);

        ticker.play();

        expect(plays).toEqual([[0, 1, false]]);
    });

    it("advances the playhead with the audio clock, whatever the display's frame step", async () => {
        const { context, ticker } = make(10, 10);
        ticker.play(1, false);

        await step(context, 0.5);
        expect(ticker.currentTime).toBeCloseTo(0.5, 9);

        await step(context, 0.016);
        expect(ticker.currentTime).toBeCloseTo(0.516, 9);
    });

    it("moves at the speed it was given, and backwards in reverse", async () => {
        const fast = make(10, 10);
        fast.ticker.play(2, false);
        await step(fast.context, 0.5);
        expect(fast.ticker.currentTime).toBeCloseTo(1, 9);

        const slow = make(10, 10);
        slow.ticker.play(0.5, false);
        await step(slow.context, 1);
        expect(slow.ticker.currentTime).toBeCloseTo(0.5, 9);

        const back = make(10, 10);
        back.ticker.seek(6);
        back.ticker.play(1, true);
        await step(back.context, 1.5);
        expect(back.ticker.currentTime).toBeCloseTo(4.5, 9);
    });

    it("clamps the playhead to the run", async () => {
        const { context, ticker } = make(2, 10);
        ticker.play(1, false);

        await step(context, 5);

        expect(ticker.currentTime).toBe(2);
    });

    it("starts from the context's current time, not from zero", async () => {
        const { context, ticker } = make(10, 10);
        context.currentTime = 100;

        ticker.play(1, false);
        await step(context, 0.4);

        expect(ticker.currentTime).toBeCloseTo(0.4, 9);
    });

    it("keeps the context alive with one silent source over the rest of the timeline", () => {
        const { context, ticker } = make(5, 30);
        ticker.seek(2);

        ticker.play(1, false);

        expect(context.sources).toHaveLength(1);
        expect(context.sources[0].started).toBe(true);
        // 3 s left at 8 kHz.
        expect(context.sources[0].buffer!.length).toBe(24000);
    });

    it("re-anchors on a second play without starting a second loop", async () => {
        const { context, ticker, plays } = make(10, 10);
        ticker.play(1, false);
        await step(context, 0.5);

        ticker.play(2, false);
        expect(queue.pending()).toBe(1);
        await step(context, 0.25);

        // 0.5 s at speed 1, then 0.25 s at speed 2 from there.
        expect(ticker.currentTime).toBeCloseTo(1, 9);
        expect(plays.map(([, speed]) => speed)).toEqual([1, 2]);
        expect(queue.pending()).toBe(1);
        // The silent source was replaced, not stacked.
        expect(context.sources.filter((s) => !s.stopped)).toHaveLength(1);
    });

    it("resumes a suspended context without waiting for it, and holds at the anchor until it runs", async () => {
        const { context, ticker, ticks } = make(10, 10);
        context.state = "suspended";
        let land!: () => void;
        context.resumeResult = () => new Promise<void>((resolve) => {
            land = () => {
                context.state = "running";
                resolve();
            };
        });

        ticker.play(1, false);

        expect(context.resumeCalls).toBe(1);
        expect(ticker.isPlaying).toBe(true);
        // A suspended context's clock does not move, so neither does the playhead.
        await step(context, 0);
        await step(context, 0);
        expect(ticker.currentTime).toBe(0);
        expect(ticks).toEqual([]);

        land();
        await Promise.resolve();
        await step(context, 0.3);
        expect(ticker.currentTime).toBeCloseTo(0.3, 9);
        expect(context.suspendCalls).toBe(0);
    });

    it("does not ask a running context to resume", () => {
        const { context, ticker } = make(10, 10);

        ticker.play();

        expect(context.resumeCalls).toBe(0);
    });
});

describe("pause", () => {
    it("stops the loop, stops the silent source, suspends the context and tells pause listeners", async () => {
        const { context, ticker, pauses } = make(10, 10);
        ticker.play(1, false);
        await step(context, 0.5);

        ticker.pause();

        expect(ticker.isPlaying).toBe(false);
        expect(queue.pending()).toBe(0);
        expect(context.sources[0].stopped).toBe(true);
        expect(context.sources[0].disconnected).toBe(true);
        expect(context.state).toBe("suspended");
        expect(pauses()).toBe(1);
    });

    it("keeps the playhead where the clock had got to", async () => {
        const { context, ticker } = make(10, 10);
        ticker.play(1, false);
        await step(context, 0.37);

        ticker.pause();
        context.currentTime += 5;

        expect(ticker.currentTime).toBeCloseTo(0.37, 9);
    });

    it("leaves an already suspended context alone", () => {
        const { context, ticker } = make(10, 10);
        context.state = "suspended";

        ticker.pause();

        expect(context.suspendCalls).toBe(0);
    });

    it("lets the next play carry on from where it stopped", async () => {
        const { context, ticker } = make(10, 10);
        ticker.play(1, false);
        await step(context, 0.4);
        ticker.pause();

        ticker.play(1, false);
        await step(context, 0.2);

        expect(context.resumeCalls).toBe(1);
        expect(ticker.currentTime).toBeCloseTo(0.6, 9);
    });
});

describe("seek", () => {
    it("clamps to the run", () => {
        const { ticker } = make(3, 30);

        ticker.seek(-4);
        expect(ticker.currentTime).toBe(0);

        ticker.seek(99);
        expect(ticker.currentTime).toBe(3);
    });

    it("sets the playhead and tells time listeners, without ticking, playing or pausing", () => {
        const { ticker, ticks, times, plays, pauses } = make(10, 30);

        ticker.seek(2.5);

        expect(ticker.currentTime).toBe(2.5);
        expect(times).toEqual([2.5]);
        expect(ticks).toEqual([]);
        expect(plays).toEqual([]);
        expect(pauses()).toBe(0);
        expect(ticker.isPlaying).toBe(false);
    });

    it("re-anchors a running clock on the sought time", async () => {
        const { context, ticker } = make(10, 10);
        ticker.play(1, false);
        await step(context, 0.5);

        ticker.seek(2);
        await step(context, 0.25);

        expect(ticker.currentTime).toBeCloseTo(2.25, 9);
    });

    it("re-anchors a reversed run too", async () => {
        const { context, ticker } = make(10, 10);
        ticker.seek(5);
        ticker.play(1, true);
        await step(context, 1);

        ticker.seek(8);
        await step(context, 0.5);

        expect(ticker.currentTime).toBeCloseTo(7.5, 9);
    });
});

describe("listeners", () => {
    it("hear the playhead once per project frame, however often the display refreshes", async () => {
        const { context, ticker, ticks, times } = make(10, 10);
        ticker.play(1, false);

        // 12 steps of 30 ms: the playhead is exact each time, and a frame is 100 ms.
        // Listeners hear the first position in each frame.
        for (let i = 0; i < 12; i++) await step(context, 0.03);

        expect(ticker.currentTime).toBeCloseTo(0.36, 9);
        expect(times).toHaveLength(3);
        expect(times[0]).toBeCloseTo(0.12, 9);
        expect(times[1]).toBeCloseTo(0.21, 9);
        expect(times[2]).toBeCloseTo(0.3, 9);
        expect(ticks).toEqual(times);
    });

    // A step of exactly one frame lands a hair under it once the clock has summed a few of them
    // (0.4 − 0.30000000000000004 is 0.0999…98 s); frames are compared, not the time since the
    // last notification, so it still counts.
    it("hear every step that is exactly a frame, whatever the sum of the steps before it", async () => {
        const { context, ticker, times } = make(10, 10);
        ticker.play(1, false);

        for (let i = 0; i < 4; i++) await step(context, 0.1);

        expect(times).toHaveLength(4);
    });

    it("hears a step of a frame and a half every time", async () => {
        const { context, ticker, times } = make(10, 10);
        ticker.play(1, false);

        for (let i = 0; i < 4; i++) await step(context, 0.15);

        expect(times).toHaveLength(4);
    });

    it("never run a tick while the last one is still awaited", async () => {
        const { context, ticker } = make(10, 10);
        let started = 0;
        let release!: () => void;
        ticker.onTick(() => {
            started++;
            return new Promise<void>((resolve) => { release = resolve; });
        });
        ticker.play(1, false);

        await step(context, 0.2);
        expect(started).toBe(1);
        // The loop is parked on the tick: no animation frame is waiting, so nothing can overlap it.
        expect(queue.pending()).toBe(0);
        await step(context, 0.2);
        expect(started).toBe(1);

        release();
        for (let i = 0; i < 4; i++) await Promise.resolve();
        expect(queue.pending()).toBe(1);
        await step(context, 0.2);
        expect(started).toBe(2);
    });

    it("hear the final position at the end of a run and the ticker stops requesting frames", async () => {
        const { context, ticker, ticks, times } = make(0.25, 10);
        ticker.play(1, false);

        await step(context, 0.1);
        await step(context, 0.2);

        expect(times.at(-1)).toBe(0.25);
        expect(ticks.at(-1)).toBe(0.25);
        expect(ticker.isPlaying).toBe(false);
        expect(queue.pending()).toBe(0);
    });
});

describe("the context", () => {
    it("is borrowed when one is passed, and left open on dispose", () => {
        const { context, ticker } = make(1, 30);

        expect(ticker.getContext()).toBe(context);
        ticker.dispose();

        expect(context.close).not.toHaveBeenCalled();
    });

    it("is created and closed on dispose when none is passed", () => {
        const ticker = new WebTicker({ fps: 30 });
        const context = ticker.getContext();
        const close = vi.spyOn(context, "close");

        expect(context).toBeInstanceOf(AudioContext);
        ticker.dispose();

        expect(close).toHaveBeenCalledTimes(1);
    });
});

describe("dispose", () => {
    it("cancels the loop and stops the silent source", async () => {
        const { context, ticker } = make(10, 10);
        ticker.play(1, false);
        await step(context, 0.3);

        ticker.dispose();

        expect(queue.pending()).toBe(0);
        expect(context.sources[0].stopped).toBe(true);
    });

    it("clears every listener", async () => {
        const { context, ticker, ticks, times, plays, pauses } = make(10, 10);

        ticker.dispose();
        ticker.seek(1);
        ticker.play(1, false);
        await step(context, 0.5);
        ticker.pause();

        expect({ ticks, times, plays, pauses: pauses() }).toEqual({ ticks: [], times: [], plays: [], pauses: 0 });
    });
});
