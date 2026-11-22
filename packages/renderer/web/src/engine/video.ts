// One video's decoded frames. They come off a single forward stream (one
// decoder) that later asks read on from, so consecutive frames cost one decode
// each. Asking mediabunny for each frame on its own decodes again from the
// previous key frame every time: on a source with a key frame every few
// seconds that is a hundred decodes for one frame.

import type { VideoSample } from "mediabunny";

/** What a reader decodes from: mediabunny's `VideoSampleSink.samples`, and the key frame at or before a time. */
export interface FrameSource {
    samples(start: number): AsyncGenerator<VideoSample, void, unknown>;
    keyFrameAt(time: number): Promise<number | null>;
}

/** Decoded bytes one video keeps resident; its frame count follows from its size. */
const WINDOW_BYTES = 192 * 1024 * 1024;
const MIN_FRAMES = 4;
const MAX_FRAMES = 96;
const MAX_AHEAD = 16;
/** A forward ask this close (s) reads on without looking for a nearer key frame. */
const NEAR = 0.5;
/** A stream holds a decoder and a few decoded frames; one left unused this long (ms) while paused is closed. */
const IDLE_MS = 3000;
/** Sample times are integer timebases in seconds; this absorbs their rounding. */
const EPS = 1e-6;

interface Frame {
    /** Shown from `start` until `end` (the next sample's start; Infinity for the last). */
    start: number;
    end: number;
    bitmap: ImageBitmap;
    used: number;
}

interface Stream {
    samples: AsyncGenerator<VideoSample, void, unknown>;
    /** Pulled but not kept yet: its start is where the frame before it ends. */
    peek: VideoSample | null;
    done: boolean;
}

export class VideoReader {
    /** Frames ahead of the playhead kept decoded while playing. */
    readonly ahead: number;
    private readonly capacity: number;
    /** By start. */
    private frames: Frame[] = [];
    private stream: Stream | null = null;
    private queue: Promise<unknown> = Promise.resolve();
    private clock = 0;
    private asks = 0;
    private playing = false;
    private pumping = false;
    private head: number | null = null;
    private headPass = -1;
    private wake: (() => void) | null = null;
    private idle: ReturnType<typeof setTimeout> | null = null;
    private failed = false;
    private closed = false;

    constructor(
        readonly duration: number,
        private readonly source: FrameSource,
        frameBytes: number,
    ) {
        const fit = Math.floor(WINDOW_BYTES / Math.max(1, frameBytes));
        this.capacity = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, fit));
        this.ahead = Math.max(1, Math.min(MAX_AHEAD, Math.floor(this.capacity / 2)));
    }

    /** The decoded frame showing at `time`, or null. */
    frameAt(time: number): ImageBitmap | null {
        const frame = this.find(time);
        if (!frame) return null;
        frame.used = ++this.clock;
        return frame.bitmap;
    }

    /** The decoded frame closest to `time`, so a draw keeps a picture while the exact one decodes. */
    nearest(time: number): ImageBitmap | null {
        let best: Frame | null = null;
        let gap = Infinity;
        for (const f of this.frames) {
            const d = time < f.start ? f.start - time : time >= f.end ? time - f.end : 0;
            if (d < gap) {
                gap = d;
                best = f;
            }
        }
        if (!best) return null;
        best.used = ++this.clock;
        return best.bitmap;
    }

    /**
     * Decodes the frames showing at `times`, in time order on the one stream. An ask overtaken by a later one before
     * its turn settles without decoding: its caller draws again and asks for what it still lacks.
     */
    decode(times: readonly number[]): Promise<void> {
        const ask = ++this.asks;
        const sorted = times.filter(Number.isFinite).sort((a, b) => a - b);
        if (!this.playing && sorted.length > 0) {
            // A paused frame is where the next play starts reading ahead from.
            this.head = sorted[sorted.length - 1];
            this.headPass = -1;
        }
        return this.serial(async () => {
            for (const t of sorted) {
                if (ask !== this.asks || this.closed) return;
                await this.read(t);
            }
        });
    }

    /**
     * While playing: `time` was drawn in render pass `pass`. The latest time of the latest pass is the playhead, which
     * the reader keeps `ahead` frames decoded past (an echo's taps, earlier in the pass, are not).
     */
    follow(time: number, pass: number): void {
        if (!Number.isFinite(time)) return;
        const head = pass === this.headPass && this.head !== null ? Math.max(this.head, time) : time;
        this.headPass = pass;
        if (head === this.head) return;
        this.head = head;
        this.wake?.();
        this.pump();
    }

    setPlaying(playing: boolean): void {
        this.playing = playing;
        if (playing) {
            this.failed = false;
            this.pump();
        } else {
            this.wake?.();
            this.rest();
        }
    }

    close(): void {
        this.closed = true;
        this.wake?.();
        if (this.idle) clearTimeout(this.idle);
        void this.serial(() => this.closeStream());
        for (const f of this.frames) f.bitmap.close();
        this.frames = [];
    }

    private pump(): void {
        if (!this.playing || this.pumping || this.closed || this.failed || this.head === null) return;
        this.pumping = true;
        void this.pumpLoop().finally(() => (this.pumping = false));
    }

    private async pumpLoop(): Promise<void> {
        try {
            while (this.playing && !this.closed && this.head !== null) {
                let head = 0;
                // Read inside the queue: a render is synchronous, so by then its pass is complete.
                const idle = await this.serial(() => this.fill((head = this.head!)));
                if (idle && head === this.head && this.playing && !this.closed) {
                    await new Promise<void>((resolve) => (this.wake = resolve));
                }
                this.wake = null;
            }
        } catch (error) {
            if (this.closed) return;
            this.failed = true;
            console.error("[WgpuStorageAdapter] video decode failed:", error);
        }
    }

    /** Decodes the frame at `head` and the run after it; true when there was nothing to decode. */
    private async fill(head: number): Promise<boolean> {
        let idle = true;
        while (this.playing && !this.closed && this.head === head) {
            const { count, next } = this.runFrom(head);
            if (count >= this.ahead || next === Infinity) break;
            await this.read(next);
            // A stream that ends short of `next` would be opened again forever.
            if (!this.find(next)) break;
            idle = false;
        }
        return idle;
    }

    /** How many decoded frames follow the one at `time` without a gap, and where they end (`time` itself when it has none). */
    private runFrom(time: number): { count: number; next: number } {
        let i = this.indexAt(time);
        if (i < 0) return { count: -1, next: time };
        let count = 0;
        while (i + 1 < this.frames.length && this.frames[i + 1].start <= this.frames[i].end + EPS) {
            i++;
            count++;
        }
        return { count, next: this.frames[i].end };
    }

    private async read(t: number): Promise<void> {
        if (this.find(t)) return;
        if (!(await this.reaches(t))) await this.open(t);
        try {
            await this.advance(t);
        } catch (error) {
            await this.closeStream();
            throw error;
        }
    }

    /** Whether reading on from where the stream stands gets to `t` no slower than opening a new one there. */
    private async reaches(t: number): Promise<boolean> {
        const at = this.stream?.peek?.timestamp;
        if (at === undefined || t < at - EPS) return false;
        if (t - at <= NEAR) return true;
        const key = await this.source.keyFrameAt(t);
        return key === null || key <= at + EPS;
    }

    private async open(t: number): Promise<void> {
        await this.closeStream();
        this.stream = { samples: this.source.samples(t), peek: null, done: false };
    }

    private async closeStream(): Promise<void> {
        const stream = this.stream;
        if (!stream) return;
        this.stream = null;
        stream.peek?.close();
        await stream.samples.return(undefined).catch(() => {});
    }

    /** Reads on to the sample showing at `t` and keeps it; the samples passed on the way are closed. */
    private async advance(t: number): Promise<void> {
        const s = this.stream!;
        let current: VideoSample | null = null;
        let start = 0;
        for (;;) {
            const next = s.peek ?? (await this.pull(s));
            s.peek = null;
            if (current && (!next || next.timestamp > t + EPS)) {
                s.peek = next;
                await this.keep(current, start, next ? next.timestamp : Infinity);
                return;
            }
            if (!next) return;
            current?.close();
            // A fresh stream's first sample is the one at `t`, or the track's first when `t` is before it.
            start = current === null && next.timestamp > t + EPS ? -Infinity : next.timestamp;
            current = next;
        }
    }

    private async pull(s: Stream): Promise<VideoSample | null> {
        if (s.done) return null;
        const result = await s.samples.next();
        if (result.done) {
            s.done = true;
            return null;
        }
        return result.value;
    }

    private async keep(sample: VideoSample, start: number, end: number): Promise<void> {
        let bitmap: ImageBitmap;
        const frame = sample.toVideoFrame();
        try {
            bitmap = await createImageBitmap(frame);
        } finally {
            frame.close();
            sample.close();
        }
        if (this.closed) {
            bitmap.close();
            return;
        }
        let i = this.frames.length;
        while (i > 0 && this.frames[i - 1].start > start + EPS) i--;
        const prior = i > 0 ? this.frames[i - 1].start : NaN;
        const replaced = prior === start || Math.abs(prior - start) <= EPS ? this.frames.splice(--i, 1)[0] : null;
        this.frames.splice(i, 0, { start, end, bitmap, used: ++this.clock });
        if (replaced) retire(replaced);
        this.evict();
    }

    private evict(): void {
        while (this.frames.length > this.capacity) {
            let oldest = 0;
            for (let i = 1; i < this.frames.length; i++) {
                if (this.frames[i].used < this.frames[oldest].used) oldest = i;
            }
            retire(this.frames.splice(oldest, 1)[0]);
        }
    }

    private find(t: number): Frame | null {
        const i = this.indexAt(t);
        return i < 0 ? null : this.frames[i];
    }

    private indexAt(t: number): number {
        let lo = 0;
        let hi = this.frames.length - 1;
        let hit = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (this.frames[mid].start <= t + EPS) {
                hit = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return hit >= 0 && t + EPS < this.frames[hit].end ? hit : -1;
    }

    /** One job at a time: there is one stream. A paused stream left idle is closed afterwards. */
    private serial<T>(job: () => Promise<T>): Promise<T> {
        if (this.idle) {
            clearTimeout(this.idle);
            this.idle = null;
        }
        const run = this.queue.then(job);
        const rest = () => this.rest();
        this.queue = run.then(rest, rest);
        return run;
    }

    private rest(): void {
        if (this.idle) clearTimeout(this.idle);
        this.idle = null;
        if (this.playing || this.closed || !this.stream) return;
        this.idle = setTimeout(() => {
            this.idle = null;
            if (!this.playing) void this.serial(() => this.closeStream());
        }, IDLE_MS);
    }
}

/** Still painted by a doc until the next frame replaces it. */
function retire(frame: Frame): void {
    queueMicrotask(() => frame.bitmap.close());
}
