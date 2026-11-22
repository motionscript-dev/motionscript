import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetCatalog } from "@motionscript/core";
import type { VideoSample } from "mediabunny";
import { WgpuStorageAdapter } from "../storage";
import { type FrameSource, VideoReader } from "../video";

const FPS = 30;
/** A frame small enough that a reader keeps its most frames. */
const SMALL = 64 * 64 * 4;

interface Bitmap { index: number; closed: boolean; close(): void }

/** A clip of `count` frames at FPS with a key frame every `keyEvery`, decoded lazily as a real decoder would. */
function clip(count: number, keyEvery: number) {
    const stats = { opened: 0, decoded: 0 };
    const index = (t: number) => Math.max(0, Math.min(count - 1, Math.floor(t * FPS + 1e-9)));
    const sample = (i: number) => ({
        timestamp: i / FPS,
        duration: 1 / FPS,
        toVideoFrame: () => ({ index: i, close() {} }),
        close() {},
    }) as unknown as VideoSample;
    const source: FrameSource = {
        async *samples(start: number) {
            stats.opened++;
            const from = index(start);
            for (let i = Math.floor(from / keyEvery) * keyEvery; i < count; i++) {
                stats.decoded++;
                if (i >= from) yield sample(i);
            }
        },
        keyFrameAt: async (t: number) => (Math.floor(index(t) / keyEvery) * keyEvery) / FPS,
    };
    return { source, stats };
}

const shown = (reader: VideoReader, t: number) => (reader.frameAt(t) as unknown as Bitmap | null)?.index ?? null;
const flush = async () => {
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

let bitmaps: Bitmap[] = [];
beforeEach(() => {
    bitmaps = [];
    vi.stubGlobal("createImageBitmap", async (frame: { index: number }) => {
        const bitmap = { index: frame.index, closed: false, close() { this.closed = true; } };
        bitmaps.push(bitmap);
        return bitmap;
    });
});
afterEach(() => vi.unstubAllGlobals());

describe("a video read frame after frame", () => {
    it("decodes each frame once, off one stream, across a key frame", async () => {
        const { source, stats } = clip(232, 154);
        const reader = new VideoReader(232 / FPS, source, SMALL);
        for (let i = 0; i < 232; i++) {
            await reader.decode([i / FPS]);
            expect(shown(reader, i / FPS)).toBe(i);
        }
        expect(stats.opened).toBe(1);
        expect(stats.decoded).toBe(232);
        reader.close();
    });

    it("shows the frame whose span holds the time, whatever its rounding", async () => {
        const { source } = clip(30, 10);
        const reader = new VideoReader(1, source, SMALL);
        await reader.decode([0.05, 2 / FPS - 1e-9, 0.5]);
        expect(shown(reader, 0.05)).toBe(1);
        expect(shown(reader, 2 / FPS - 1e-9)).toBe(2);
        expect(shown(reader, 0.5)).toBe(15);
        reader.close();
    });

    it("shows the last frame past the clip's end", async () => {
        const { source } = clip(10, 5);
        const reader = new VideoReader(10 / FPS, source, SMALL);
        await reader.decode([5]);
        expect(shown(reader, 5)).toBe(9);
        reader.close();
    });
});

describe("a video read out of order", () => {
    it("a step back opens a new stream at the key frame before it", async () => {
        const { source, stats } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        await reader.decode([100 / FPS]);
        await reader.decode([50 / FPS]);
        expect(shown(reader, 50 / FPS)).toBe(50);
        expect(stats.opened).toBe(2);
        reader.close();
    });

    it("a jump past a key frame opens there instead of decoding the frames between", async () => {
        const { source, stats } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        await reader.decode([10 / FPS]);
        const before = stats.decoded;
        await reader.decode([160 / FPS]);
        expect(shown(reader, 160 / FPS)).toBe(160);
        expect(stats.opened).toBe(2);
        expect(stats.decoded - before).toBe(12);
        reader.close();
    });

    it("a jump inside the same key frame's run reads on", async () => {
        const { source, stats } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        await reader.decode([10 / FPS]);
        await reader.decode([100 / FPS]);
        expect(shown(reader, 100 / FPS)).toBe(100);
        expect(stats.opened).toBe(1);
        expect(stats.decoded).toBe(102);
        reader.close();
    });

    it("an ask overtaken before its turn decodes nothing", async () => {
        const { source } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        const first = reader.decode([100 / FPS]);
        const second = reader.decode([10 / FPS]);
        await Promise.all([first, second]);
        expect(shown(reader, 100 / FPS)).toBeNull();
        expect(shown(reader, 10 / FPS)).toBe(10);
        reader.close();
    });

    it("hands back the nearest decoded frame while the exact one is missing", async () => {
        const { source } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        expect(reader.nearest(1)).toBeNull();
        await reader.decode([20 / FPS]);
        expect((reader.nearest(25 / FPS) as unknown as Bitmap).index).toBe(20);
        reader.close();
    });
});

describe("a video while playing", () => {
    it("keeps the frames just ahead of the playhead decoded", async () => {
        const { source } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        reader.setPlaying(true);
        reader.follow(0, 1);
        await flush();
        expect(shown(reader, reader.ahead / FPS)).toBe(reader.ahead);
        expect(shown(reader, (reader.ahead + 1) / FPS)).toBeNull();

        reader.follow(1 / FPS, 2);
        await flush();
        expect(shown(reader, (reader.ahead + 1) / FPS)).toBe(reader.ahead + 1);
        reader.close();
    });

    it("starts reading ahead from the paused frame as soon as play starts", async () => {
        const { source } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        await reader.decode([100 / FPS]);
        reader.setPlaying(true);
        await flush();
        expect(shown(reader, (100 + reader.ahead) / FPS)).toBe(100 + reader.ahead);
        reader.close();
    });

    it("follows the latest time of a pass, not an echo's earlier taps", async () => {
        const { source } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        reader.setPlaying(true);
        reader.follow(200 / FPS, 1);
        reader.follow(180 / FPS, 1);
        await flush();
        expect(shown(reader, 200 / FPS)).toBe(200);
        expect(shown(reader, 180 / FPS)).toBeNull();
        reader.close();
    });

    it("stops reading ahead once paused", async () => {
        const { source, stats } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        reader.setPlaying(true);
        reader.follow(0, 1);
        await flush();
        reader.setPlaying(false);
        const decoded = stats.decoded;
        reader.follow(2, 2);
        await flush();
        expect(stats.decoded).toBe(decoded);
        reader.close();
    });
});

describe("a video's resident frames", () => {
    it("keeps at most what its size allows, closing the frames it drops", async () => {
        const { source } = clip(30, 30);
        const reader = new VideoReader(1, source, 4096 * 4096 * 4);
        for (let i = 0; i < 10; i++) await reader.decode([i / FPS]);
        await flush();
        expect(bitmaps.filter((b) => b.closed).map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(shown(reader, 9 / FPS)).toBe(9);
        reader.close();
        expect(bitmaps.every((b) => b.closed)).toBe(true);
    });
});

describe("the storage adapter's video asks", () => {
    const adapter = () => new WgpuStorageAdapter({} as AssetCatalog, { width: 100, height: 100 }, 30);

    it("holds only what the latest render drew without", async () => {
        const store = adapter();
        const { source } = clip(300, 150);
        const reader = new VideoReader(10, source, SMALL);
        store.videos.set("clip.mp4", { duration: 10, reader, input: { dispose() {} } as never });

        store.beginPass();
        store.videoFrame("clip.mp4", 1);
        expect(store.hasPendingDecodes()).toBe(true);
        store.beginPass();
        store.videoFrame("clip.mp4", 2);
        expect(await store.warmPendingDecodes()).toBe(true);
        expect(shown(reader, 1)).toBeNull();
        expect(shown(reader, 2)).toBe(60);
        expect(store.hasPendingDecodes()).toBe(false);
        store.dispose();
    });
});
