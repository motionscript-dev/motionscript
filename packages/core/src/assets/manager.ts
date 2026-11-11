import { AudioRequest, busStopKey } from "@/attributes/audio/request";
import { effectsKey } from "@/attributes/audio/effects/union";
import { paramKey } from "@/attributes/audio/ramp";
import { transitionKey } from "@/attributes/audio/transition";
import { AssetRecord, Disposer, LoaderFn } from "@/assets/record";
import { AudioSink } from "@/platform/audio-sink";
import { StorageAdapter } from "@/platform/storage-adapter";
import { AssetTrack, AssetTimelineResult } from "@/runtime/asset-timeline";

/** Coordinates asset loading and audio synchronization during playback over an {@link AssetTimelineResult}, delegating storage/audio work to platform adapters. */
export class AssetManager {
    private precomp: AssetTimelineResult;
    private readonly storageAdapter: StorageAdapter;
    private readonly audioDevice: AudioSink;

    /** `null` after a swap: whatever the device holds belongs to the previous precomp. */
    private lastAudioRequestKey: string | null = "";
    private lastAudioSrcs: ReadonlySet<string> | null = new Set();
    private audioFetching = new Map<string, Promise<void>>();
    /** Sources whose fetch or decode failed, with why, so they are not refetched every sync. A source leaves when no request in the window names it any more (and, once reported, when a new precomp arrives) so it is tried afresh when wanted. One that failed quietly (see {@link AudioRequest.optional}) survives a precomp: a video with no audio track would otherwise be fetched whole on every edit. */
    private audioFailed = new Map<string, unknown>();
    /** The failed sources already reported to {@link onError}. */
    private audioReported = new Set<string>();
    /** Sources a request in the last window asked for by name, not as a picture's own sound. */
    private audioRequired: ReadonlySet<string> = new Set();
    /** Keys of the loaders a track measures against, which no window may evict. */
    private layoutGateKeys: ReadonlySet<string>;
    private disposed = false;

    private loaderDisposers = new Map<string, Disposer>();
    /** In-flight loader runs, keyed by loader key, to dedupe concurrent calls. */
    private loaderInFlight = new Map<string, Promise<void>>();

    /** @param onError Told once per source when audio a request asked for cannot be fetched or decoded. Defaults to `console.error`. */
    constructor(
        precomp: AssetTimelineResult,
        storageAdapter: StorageAdapter,
        audioDevice: AudioSink,
        private readonly onError: (error: Error) => void = (error) => console.error(`[AssetManager] ${error.message}`),
    ) {
        this.precomp = precomp;
        this.layoutGateKeys = layoutGatesOf(precomp);
        this.storageAdapter = storageAdapter;
        this.audioDevice = audioDevice;
    }

    /** Swaps in a new precomp (a document swap), keeping warm loader disposers and in-flight audio fetches so a single-track edit doesn't refetch unchanged assets. Resets the audio signature to force a reschedule, including into an empty window (how removed audio stops). */
    setPrecomp(precomp: AssetTimelineResult): void {
        this.precomp = precomp;
        this.layoutGateKeys = layoutGatesOf(precomp);
        for (const src of this.audioReported) this.audioFailed.delete(src);
        this.audioReported.clear();
        this.lastAudioRequestKey = null;
        this.lastAudioSrcs = null;
    }

    /** Blocking load for seek and initial render: waits for every asset whose `cacheAt <= frame <= endFrame`, then schedules audio. */
    async loadAt(frame: number): Promise<void> {
        const jobs: Promise<void>[] = [];

        for (const [key, track] of this.precomp.assets) {
            if (track.record.type === 'loader') {
                const job = this.syncLoader(key, track, frame);
                if (job) jobs.push(job);
                continue;
            }
            if (track.cacheAt <= frame && track.record.endFrame >= frame) {
                jobs.push(this.storageAdapter.loadAsset(key, track.record));
            }
        }

        await Promise.all(jobs);
        if (this.audioDevice.schedulesAudio) this.syncAudio(frame);
    }

    /** Whether `key` — a loader key or a stored asset's — is resident now. */
    isReady(key: string): boolean {
        return this.loaderDisposers.has(key) || this.storageAdapter.isLoaded(key);
    }

    /** Loads `records` whatever their windows say: layout gates must be resident before a track measures regardless of the frame drawn. */
    async loadRecords(records: readonly AssetRecord[]): Promise<void> {
        await Promise.all(records.map((record) => record.type === 'loader'
            ? this.runLoader(record.src, record.load)
            : this.storageAdapter.loadAsset(record.src, record)));
    }

    /** Non-blocking prefetch after each render tick; fires loads for assets whose `cacheAt` window was reached. */
    prefetch(frame: number): void {
        for (const [key, track] of this.precomp.assets) {
            if (track.record.type === 'loader') {
                this.syncLoader(key, track, frame)?.catch(err => {
                    console.error(`[AssetManager] loader failed for ${key}:`, err);
                });
                continue;
            }
            if (track.cacheAt <= frame && track.record.endFrame >= frame) {
                this.storageAdapter.loadAsset(key, track.record).catch(err => {
                    console.error(`[AssetManager] prefetch failed for ${key}:`, err);
                });
            }
        }
    }

    /** Drives one loader toward the state `frame` requires: inside `[cacheAt, discardAt]` run it (deduped, skipped once loaded), outside dispose it if loaded. Returns the in-flight promise a blocking caller can await, else `undefined`. */
    private syncLoader(key: string, track: AssetTrack, frame: number): Promise<void> | undefined {
        if (track.record.type !== 'loader') return undefined;
        const discardAt = track.discardAt ?? Infinity;
        const inWindow = track.cacheAt <= frame && frame <= discardAt;

        if (!inWindow) {
            // A layout gate is loaded by `loadRecords` whatever frame is drawn; disposing it here made `isReady` false and the next frame load it again.
            if (this.layoutGateKeys.has(key)) return undefined;
            const dispose = this.loaderDisposers.get(key);
            if (dispose) {
                this.loaderDisposers.delete(key);
                dispose();
            }
            return undefined;
        }

        return this.runLoader(key, track.record.load);
    }

    private runLoader(key: string, load: LoaderFn): Promise<void> | undefined {
        if (this.loaderDisposers.has(key)) return undefined;
        const existing = this.loaderInFlight.get(key);
        if (existing) return existing;

        const job = load()
            .then(disposer => {
                // A loader resolving nothing keeps its result resident on purpose (see `LoaderFn`); a no-op disposer keeps `loaderDisposers.has(key)` the single "already loaded" test.
                this.loaderDisposers.set(key, disposer ?? NO_DISPOSE);
            })
            .finally(() => {
                this.loaderInFlight.delete(key);
            });
        this.loaderInFlight.set(key, job);
        return job;
    }

    dispose(): void {
        for (const dispose of this.loaderDisposers.values()) dispose();
        this.loaderDisposers.clear();
        this.loaderInFlight.clear();
        this.disposed = true;
    }

    /** Pushes the current audio working set to the AudioSink after each render tick. */
    syncAudio(frame: number): void {
        const currentTime = frame / this.precomp.fps;

        const inWindow: AudioRequest[] = [];
        const srcs = new Set<string>();
        const required = new Set<string>();
        const seen = new Set<string>();

        const consider = (req: AudioRequest, offsetSecs: number): void => {
            const globalStart = offsetSecs + req.startAt;
            const globalEnd = offsetSecs + req.endAt;

            if (globalEnd < currentTime || globalStart > currentTime + 10) return;
            // Ahead of the dedupe: the flag is not part of a request's identity.
            if (!req.optional) required.add(req.src);

            const stableId = stableKey(req, offsetSecs);
            if (seen.has(stableId)) return;
            seen.add(stableId);

            inWindow.push({
                ...req,
                id: stableId,
                startAt: globalStart,
                endAt: globalEnd,
                // A bus's span is in its request's seconds, so it moves with it.
                ...(req.bus && {
                    bus: req.bus.map((s) => ({ ...s, startAt: offsetSecs + s.startAt, endAt: offsetSecs + s.endAt })),
                }),
            });
            srcs.add(req.src);
        };

        for (const track of this.precomp.tracks) {
            const offsetSecs = track.startFrame / this.precomp.fps;
            for (const req of track.audioRequests) consider(req, offsetSecs);
        }

        this.audioRequired = required;
        for (const src of srcs) {
            if (!this.audioDevice.has(src) && !this.audioFetching.has(src) && !this.audioFailed.has(src)) {
                const job = this.storageAdapter.fetchAudioData(src)
                    .then(data => this.audioDevice.append(src, data))
                    .catch(cause => this.failAudio(src, cause))
                    .finally(() => this.audioFetching.delete(src));
                this.audioFetching.set(src, job);
            }
        }
        // A failed source nothing asks for any more is forgotten so it is tried afresh when wanted; one that failed quietly is reported when a request for its sound arrives.
        for (const [src, cause] of this.audioFailed) {
            if (!srcs.has(src)) {
                this.audioFailed.delete(src);
                this.audioReported.delete(src);
            } else if (required.has(src)) {
                this.reportAudio(src, cause);
            }
        }

        const requestKey = audioSignature(inWindow);
        if (requestKey !== this.lastAudioRequestKey) {
            this.audioDevice.schedule(inWindow);
            this.lastAudioRequestKey = requestKey;
        }
        if (this.lastAudioSrcs === null || !setsEqual(this.lastAudioSrcs, srcs)) {
            this.audioDevice.retain(srcs);
            this.lastAudioSrcs = srcs;
        }
    }

    /** Record that `src` could not be loaded, and say so if a request asked for its sound. */
    private failAudio(src: string, cause: unknown): void {
        if (this.disposed) return;
        this.audioFailed.set(src, cause);
        if (this.audioRequired.has(src)) this.reportAudio(src, cause);
    }

    /** Say that `src` could not be loaded, once, until it is wanted afresh. */
    private reportAudio(src: string, cause: unknown): void {
        if (this.audioReported.has(src)) return;
        this.audioReported.add(src);
        const message = cause instanceof Error ? cause.message : String(cause);
        this.onError(new Error(`audio "${src}" could not be loaded: ${message}`, { cause }));
    }
}

function layoutGatesOf(precomp: AssetTimelineResult): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const track of precomp.tracks) for (const key of track.layoutGates ?? []) keys.add(key);
    return keys;
}

/** Stand-in for a loader that resolved nothing — see the note in {@link AssetManager.syncLoader}. */
const NO_DISPOSE: Disposer = () => { };

/** A deterministic key for an audio request's playback identity, including its effects, ramps, transitions and bus chain: editing any changes what it sounds like, so the device must stop the stale source and rebuild the graph. */
function stableKey(req: AudioRequest, clipOffsetSecs: number): string {
    return `${req.src}|${clipOffsetSecs + req.startAt}|${clipOffsetSecs + req.endAt}|${req.trimStart}|${req.trimEnd ?? "_"}|${req.loop ? 1 : 0}|${paramKey(req.volume)}|${paramKey(req.speed)}|${req.sourceLength ?? "_"}|${effectsKey(req.effects)}|${transitionKey(req.transitionIn)}|${transitionKey(req.transitionOut)}|${busKey(req.bus)}`;
}

function busKey(bus: AudioRequest["bus"]): string {
    if (!bus || bus.length === 0) return "";
    return bus.map(busStopKey).join(">");
}

/** Produce a stable hash of the active audio request set to detect scheduling changes. */
function audioSignature(reqs: readonly AudioRequest[]): string {
    if (reqs.length === 0) return "";
    return reqs.map(r => r.id).sort().join("\n");
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}
