/**
 * Shared fakes for the runtime test suite: platform adapters that record the calls they receive, and builders
 * for precomp results. Excluded from the published build via `src/**\/*.fixtures.ts` in tsconfig.
 */
import { AudioSink } from "@/platform/audio-sink";
import { Ticker } from "@/platform/ticker";
import { MeasureContext2D } from "@/render/measure-context";
import { AssetCatalog } from "@/assets/catalog";
import { StorageAdapter } from "@/platform/storage-adapter";
import type { CanvasRenderContext2D } from "@/render/canvas-render-context2d";
import { NullRenderContext } from "@/render/null-render-context";
import { AudioRequest } from "@/attributes/audio/request";
import { AssetRecord } from "@/assets/record";
import { AssetTimelineResult, AssetTrack, TrackAssets } from "@/runtime/asset-timeline";
import type { Size2D } from "@/attributes/layout/size";

export class FakeMeasureContext implements MeasureContext2D {
    measureText(text: string, fontSize = 10): Size2D {
        return { width: text.length * 10, height: fontSize };
    }
}

export class FakeAssetCatalog {
    /**
     * `videoDurations` defaults to 10s for any src; `missing` srcs are absent from the manifest so lookups throw,
     * as the real catalog's missing-asset error does (see `requestImage`).
     */
    constructor(
        private videoDurations: Record<string, number> = {},
        private missing: ReadonlySet<string> = new Set(),
    ) { }
    getVideoDuration(src: string): number {
        return this.videoDurations[src] ?? 10;
    }
    getImageMeta(src: string): { width: number; height: number; sizeBytes: number; src: string } {
        if (this.missing.has(src)) throw new Error(`Image asset not found: "${src}".`);
        return { src, width: 0, height: 0, sizeBytes: 0 };
    }
    getMediaDuration(src: string): number {
        if (this.missing.has(src)) throw new Error(`Audio asset not found: "${src}".`);
        return this.videoDurations[src] ?? 10;
    }
}
export function asCatalog(c: FakeAssetCatalog): AssetCatalog {
    return c as unknown as AssetCatalog;
}

export class FakeRenderContext extends NullRenderContext {
    renderCount = 0;
    screenshotValue: string | undefined = "data:image/png;base64,FAKE";

    override execute(cb: () => void): void {
        this.renderCount++;
        cb();
    }

    override screenshot(): string | undefined {
        return this.screenshotValue;
    }
}
export function asRenderContext(c: FakeRenderContext): CanvasRenderContext2D {
    return c;
}

export class FakeStorageAdapter {
    loadAssetCalls: { key: string; record: AssetRecord }[] = [];
    fetchAudioCalls: string[] = [];
    /** Exercises prefetch's catch. */
    loadShouldReject = false;
    /**
     * A controllable promise `warmPendingVideo()` returns instead of resolving immediately, so a test can park a
     * seek on the warm re-render loop and interleave a newer one (supersession tests).
     */
    warmGate: Promise<boolean> | null = null;
    warmPendingVideoCalls = 0;
    setPlayingCalls: boolean[] = [];

    loaded = new Set<string>();

    loadAsset(key: string, record: AssetRecord): Promise<void> {
        this.loadAssetCalls.push({ key, record });
        if (this.loadShouldReject) return Promise.reject(new Error("load failed"));
        this.loaded.add(key);
        return Promise.resolve();
    }
    isLoaded(key: string): boolean {
        return this.loaded.has(key);
    }
    fetchAudioData(src: string): Promise<ArrayBuffer> {
        this.fetchAudioCalls.push(src);
        return Promise.resolve(new ArrayBuffer(8));
    }
    warmPendingVideo(): Promise<boolean> {
        this.warmPendingVideoCalls++;
        return this.warmGate ?? Promise.resolve(false);
    }
    warmPendingDecodes(): Promise<boolean> {
        return this.warmPendingVideo();
    }
    hasPendingDecodes(): boolean {
        return false;
    }
    /** `warmPendingUpgrades()` awaits {@link upgradeGate}, then lands them. */
    pendingUpgrades = false;
    upgradeGate: Promise<void> | null = null;
    warmPendingUpgradesCalls = 0;
    hasPendingUpgrades(): boolean {
        return this.pendingUpgrades;
    }
    async warmPendingUpgrades(): Promise<boolean> {
        this.warmPendingUpgradesCalls++;
        if (!this.pendingUpgrades) return false;
        await this.upgradeGate;
        this.pendingUpgrades = false;
        return true;
    }
    setPlaying(playing: boolean): void {
        this.setPlayingCalls.push(playing);
    }
    setCatalog(catalog: AssetCatalog): void {
        this.setCatalogCalls.push(catalog);
    }
    setCatalogCalls: AssetCatalog[] = [];
}
export function asStorage(s: FakeStorageAdapter): StorageAdapter {
    return s as unknown as StorageAdapter;
}

export class FakeAudioSink extends AudioSink {
    private cache = new Set<string>();
    appendCalls: { src: string }[] = [];
    scheduleCalls: AudioRequest[][] = [];
    retainCalls: ReadonlySet<string>[] = [];
    syncToCalls: number[] = [];
    playCalls: { time: number; speed: number; reverse: boolean }[] = [];
    stopCount = 0;

    seed(src: string): void {
        this.cache.add(src);
    }

    has(src: string): boolean {
        return this.cache.has(src);
    }
    async append(src: string): Promise<void> {
        this.appendCalls.push({ src });
        this.cache.add(src);
    }
    retain(keep: ReadonlySet<string>): void {
        this.retainCalls.push(keep);
    }
    schedule(requests: readonly AudioRequest[]): void {
        this.scheduleCalls.push([...requests]);
    }
    syncTo(clipTime: number): void {
        this.syncToCalls.push(clipTime);
    }
    play(time: number, speed: number, reverse: boolean): void {
        this.playCalls.push({ time, speed, reverse });
    }
    stop(): void {
        this.stopCount++;
    }
}

/** `simulateTick` sets the time and runs the tick callbacks, awaiting their async work. */
export class FakeClock extends Ticker {
    seekCalls: number[] = [];
    disposeCount = 0;

    seek(t: number): void {
        this.seekCalls.push(t);
        this.setCurrentTime(t);
    }

    setTime(t: number): void {
        this.setCurrentTime(t);
    }

    async simulateTick(t: number): Promise<void> {
        this.setCurrentTime(t);
        await this.tick();
    }

    override dispose(): void {
        this.disposeCount++;
        super.dispose();
    }
}

export function makeAudioRequest(over: Partial<AudioRequest> = {}): AudioRequest {
    return {
        id: "req",
        src: "sound.mp3",
        startAt: 0,
        endAt: 1,
        trimStart: 0,
        volume: 1,
        loop: false,
        ...over,
    };
}

export function makeImageRecord(over: Partial<Extract<AssetRecord, { type: "image" }>> = {}): AssetRecord {
    return {
        type: "image",
        src: "img.png",
        startFrame: 0,
        endFrame: 0,
        ...over,
    };
}

export function makeLoaderRecord(
    over: Partial<Extract<AssetRecord, { type: "loader" }>> = {},
): AssetRecord {
    return {
        type: "loader",
        src: "loader-key",
        startFrame: 0,
        endFrame: 0,
        load: async () => () => { },
        ...over,
    };
}

export function makeAssetTrack(over: Partial<AssetTrack> & { record?: AssetRecord } = {}): AssetTrack {
    return {
        record: over.record ?? makeImageRecord(),
        cacheAt: over.cacheAt ?? 0,
        discardAt: over.discardAt ?? null,
    };
}

export function makeTrackAssets(over: Partial<TrackAssets> = {}): TrackAssets {
    return {
        id: "track",
        discovered: true,
        frameCount: 10,
        startFrame: 0,
        audioRequests: [],
        assetRecords: new Map(),
        ...over,
    };
}

export function makeAssetTimelineResult(over: Partial<AssetTimelineResult> = {}): AssetTimelineResult {
    const tracks = over.tracks ?? [makeTrackAssets()];
    // The furthest any track reaches, as `totalFramesOf` computes it.
    const totalFrames = over.totalFrames ?? Math.max(0, ...tracks.map(t => t.startFrame + t.frameCount));
    const fps = over.fps ?? 30;
    return {
        fps,
        tracks,
        totalFrames,
        totalDuration: over.totalDuration ?? totalFrames / fps,
        assets: over.assets ?? new Map<string, AssetTrack>(),
        buildErrors: over.buildErrors ?? [],
        complete: over.complete ?? true,
        timings: over.timings,
    };
}
