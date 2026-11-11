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
    trackId: string;
    message: string;
    stack?: string;
    /** The node whose declaration threw, when one owner failed rather than the whole clip. */
    nodeId?: string;
    prop?: string;
    /**
     * Present when the build stepped around the problem instead of failing: a row of an unregistered type built as
     * an empty placeholder (`nodeId`), or a command no node publishes, skipped (`commandId`). The rest of the clip
     * draws.
     */
    code?: "unknown-node-type" | "unknown-command";
    commandId?: string;
    issue?: RenderIssue;
}

/** In clip-local frames, so a pass survives its track moving; only `startFrame` depends on where it sits. */
export interface TrackAssets {
    id: string;
    /** Whether the pass has run. An undiscovered track has its span but no assets or audio yet. */
    discovered: boolean;
    frameCount: number;
    startFrame: number;
    audioRequests: AudioRequest[];
    /** Asset usage in clip-local frames, keyed by stable asset key (src; family for a font). */
    assetRecords: ReadonlyMap<string, AssetRecord>;
    /** Keys that must be resident before layout measures: fonts, and loaders declared with `gate: "layout"`. */
    layoutGates?: string[];
}

export type AssetTimelinePhase =
    | "build"
    | "declare"
    | "evaluate"
    | "audio";

const ASSET_TIMELINE_PHASES: readonly AssetTimelinePhase[] = ["build", "declare", "evaluate", "audio"];

export interface TrackAssetsTiming {
    trackId: string;
    trackIndex: number;
    frameCount: number;
    totalMs: number;
    phases: Record<AssetTimelinePhase, number>;
}

export type AssetTimelineTimings = (TrackAssetsTiming | undefined)[];

/**
 * `enter` closes whichever phase was open and starts the named one; `suspend`/`resume` bracket a yield so
 * parked time is not billed to the open phase.
 */
export interface TrackAssetsProfile {
    enter(phase: AssetTimelinePhase): void;
    suspend(): void;
    resume(): void;
    done(frameCount: number): void;
}

/** A seam, so core carries no environment assumption. */
export interface AssetTimelineProfile {
    track(trackIndex: number, trackId: string): TrackAssetsProfile;
}

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

export interface AssetTimelineResult {
    fps: number;
    tracks: TrackAssets[];
    totalFrames: number;
    totalDuration: number;
    assets: ReadonlyMap<string, AssetTrack>;
    buildErrors: BuildError[];
    /** True once every track has been discovered. Spans and totals are exact either way. */
    complete: boolean;
    timings?: AssetTimelineTimings;
}

export interface AssetTimelineOptions {
    profile?: AssetTimelineProfile;
    /**
     * Shared with an evaluator so each track builds once. Absent, the view owns a store that drops each tree once
     * refined; nothing it builds is drawn.
     */
    store?: ClipStore;
    /** False declares audio alone, at arrival — for a caller that only mixes. Ignored with `store`. */
    assets?: boolean;
}

export interface RunAsyncOptions {
    /** Wall-clock ms before yielding. Defaults to {@link DEFAULT_PRECOMP_BUDGET_MS}; `0` yields between every frame evaluated. */
    budgetMs?: number;
    isCancelled?: () => boolean;
    onProgress?: (result: AssetTimelineResult) => void;
}

/**
 * A view over a {@link ClipStore}, which holds the builds, indices and audio. Spans come from the document, so
 * this decides which assets a frame needs, never where a track sits. A result is the same object until
 * something in it changes, so a caller can tell a republish from a no-op by identity.
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

    get discoveredCount(): number {
        let n = 0;
        for (const track of this._store.tracks) if (this._store.isDiscovered(track.id)) n++;
        return n;
    }

    result(): AssetTimelineResult {
        return this._assemble();
    }

    ensureCovering(frame: number): AssetTimelineResult {
        for (const span of spansCovering(this._store.spans, frame)) this._store.discover(span.id);
        return this._assemble();
    }

    run(): AssetTimelineResult {
        for (const track of this._store.tracks) this._store.discover(track.id);
        return this._assemble();
    }

    /**
     * A pass whose track changed while parked is dropped, and the scan picks again from the document as it is now.
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

    setProject(next: ProjectDocument): AssetTimelineResult {
        this._store.setProject(next);
        return this._assemble();
    }

    /** A track not discovered yet is left alone: its pass will declare for itself. */
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

/** The `open` marker is kept, so the next assembly re-resolves it. */
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
