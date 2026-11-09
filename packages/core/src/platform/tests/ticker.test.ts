import { describe, expect, it, vi } from "vitest";

import { SteppedClock } from "@/platform/stepped-clock";
import { Ticker } from "@/platform/ticker";

/** A ticker whose protected hooks are open, as a subclass's frame loop would use them. */
class TestTicker extends Ticker {
    seek(t: number): void {
        this.setCurrentTime(t);
    }
    advance(t: number, notify?: boolean): void {
        this.setCurrentTime(t, notify);
    }
    runTick(): Promise<void> {
        return this.tick();
    }
    force(playing: boolean): void {
        this.setPlaying(playing);
    }
}

describe("Ticker state", () => {
    it("starts paused, at zero, with no duration", () => {
        const ticker = new TestTicker();
        expect(ticker.isPlaying).toBe(false);
        expect(ticker.currentTime).toBe(0);
        expect(ticker.duration).toBe(0);
    });

    it("keeps the duration it is given", () => {
        const ticker = new TestTicker();
        ticker.setDuration(12.5);
        expect(ticker.duration).toBe(12.5);
    });

    it("lets a subclass flip the playing flag without notifying anyone", () => {
        const ticker = new TestTicker();
        const played = vi.fn();
        const paused = vi.fn();
        ticker.onPlay(played);
        ticker.onPause(paused);

        ticker.force(true);

        expect(ticker.isPlaying).toBe(true);
        expect(played).not.toHaveBeenCalled();
        ticker.force(false);
        expect(paused).not.toHaveBeenCalled();
    });
});

describe("Ticker.setCurrentTime", () => {
    it("moves the playhead and tells every time listener, in registration order", () => {
        const ticker = new TestTicker();
        const heard: string[] = [];
        ticker.onTime((t) => heard.push(`a${t}`));
        ticker.onTime((t) => heard.push(`b${t}`));

        ticker.advance(0.5);

        expect(ticker.currentTime).toBe(0.5);
        expect(heard).toEqual(["a0.5", "b0.5"]);
    });

    it("keeps the playhead exact and the listeners quiet when told not to notify", () => {
        const ticker = new TestTicker();
        const onTime = vi.fn();
        ticker.onTime(onTime);

        ticker.advance(0.0123, false);

        expect(ticker.currentTime).toBe(0.0123);
        expect(onTime).not.toHaveBeenCalled();
    });

    it("tells the listeners the exact position the next time it does notify", () => {
        const ticker = new TestTicker();
        const onTime = vi.fn();
        ticker.onTime(onTime);

        ticker.advance(0.01, false);
        ticker.advance(0.02, false);
        ticker.advance(0.0333);

        expect(onTime.mock.calls).toEqual([[0.0333]]);
    });

    it("does nothing when the time has not changed, whether or not it was asked to notify", () => {
        const ticker = new TestTicker();
        const onTime = vi.fn();
        ticker.onTime(onTime);

        ticker.advance(0.25);
        ticker.advance(0.25);
        ticker.advance(0.25, false);
        ticker.advance(0.25, true);

        expect(onTime).toHaveBeenCalledTimes(1);
    });

    it("does not notify for a position reached quietly and then asked for again", () => {
        const ticker = new TestTicker();
        const onTime = vi.fn();
        ticker.onTime(onTime);

        ticker.advance(0.5, false);
        ticker.advance(0.5);

        expect(onTime).not.toHaveBeenCalled();
    });

    it("moves backwards as readily as forwards", () => {
        const ticker = new TestTicker();
        const heard: number[] = [];
        ticker.onTime((t) => heard.push(t));
        ticker.advance(2);
        ticker.advance(0.5);
        expect(heard).toEqual([2, 0.5]);
        expect(ticker.currentTime).toBe(0.5);
    });
});

describe("Ticker.tick", () => {
    it("hands every tick callback the current time", async () => {
        const ticker = new TestTicker();
        const heard: number[] = [];
        ticker.onTick(async (t) => { heard.push(t); });
        ticker.onTick(async (t) => { heard.push(t * 2); });
        ticker.advance(1.5);

        await ticker.runTick();

        expect(heard).toEqual([1.5, 3]);
    });

    it("starts every callback before waiting on any of them", async () => {
        const ticker = new TestTicker();
        const order: string[] = [];
        let releaseFirst!: () => void;
        ticker.onTick(() => new Promise<void>((resolve) => {
            order.push("first started");
            releaseFirst = () => { order.push("first finished"); resolve(); };
        }));
        ticker.onTick(async () => { order.push("second ran"); });

        const done = ticker.runTick();
        expect(order).toEqual(["first started", "second ran"]);
        releaseFirst();
        await done;
        expect(order).toEqual(["first started", "second ran", "first finished"]);
    });

    it("resolves only once the slowest callback has", async () => {
        const ticker = new TestTicker();
        let slowDone = false;
        let settled = false;
        ticker.onTick(async () => { await Promise.resolve(); });
        ticker.onTick(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            slowDone = true;
        });

        const pending = ticker.runTick().then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        await pending;
        expect(slowDone).toBe(true);
    });

    it("rejects when any callback does", async () => {
        const ticker = new TestTicker();
        ticker.onTick(async () => { });
        ticker.onTick(async () => { throw new Error("render failed"); });
        await expect(ticker.runTick()).rejects.toThrow("render failed");
    });

    it("resolves at once with no callbacks", async () => {
        await expect(new TestTicker().runTick()).resolves.toBeUndefined();
    });
});

describe("Ticker play and pause", () => {
    it("play marks the clock playing and tells the listeners where, how fast and which way", () => {
        const ticker = new TestTicker();
        const played = vi.fn();
        ticker.onPlay(played);
        ticker.advance(1.25);

        ticker.play(2, true);

        expect(ticker.isPlaying).toBe(true);
        expect(played).toHaveBeenCalledWith(1.25, 2, true);
    });

    it("pause marks the clock paused and tells the pause listeners", () => {
        const ticker = new TestTicker();
        const paused = vi.fn();
        ticker.onPause(paused);
        ticker.play(1, false);

        ticker.pause();

        expect(ticker.isPlaying).toBe(false);
        expect(paused).toHaveBeenCalledTimes(1);
    });

    it("pause on a paused clock still tells the listeners", () => {
        const ticker = new TestTicker();
        const paused = vi.fn();
        ticker.onPause(paused);
        ticker.pause();
        ticker.pause();
        expect(paused).toHaveBeenCalledTimes(2);
    });
});

describe("Ticker.dispose", () => {
    function wired() {
        const ticker = new TestTicker();
        const calls = { tick: 0, play: 0, pause: 0, time: 0 };
        ticker.onTick(async () => { calls.tick++; });
        ticker.onPlay(() => { calls.play++; });
        ticker.onPause(() => { calls.pause++; });
        ticker.onTime(() => { calls.time++; });
        return { ticker, calls };
    }

    it("clears every list, so nothing registered hears of the clock again", async () => {
        const { ticker, calls } = wired();

        ticker.dispose();
        ticker.advance(1);
        await ticker.runTick();
        ticker.play(1, false);
        ticker.pause();

        expect(calls).toEqual({ tick: 0, play: 0, pause: 0, time: 0 });
    });

    it("leaves the clock itself usable: time and the playing flag still move", () => {
        const { ticker } = wired();
        ticker.dispose();

        ticker.advance(3);
        ticker.play(1, false);

        expect(ticker.currentTime).toBe(3);
        expect(ticker.isPlaying).toBe(true);
    });

    it("accepts new listeners afterwards", () => {
        const { ticker } = wired();
        ticker.dispose();
        const onTime = vi.fn();
        ticker.onTime(onTime);
        ticker.advance(1);
        expect(onTime).toHaveBeenCalledWith(1);
    });

    it("can be called twice", () => {
        const { ticker } = wired();
        ticker.dispose();
        expect(() => ticker.dispose()).not.toThrow();
    });
});

describe("SteppedClock", () => {
    it("is wherever it was last put, and notifies the listeners when it moves", () => {
        const clock = new SteppedClock();
        const onTime = vi.fn();
        clock.onTime(onTime);

        clock.seek(0.4);
        clock.seek(0.4);
        clock.seek(0.1);

        expect(clock.currentTime).toBe(0.1);
        expect(onTime.mock.calls).toEqual([[0.4], [0.1]]);
    });

    it("never starts playing by itself", () => {
        const clock = new SteppedClock();
        clock.seek(1);
        expect(clock.isPlaying).toBe(false);
    });
});
