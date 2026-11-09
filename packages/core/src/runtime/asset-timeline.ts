import { AudioRequest } from "@/attributes/audio/request";
import { AssetRecord } from "@/assets/record";
import type { AssetDecl } from "@/assets/scope";
import type { ProjectDocument } from "@/document/project";
import type { RenderIssue } from "@/render/render-issue";
import { now } from "@/util/scheduler";
import type { RuntimeScope } from "./clip-instance";
import { ClipStore, DEFAULT_PRECOMP_BUDGET_MS } from "./clip-store";
import { spansCovering, totalFramesOf } from "./placement";
import { ProjectAssets, type AssetTrack } from "./project-assets";

export type { AssetTrack } from "./project-assets";

export interface BuildError {
    /** The track whose clip threw. */
    trackId: string;
    message: string;
    stack?: string;
    /** The node whose declaration threw, when one owner failed rather than the whole clip. */
    nodeId?: string;
    /** The last prop that declaration read, as `slotLabel` spells it. */
    prop?: string;
    /**
     * Present when the build stepped around the problem rather than failing: a
     * row of an unregistered type built as an empty placeholder (`nodeId`), or a
     * command no node publishes, skipped (`commandId`). The rest of the clip draws.
     */
    code?: "unknown-node-type" | "unknown-command";
    commandId?: string;
    /** Set when the error is a renderer's issue rather than something that threw. */
    issue?: RenderIssue;
}

/**
 * What discovering one track's clip learned, in **clip-local** frames — so a pass
 * survives its track moving, and only `startFrame` depends on where it sits.
 */
export interface TrackAssets {
    id: string;
    /** Whether the pass has run. An undiscovered track has its span but no assets or audio yet. */
    discovered: boolean;
    frameCount: number;
    /** Where the track starts on the project timeline. */
    startFrame: number;
    /** Audio its nodes emit, in clip-local seconds. */
    audioRequests: AudioRequest[];
    /** Asset usage in clip-local frames, keyed by stable asset key (src; family for a font). */
    assetRecords: ReadonlyMap<string, AssetRecord>;
    /** Keys that must be resident before layout measures: fonts, and loaders declared with `gate: "layout"`. */
    layoutGates?: string[];
}

// ─── Profiling ────────────────────────────────────────────────────────────────

/** The distinct pieces of work a pass performs. */
export type AssetTimelinePhase =
    | "build"
    | "declare"
    | "evaluate"
    | "audio";

const ASSET_TIMELINE_PHASES: readonly AssetTimelinePhase[] = ["build", "declare", "evaluate", "audio"];

/** Wall-clock breakdown of one track's pass, in milliseconds. */
export interface TrackAssetsTiming {
    trackId: string;
    trackIndex: number;
    frameCount: number;
    /** Total ms spent inside the pass, excluding time parked on a yield. */
    totalMs: number;
    /** Ms attributed to each phase, summed over the pass. */
    phases: Record<AssetTimelinePhase, number>;
}

/** Per-track timings, in document order. Sparse until every track has run. */
export type AssetTimelineTimings = (TrackAssetsTiming | undefined)[];

/**
 * Timing sink for one track's pass. `enter` closes whichever phase was open and
 * starts the named one; `suspend`/`resume` bracket a yield so parked time isn't
 * billed to the open phase.
 */
export interface TrackAssetsProfile {
    enter(phase: AssetTimelinePhase): void;
    suspend(): void;
    resume(): void;
    done(frameCount: number): void;
}

/** Optional profiler injected into {@link AssetTimeline} — a seam, so core carries no environment assumption. */
export interface AssetTimelineProfile {
    track(trackIndex: number, trackId: string): TrackAssetsProfile;
}

/** A {@link AssetTimelineProfile} accumulating into {@link AssetTimelineTimings}; read them off `AssetTimelineResult.timings`. */
export function createAssetTimelineProfile(): AssetTimelineProfile & { timings: AssetTimelineTimings } {
    const timings: AssetTimelineTimings = [];
    return {
        timings,
        track(trackIndex: number, trackId: string): TrackAssetsProfile {
            const phases = Object.fromEntries(
                ASSET_TIMELINE_PHASES.map(p => [p, 0]),
            ) as Record<AssetTimelinePhase, number>;
            let open: AssetTimelinePhase | null = null;
            let since = now();
            let totalMs = 0;
            const close = () => {
                const elapsed = now() - since;
                if (open) phases[open] += elapsed;
                totalMs += elapsed;
            };
            return {
                enter(phase) {
                    close();
                    open = phase;
                    since = now();
                },
                suspend() {
                    close();
                    open = null;
                },
                resume() {
                    since = now();
                },
                done(frameCount) {
                    close();
                    open = null;
                    timings[trackIndex] = { trackId, trackIndex, frameCount, totalMs, phases };
                },
            };
        },
    };
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface AssetTimelineResult {
    fps: number;
    /** Every track, in document order, discovered or not. */
    tracks: TrackAssets[];
    totalFrames: number;
    totalDuration: number;
    /** Every track's asset usage merged into one timeline, in project frames. */
    assets: ReadonlyMap<string, AssetTrack>;
    buildErrors: BuildError[];
    /** True once every track has been discovered. Spans and totals are exact either way. */
    complete: boolean;
    /** Present only when a {@link AssetTimelineProfile} was injected. */
    timings?: AssetTimelineTimings;
}

export interface AssetTimelineOptions {
    profile?: AssetTimelineProfile;
    /** @deprecated Ignored: a node's bar is its document span, read off the live tree. */
    lifespans?: boolean;
    /**
     * The store to read and drive, shared with an evaluator so each track builds
     * once. Absent, the view owns a store of its own that drops each tree once it
     * is refined — nothing it builds is ever drawn.
     */
    store?: ClipStore;
    /** False declares audio alone, at arrival — for a caller that only mixes. Ignored with `store`. */
    assets?: boolean;
}

export interface RunAsyncOptions {
    /** Wall-clock ms before yielding. Defaults to {@link DEFAULT_PRECOMP_BUDGET_MS}; `0` yields between every frame evaluated. */
    budgetMs?: number;
    /** Polled after every yield; true abandons the pass. */
    isCancelled?: () => boolean;
    /** Called with a fresh result each time a track is discovered. */
    onProgress?: (result: AssetTimelineResult) => void;
}

/**
 * Discovers what each track's clip needs over its span — asset windows and
 * audio — and publishes it as one result over the project timeline.
 *
 * A view: the builds, indices and audio live in a {@link ClipStore}, and this
 * assembles them. Spans come from the document, so this decides which assets a
 * frame needs, never where a track sits; moving a track only changes where its
 * records are shifted to. A result is the same object until something in it
 * changes, so a caller can tell a republish from a no-op by identity.
 */
export class AssetTimeline {
    constructor(project: ProjectDocument, private readonly _scope: RuntimeScope, options: AssetTimelineOptions = {}) {
        this._owned = options.store === undefined;
        this._store = options.store ?? new ClipStore(project, _scope, {
            profile: options.profile,
            assets: options.assets,
            keepInstances: false,
        });
        this._assets = new ProjectAssets(_scope.fps, _scope.assets);
    }

    get store(): ClipStore {
        return this._store;
    }

    /** How many tracks are discovered — a cheap change check for a caller on the seek path. */
    get discoveredCount(): number {
        let n = 0;
        for (const track of this._store.tracks) if (this._store.isDiscovered(track.id)) n++;
        return n;
    }

    /** The result as it stands, discovering nothing. */
    result(): AssetTimelineResult {
        return this._assemble();
    }

    /** Discover every track covering `frame` — what that frame needs before it can paint. */
    ensureCovering(frame: number): AssetTimelineResult {
        for (const span of spansCovering(this._store.spans, frame)) this._store.discover(span.id);
        return this._assemble();
    }

    /** Discover every track, synchronously. */
    run(): AssetTimelineResult {
        for (const track of this._store.tracks) this._store.discover(track.id);
        return this._assemble();
    }

    /**
     * Discover every track in start order, yielding between the frames a pass evaluates and
     * publishing a result as each lands. A pass whose track changed while it was
     * parked is dropped, and the scan picks again from the document as it is now.
     */
    async runAsync(options: RunAsyncOptions = {}): Promise<AssetTimelineResult> {
        const { budgetMs = DEFAULT_PRECOMP_BUDGET_MS, isCancelled, onProgress } = options;
        await this._store.runAsync({
            budgetMs,
            isCancelled,
            onProgress: onProgress && (() => onProgress(this._assemble())),
        });
        return this._assemble();
    }

    /** Take a new document — see {@link ClipStore.setProject}. */
    setProject(next: ProjectDocument): AssetTimelineResult {
        this._store.setProject(next);
        return this._assemble();
    }

    /**
     * Record that `ownerKey` needed `decl` at clip-local `localFrame` without
     * having declared it — the draw found it missing. A track not discovered yet
     * is left alone: its pass will declare for itself.
     */
    learn(trackId: string, ownerKey: string, decl: AssetDecl, localFrame: number): AssetTimelineResult {
        this._store.learn(trackId, ownerKey, decl, localFrame);
        return this._assemble();
    }

    /** Dispose the store this view owns; a shared one is its owner's to dispose. */
    dispose(): void {
        if (this._owned) this._store.dispose();
    }

    private readonly _store: ClipStore;
    private readonly _owned: boolean;
    private readonly _assets: ProjectAssets;
    private _result: AssetTimelineResult | null = null;
    private _version = -1;

    private _assemble(): AssetTimelineResult {
        const store = this._store;
        if (this._result && this._version === store.version) return this._result;
        const { fps } = this._scope;
        const spans = store.spans;
        const totalFrames = totalFramesOf(spans);
        const totalDuration = totalFrames / fps;
        const tracks: TrackAssets[] = [];
        const buildErrors: BuildError[] = [];
        let complete = true;

        const local: TrackAssets[] = spans.map((span) => {
            const found = store.trackAssets(span.id);
            if (!found) complete = false;
            buildErrors.push(...store.errorsOf(span.id));
            return found ?? undiscovered(span.id, span.endFrame - span.startFrame + 1);
        });
        const assets = this._assets.update(local.map((track, i) => ({
            id: track.id,
            startFrame: spans[i].startFrame,
            records: track.assetRecords,
        })));
        for (let i = 0; i < local.length; i++) {
            tracks.push(resolveOpenAudio({ ...local[i], startFrame: spans[i].startFrame }, fps, totalDuration));
        }

        const profiled = store.profile as (AssetTimelineProfile & { timings?: AssetTimelineTimings }) | undefined;
        this._version = store.version;
        return this._result = {
            fps,
            tracks,
            totalFrames,
            totalDuration,
            assets,
            buildErrors,
            complete,
            timings: profiled?.timings?.slice(),
        };
    }
}

/** A track nothing has discovered yet: its span, and nothing else. */
function undiscovered(id: string, frameCount: number): TrackAssets {
    return {
        id,
        discovered: false,
        frameCount,
        startFrame: 0,
        audioRequests: [],
        assetRecords: new Map(),
        layoutGates: [],
    };
}

/**
 * A copy of `track` with every open audio request's `endAt` resolved against the
 * project total. The `open` marker is kept, so the next assembly re-resolves it.
 */
function resolveOpenAudio(track: TrackAssets, fps: number, totalDuration: number): TrackAssets {
    if (!track.audioRequests.some((r) => r.open)) return track;

    const offset = track.startFrame / fps;
    const audioRequests = track.audioRequests.map((req) => {
        if (!req.open) return req;
        const absStart = offset + req.startAt;
        const naturalEnd = req.loop
            ? totalDuration
            : Math.min(absStart + (req.mediaDuration ?? 0), totalDuration);
        return { ...req, endAt: Math.max(req.startAt, naturalEnd - offset) };
    });
    return { ...track, audioRequests };
}
