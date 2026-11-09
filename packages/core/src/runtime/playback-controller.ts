import { AssetManager } from "../assets/manager";
import { MeasureContext2D } from "../render/measure-context";
import { CanvasRenderContext2D } from "../render/canvas-render-context2d";
import { asTextBlockSource } from "../render/text-layout";
import { renderIssueKey, toRenderIssue, type RenderIssue } from "../render/render-issue";
import { StateEvaluator } from "./state-evaluator";
import { renderSettled, SETTLE_PASSES, type SettleOutcome } from "./settle";
import { NodeState, TreeState, WaveformInfo, nodePath } from "@/project/tree";
import { AudioRequest } from "@/attributes/audio/request";
import { StorageAdapter } from "../platform/storage-adapter";
import { BuildError, AssetTimeline, AssetTimelineResult, type AssetTimelineProfile } from "./asset-timeline";
import { ClipStore, DEFAULT_PRECOMP_BUDGET_MS } from "./clip-store";
import type { AssetDecl } from "@/assets/scope";
import { yieldToScheduler } from "@/util/scheduler";
import { Ticker, TimeCallback } from "@/platform/ticker";
import { AudioSink } from "@/platform/audio-sink";
import { AssetCatalog } from "@/assets/catalog";
import { AssetNotLoadedError } from "@/assets/errors";
import type { AssetRecord } from "@/assets/record";
import { Size2D } from "@/attributes/layout/size";
import { Node } from "@/components/trees/node/node";
import { Node2D, type NodeHandle } from "@/components/trees/2d/node2d";
import type { NodeEditorStates } from "@/components/trees/node/node-editor-state";
import type { ProjectDocument } from "@/document/project";
import type { Registry } from "@/document/registry";
import { Vector2 } from "@/attributes/layout/vector2";
import { NodeBox, childPlanePointAt, collectBoxes, handleValueAt, nodeAt, nodeBoxAt, nodeHandlesAt, parentPlanePointAt, pickNode, projectNode3DAt, reparentPlacementAt, type ReparentPlacement } from "./node-picking";
import type { Node3DFrame } from "./node-picking3d";
import type { Vector3 } from "@/render3d/vector3";
import { NodeTextLayout, nodeTextLayout } from "./text-geometry";
import { spanFrames, spansCovering, trackFrameCount, type TrackSpan } from "./placement";
import { clipFrameToTime, clipTimeToFrame } from "./frame-time";

/**
 * Transient prop values layered over a node's evaluated state — see
 * {@link PlaybackController.setNodeOverride}. Keys are prop names the node
 * accepts (`x`, `y`, `rotation`, `width`, …).
 */
export type NodeOverride = Record<string, unknown>;

/** Dependencies injected into `PlaybackController` at construction time. */
export type ControllerParams = {
    /** The project to play, its fps and viewport resolved — see `Session`. */
    project: ProjectDocument;
    /** The vocabulary its clips compile against. */
    registry: Registry;
    renderContext: CanvasRenderContext2D;
    measurer: MeasureContext2D;
    storageAdapter: StorageAdapter;
    masterClock: Ticker;
    audioDevice: AudioSink;
    assets: AssetCatalog;
    /**
     * Wall-clock ms the background discovery may run before yielding. Defaults
     * to {@link DEFAULT_PRECOMP_BUDGET_MS}; `0` in tests yields between every
     * sample interval, making preemption deterministic.
     */
    precompBudgetMs?: number;
    precompProfile?: AssetTimelineProfile;
    /**
     * Called each time background discovery lands another track. Passed at
     * construction so a fast first track can't publish before the caller attaches.
     */
    onPrecompProgress?: (result: AssetTimelineResult) => void;
};

/**
 * Orchestrates playback of a project document.
 *
 * On construction it discovers what frame 0 needs, then streams the rest of the
 * project's asset timeline in behind the first paint. Every clock tick:
 *
 * 1. Loads assets required at the current frame (`AssetManager.loadAt`).
 * 2. Evaluates the tracks on screen and lays them out (`StateEvaluator`).
 * 3. Renders the frame to the render context.
 * 4. Prefetches assets for upcoming frames.
 */
export class PlaybackController {
    private renderContext: CanvasRenderContext2D;
    private measurer: MeasureContext2D;
    private storageAdapter: StorageAdapter;
    private masterClock: Ticker;
    private stateEvaluator: StateEvaluator;
    private assetManager: AssetManager;
    private audioDevice: AudioSink;
    /**
     * Held rather than merely handed on, because {@link recoverMissingAsset} has
     * to build a record for a source no pass declared, from what the catalog
     * knows of it.
     */
    private readonly assetCatalog: AssetCatalog;
    /**
     * Called synchronously at the end of every frame this controller paints, on
     * the same task as the draw — for a host drawing *over* the canvas (a
     * selection box, a caret) that must measure the tree for the frame just
     * drawn rather than poll and trail a fast scrub. Called after the draw, so a
     * throwing listener is never mistaken for a render failure.
     */
    onFramePainted?: (frame: number) => void;

    /** Set by dispose(); once true the controller must never touch its (now-freed) render context again. */
    private disposed = false;
    /** One background pass at a time — see {@link startBackgroundPrecomp}. */
    private precompRunning = false;
    /**
     * Whether a frame has ever been drawn. Every render pass but {@link repaint}
     * loads the frame's assets first, so this is what `repaint` waits on before
     * it will draw one of its own.
     */
    private hasPainted = false;
    /**
     * Monotonic token bumped by every seek / tick / swap. A render pass captures
     * it at entry and bails before painting if a newer pass has begun, so a
     * superseded seek never stamps its stale frame over a newer one.
     */
    private seekGeneration = 0;
    private readonly precompBudgetMs: number;
    private readonly onPrecompProgress?: (result: AssetTimelineResult) => void;
    readonly fps: number;
    readonly viewport: Size2D;
    private readonly precomper: AssetTimeline;
    /** The one build per track that discovery, the evaluator and the editor API share. */
    private readonly store: ClipStore;
    /**
     * Transient prop values re-applied after every state evaluation, keyed by
     * structural path so they survive a rebuild. See {@link setNodeOverride}.
     */
    private readonly overrides = new Map<string, NodeOverride>();
    /** Latest assembled precomp result. */
    precomp: AssetTimelineResult;

    /** Every track's span on the project timeline, in document order. */
    get spans(): readonly TrackSpan[] {
        return this.precomp.tracks.map((track, index) => ({
            id: track.id,
            index,
            startFrame: track.startFrame,
            endFrame: track.startFrame + track.frameCount - 1,
        }));
    }

    get totalFrames(): number {
        return this.precomp.totalFrames;
    }

    /** Total playback duration in seconds. */
    get totalDuration(): number {
        return this.precomp.totalDuration;
    }

    /** The track the editor API reads from — see `StateEvaluator.currentTrackId`. */
    get currentTrackId(): string | null {
        return this.stateEvaluator.currentTrackId;
    }

    /**
     * Errors collected while discovering tracks, plus any thrown while
     * *drawing* — one list, because a consumer showing them has the same thing
     * to say about both: this frame is not what the document says.
     */
    get buildErrors(): BuildError[] {
        if (this.renderErrors.length === 0) return this.precomp.buildErrors;
        return [...this.precomp.buildErrors, ...this.renderErrors];
    }

    /**
     * Errors thrown by a render pass, deduplicated by message. A render throwing
     * happens per frame, at pointer rate while scrubbing, and left to propagate
     * it was an unhandled rejection and a canvas that simply stopped drawing.
     */
    private readonly renderErrors: BuildError[] = [];

    /** Called when {@link renderErrors} gains an entry. Set by the host. */
    onRenderError?: (errors: BuildError[]) => void;

    /**
     * Record a draw-time failure and tell the host, once per distinct message.
     * Swallowing it is the point: one bad frame must not take down the clock loop.
     */
    private captureRenderError(error: unknown, frame?: number, issue?: RenderIssue): void {
        const e = error instanceof Error ? error : new Error(String(error));
        // A frame can reach for an asset no pass declared — an override previewing
        // an edit puts a picture on a node the rebuild that would declare it has
        // not run yet. The error names the source, so load it and paint again.
        if (frame !== undefined && this.recoverMissingAsset(e, frame)) return;
        if (issue) {
            const key = renderIssueKey(issue);
            if (this.renderErrors.some((prior) => prior.issue && renderIssueKey(prior.issue) === key)) return;
        } else if (this.renderErrors.some((prior) => !prior.issue && prior.message === e.message)) return;
        this.renderErrors.push({
            trackId: this.stateEvaluator.currentTrackId ?? "",
            message: e.message,
            ...(issue ? { issue, ...(issue.nodeId !== undefined && { nodeId: issue.nodeId }) } : { stack: e.stack }),
        });
        this.onRenderError?.(this.buildErrors);
    }

    /**
     * Widen the drawing track's index by what the draw found missing, so the next
     * visit to this frame loads it ahead. The owner is the node the error names,
     * or else whoever declared the source elsewhere in the clip.
     */
    private learnMissingAsset(error: AssetNotLoadedError, frame: number): void {
        const decl = declOf(error, this.assetCatalog);
        if (!decl) return;
        for (const trackId of [...this.stateEvaluator.activeTrackIds].reverse()) {
            const instance = this.store.instanceOf(trackId);
            const track = this.precomp.tracks.find((t) => t.id === trackId);
            if (!instance || !track) continue;
            let ownerKey: string | undefined;
            if (error.nodeId !== undefined) {
                instance.forEachOwner((node, key) => {
                    if (ownerKey === undefined && node.id === error.nodeId) ownerKey = key;
                });
            }
            ownerKey ??= this.store.ownersOf(trackId, error.src).values().next().value;
            if (ownerKey === undefined) continue;
            const next = this.precomper.learn(trackId, ownerKey, decl, Math.floor(frame) - track.startFrame);
            if (next !== this.precomp) this.adoptPrecomp(next);
            return;
        }
    }

    /**
     * Sources already tried by {@link recoverMissingAsset}, so a picture that
     * genuinely cannot be fetched is reported rather than re-fetched every frame
     * of a drag. Cleared by {@link clearRenderErrors}.
     */
    private readonly rescuedAssets = new Set<string>();

    /**
     * Load an asset a frame reached for but nothing had declared, then paint that
     * frame again. Deliberately narrow: only {@link AssetNotLoadedError}, only a
     * source the catalog can describe, and only once per source.
     */
    private recoverMissingAsset(error: Error, frame: number): boolean {
        if (!(error instanceof AssetNotLoadedError)) return false;
        // Audio is fetched on demand by the audio device, not through the storage adapter.
        if (error.assetType === "audio") return false;
        const token = `${error.assetType}:${error.src}`;
        if (this.rescuedAssets.has(token)) return false;
        this.rescuedAssets.add(token);
        // Once per source, like the rescue: a source that never loads would otherwise republish every frame.
        this.learnMissingAsset(error, frame);

        const record = this.recordFor(error.assetType, error.src, frame);
        if (!record) return false;

        void this.storageAdapter.loadAsset(error.src, record)
            .then(() => {
                if (this.disposed) return;
                this.renderAt(this.stateEvaluator.currentFrame);
                this.settleTrailing();
            })
            .catch((cause) => {
                if (this.disposed) return;
                // No `frame`, so it cannot come back through here a second time.
                this.captureRenderError(
                    new Error(`${error.message}\n\nLoading it directly also failed: ${String(cause)}`),
                );
            });
        return true;
    }

    /**
     * A one-frame record describing `src` well enough to load it, from the
     * catalog's own metadata — or `null` when the catalog has never heard of it.
     */
    private recordFor(type: AssetNotLoadedError["assetType"], src: string, frame: number): AssetRecord | null {
        try {
            if (type === "font") {
                // 400 is what an unsuffixed font key assumes.
                return {
                    type: "font", src, startFrame: frame, endFrame: frame,
                    fontFamily: src, fontWeight: 400,
                };
            }
            if (type === "image") {
                // Throws for a source the catalog has never heard of.
                this.assetCatalog.getImageMeta(src);
                return { type: "image", src, startFrame: frame, endFrame: frame };
            }
            this.assetCatalog.getVideoMeta(src);
            return {
                type: "video", src, startFrame: frame, endFrame: frame,
                trimStart: 0, trimEnd: this.assetCatalog.getVideoDuration(src),
            };
        } catch {
            return null;
        }
    }

    /** Forget draw-time errors — called when what they were about is replaced. */
    clearRenderErrors(): void {
        this.rescuedAssets.clear();
        if (this.renderErrors.length === 0) return;
        this.renderErrors.length = 0;
        this.onRenderError?.(this.buildErrors);
    }

    constructor(params: ControllerParams) {
        const { project } = params;
        if (project.fps === undefined || project.viewport === undefined) {
            throw new Error("PlaybackController takes a project whose fps and viewport are resolved — see Session.");
        }
        this.renderContext = params.renderContext;
        this.measurer = params.measurer;
        this.masterClock = params.masterClock;
        this.storageAdapter = params.storageAdapter;
        this.audioDevice = params.audioDevice;
        this.fps = project.fps;
        this.viewport = project.viewport;
        this.precompBudgetMs = params.precompBudgetMs ?? DEFAULT_PRECOMP_BUDGET_MS;
        this.onPrecompProgress = params.onPrecompProgress;
        this.assetCatalog = params.assets;

        const scope = {
            registry: params.registry,
            viewport: this.viewport,
            fps: this.fps,
            assets: params.assets,
            measurer: this.measurer,
        };
        this.store = new ClipStore(project, scope, {
            profile: params.precompProfile,
            // Nothing is resident before the manager exists, which is what the first build should see.
            isReady: (key) => this.assetManager?.isReady(key) ?? false,
        });
        this.precomper = new AssetTimeline(project, scope, { store: this.store });
        // Only what frame 0 needs — the rest streams in behind the first paint,
        // so time-to-first-frame is O(the tracks on screen), not O(the project).
        this.precomp = this.precomper.ensureCovering(0);
        this.stateEvaluator = new StateEvaluator(project, scope, this.store);
        this.assetManager = new AssetManager(
            this.precomp, this.storageAdapter, this.audioDevice,
            (error) => this.captureRenderError(error),
        );

        this.masterClock.setDuration(this.totalDuration);

        this.masterClock.onPlay((t, speed, reverse) => {
            this.audioDevice.play(t, speed, reverse);
            this.storageAdapter.setPlaying(true);
        });
        this.masterClock.onPause(() => {
            this.audioDevice.stop();
            this.storageAdapter.setPlaying(false);
        });
        this.masterClock.onTick(async (currentTime: number) => {
            // A tick is also a render pass: claim a generation so a stale paused
            // seek can't paint after the clock has moved on (and vice-versa).
            const gen = ++this.seekGeneration;
            const frame = clipTimeToFrame(currentTime, this.fps);
            if (frame >= this.totalFrames) this.masterClock.pause();
            this.discoverThrough(frame);
            await this.loadFrame(frame);
            if (!this.isCurrent(gen)) return;
            this.audioDevice.syncTo(currentTime);
            this.renderAt(frame);
            this.assetManager.prefetch(frame);
            this.trimAround(frame);
        });

        this.startBackgroundPrecomp();
    }

    /**
     * Discover the remaining tracks off the critical path, republishing the
     * asset timeline as each one lands. Deferred behind a yield so the first
     * frame paints before this starts competing for the main thread.
     */
    private startBackgroundPrecomp(): void {
        if (this.precompRunning || this.disposed || this.precomp.complete) return;
        this.precompRunning = true;
        void (async () => {
            try {
                await yieldToScheduler();
                // Looped: a document swapped in during the pass's last step has
                // no yield left for the pass to notice it by.
                while (!this.disposed && !this.precomp.complete) {
                    const final = await this.precomper.runAsync({
                        budgetMs: this.precompBudgetMs,
                        isCancelled: () => this.disposed,
                        onProgress: result => this.adoptPrecomp(result),
                    });
                    if (this.disposed) return;
                    if (!this.precomp.complete) this.adoptPrecomp(final);
                }
            } finally {
                this.precompRunning = false;
            }
        })();
    }

    /**
     * Swap in a newly assembled result. `setPrecomp` resets the asset manager's
     * audio signature, which is what reschedules audio a new result changed.
     */
    private adoptPrecomp(next: AssetTimelineResult): void {
        if (this.disposed) return;
        this.precomp = next;
        this.assetManager.setPrecomp(next);
        this.masterClock.setDuration(this.totalDuration);
        this.onPrecompProgress?.(next);
    }

    /**
     * Discover the tracks covering `frame` before anything loads or draws it — a
     * track nobody discovered has no asset windows, so its frame would reach for
     * decodes nothing loaded. Cheap once they are: this runs on every tick.
     */
    private discoverThrough(frame: number): void {
        const next = this.precomper.ensureCovering(Math.floor(frame));
        if (next !== this.precomp) this.adoptPrecomp(next);
    }

    /**
     * Load `frame`'s assets and the layout gates of every track covering it —
     * a face must be resident before text measures, whatever its window says.
     */
    private async loadFrame(frame: number): Promise<void> {
        const gates: AssetRecord[] = [];
        for (const span of spansCovering(this.store.spans, Math.floor(frame))) {
            for (const record of this.store.layoutGates(span.id)) {
                if (!this.assetManager.isReady(record.src)) gates.push(record);
            }
        }
        if (gates.length === 0) {
            await this.assetManager.loadAt(frame);
            return;
        }
        await Promise.all([this.assetManager.loadAt(frame), this.assetManager.loadRecords(gates)]);
    }

    /** Keep built trees near the playhead only; a released track keeps what discovery found. */
    private trimAround(frame: number): void {
        if (Math.abs(frame - this.lastTrimFrame) < this.fps) return;
        this.lastTrimFrame = frame;
        this.store.trim(Math.floor(frame), Math.ceil(TRIM_HORIZON_SECONDS * this.fps));
    }

    private lastTrimFrame = 0;

    get isPlaying(): boolean {
        return this.masterClock.isPlaying;
    }

    /** Current playback position in seconds. */
    get currentTime(): number {
        return this.masterClock.currentTime;
    }

    /** Current playback position in frames (float). */
    get currentFrame(): number {
        return clipTimeToFrame(this.masterClock.currentTime, this.fps);
    }

    /** Register a callback that fires on every clock tick with the current time. */
    onTime(cb: TimeCallback): void {
        this.masterClock.onTime(cb);
    }

    /** Register a callback that fires when playback starts. */
    onPlay(cb: () => void): void {
        this.masterClock.onPlay(() => cb());
    }

    /** Register a callback that fires when playback pauses. */
    onPause(cb: () => void): void {
        this.masterClock.onPause(cb);
    }

    /** True while `gen` is still the latest seek/tick and the controller is alive. */
    private isCurrent(gen: number): boolean {
        return !this.disposed && gen === this.seekGeneration;
    }

    /** Evaluate the tracks on screen, lay them out, and render `frame`. */
    private renderAt(frame: number): void {
        // A disposed controller's surface is freed; an in-flight seek
        // (StrictMode double-mount, HMR) can resolve after dispose().
        if (this.disposed) return;
        this.hasPainted = true;
        this.renders++;
        try {
            // A track whose compile measured a face before it loaded builds again, now that it has.
            this.store.settleGates(spansCovering(this.store.spans, Math.floor(frame)).map((span) => span.id));
            // Evaluation and layout are inside the guard too: a command can throw
            // at a time, and a missing font throws while measuring.
            this.stateEvaluator.stateAt(frame);
            // After evaluation, before layout: an override beats what the document
            // evaluated to, and the layout pass that follows sees it.
            this.applyOverrides();
            this.stateEvaluator.layout(this.measurer);
            this.renderContext.execute(() => {
                this.stateEvaluator.render(this.renderContext);
            });
            for (const raw of this.renderContext.takeRenderIssues()) {
                const issue = toRenderIssue(raw);
                this.captureRenderError(new Error(issue.message), undefined, issue);
            }
        } catch (error) {
            this.captureRenderError(error, frame);
        }
        this.announcePaint(frame);
    }

    /** Tell {@link onFramePainted} a frame has landed, without letting a listener take the render loop down. */
    private announcePaint(frame: number): void {
        if (!this.onFramePainted) return;
        try {
            this.onFramePainted(Math.floor(frame));
        } catch (error) {
            console.error("[PlaybackController] onFramePainted listener threw:", error);
        }
    }

    /**
     * Jump to `frame`, pausing playback first. Waits for required assets to
     * load before rendering, then prefetches upcoming frames.
     */
    async seek(frame: number): Promise<void> {
        if (this.disposed) return;
        const gen = ++this.seekGeneration;
        this.paintInFlight = gen;
        try {
            const clamped = Math.max(0, Math.min(frame, this.totalFrames));
            this.masterClock.pause();
            this.discoverThrough(clamped);
            this.masterClock.seek(clipFrameToTime(clamped, this.fps));
            await this.loadFrame(clamped);
            if (!this.isCurrent(gen)) return;
            // A cold seek can land on a video frame or an image no draw has asked
            // for yet: the render asks, the adapter warms, the frame paints again.
            if (await this.settle(() => this.renderAt(clamped), gen) === "superseded") return;
            this.assetManager.prefetch(clamped);
            this.trimAround(clamped);
        } finally {
            this.paintLanded(gen);
        }
    }

    /**
     * Swap in a new document without rebuilding the backend.
     *
     * A track whose clip is unchanged keeps its tree and its discovery; one whose
     * clip patches in place re-declares only the owners the edit can reach, and
     * republishes the asset timeline only when that changed it. **The swap does not
     * paint**: it loads the frame's assets first, and the canvas keeps the last
     * complete frame until then — strictly better than a current frame with a
     * hole where an added picture has not arrived. See {@link pendingSwap}.
     */
    setProject(next: ProjectDocument): void {
        if (this.disposed) return;
        // Claimed before anything is touched, so a seek parked on a yield unwinds
        // rather than painting into a timeline that moved under it.
        const gen = ++this.seekGeneration;

        this.precomper.setProject(next);
        this.stateEvaluator.setProject(next);
        // Adopts only when the swap changed what is published — an edit no declaration read changes nothing.
        this.discoverThrough(this.currentFrame);
        this.clearRenderErrors();
        this.masterClock.setDuration(this.totalDuration);

        // The timeline may now be shorter than where the playhead sat.
        const frame = Math.min(this.currentFrame, Math.max(0, this.totalFrames - 1));
        this.pendingSwap = gen;
        this.paintInFlight = gen;
        this.lastReplacePaint = this.loadAndRepaint(frame, gen);
        this.startBackgroundPrecomp();
    }

    /**
     * The catalog this controller builds against changed in place: build every
     * track again and repaint, as a swap to the same document would if it could
     * tell. A clip that failed for want of an entry the catalog now has builds,
     * and one measured against an old size is measured again.
     */
    reconcileCatalog(): void {
        if (this.disposed) return;
        this.store.reset();
        this.setProject(this.store.project);
    }

    /** Resolves when the paint {@link setProject} scheduled has landed — for a caller that swaps in order to read the result. */
    whenReplaced(): Promise<void> {
        return this.lastReplacePaint;
    }

    private lastReplacePaint: Promise<void> = Promise.resolve();

    /**
     * The generation claimed by the swap whose paint has not landed yet, or `0`.
     *
     * {@link repaint} stands down while this names the current generation: the
     * swap is loading the frame's assets and owes a paint that reads every
     * override as it stands when it lands. A generation rather than a flag,
     * because a seek can supersede the swap, and a flag nobody cleared would
     * leave `repaint` disabled for the rest of the session.
     */
    private pendingSwap = 0;

    /** Load `frame`'s assets, then paint — abandoning both if a newer pass began. */
    private async loadAndRepaint(frame: number, gen: number): Promise<void> {
        try {
            try {
                await this.loadFrame(frame);
            } catch (err) {
                console.error("[PlaybackController] swap asset load failed:", err);
                return;
            }
            await this.settle(() => this.renderAt(frame), gen);
        } finally {
            // Only this swap's claim is released: a newer one has written its own.
            if (this.pendingSwap === gen) this.pendingSwap = 0;
            this.paintLanded(gen);
        }
    }

    /** Reposition the clock to `frame` without interrupting playback. */
    seekWhilePlaying(frame: number): void {
        // Invalidate any in-flight paused seek so its late render can't paint over
        // the live playback position.
        ++this.seekGeneration;
        const clamped = Math.max(0, Math.min(frame, this.totalFrames));
        this.masterClock.seek(clipFrameToTime(clamped, this.fps));
    }

    /**
     * Capture the current frame as a base-64 PNG data URL. Renders afresh — the
     * drawing buffer may have been cleared since the last tick — and loads the
     * frame's assets first, so the capture is right whatever the caller did
     * before it.
     */
    async screenshot(): Promise<string | undefined> {
        const frame = this.stateEvaluator.currentFrame;
        const gen = ++this.seekGeneration;
        this.paintInFlight = gen;
        try {
            await this.loadFrame(frame);
            if (!this.isCurrent(gen)) return undefined;
            // A capture is kept, not glanced at, so it waits for the upgrades a preview paints behind.
            if (await this.settle(() => this.renderAt(frame), gen, true) === "superseded") return undefined;
            return this.renderContext.screenshot();
        } finally {
            this.paintLanded(gen);
        }
    }

    /** {@link renderSettled} against this controller's generation, warning when a frame never settles. */
    private async settle(render: () => void, gen: number, upgrades = false): Promise<SettleOutcome> {
        const adapter = upgrades ? settlingUpgrades(this.storageAdapter) : this.storageAdapter;
        const outcome = await renderSettled(render, adapter, () => this.isCurrent(gen));
        if (outcome === "exhausted") {
            console.warn(`[PlaybackController] frame ${this.stateEvaluator.currentFrame} still had decodes pending after ${SETTLE_PASSES} passes`);
        }
        return outcome;
    }

    /**
     * The generation of the seek, swap or screenshot still on its way to its
     * paint, or `0`. A repaint behind decodes leaves that paint to it — see
     * {@link settleTrailing}.
     */
    private paintInFlight = 0;

    /** Bumped by every render, so a repaint owed to a landed upgrade can tell whether one has happened since. */
    private renders = 0;

    /** {@link renders} when an upgrade landed with a paint in flight, or `null`. */
    private repaintOwedSince: number | null = null;

    /** Release `gen`'s claim — unless a newer paint has claimed since — and repaint behind what it drew. */
    private paintLanded(gen: number): void {
        if (this.paintInFlight !== gen || this.disposed) return;
        this.paintInFlight = 0;
        if (this.repaintOwedSince !== null) {
            const stale = this.renders === this.repaintOwedSince;
            this.repaintOwedSince = null;
            if (stale && !this.isPlaying) this.renderAt(this.stateEvaluator.currentFrame);
        }
        this.settleTrailing();
    }

    /**
     * The current track's node tree, with each node's frame range on the project
     * timeline and its waveforms attached. Used by the timeline UI. `null` before
     * any track is built.
     */
    getTreeState(): TreeState | null {
        const instance = this.stateEvaluator.currentInstance;
        if (!instance) return null;
        const track = this.precomp.tracks.find(t => t.id === this.stateEvaluator.currentTrackId);
        const trackStart = track?.startFrame ?? 0;
        const frameCount = track?.frameCount ?? trackFrameCount(instance.duration, this.fps);

        const bars = new Map<string, { startFrame: number; endFrame: number }>();
        const pathOfOwner = new Map<string, string>();
        instance.forEachOwner((_node, ownerKey, span, path) => {
            pathOfOwner.set(ownerKey, path);
            const frames = spanFrames(span, this.fps, frameCount);
            if (frames) {
                bars.set(path, { startFrame: trackStart + frames.startFrame, endFrame: trackStart + frames.endFrame });
            }
        });
        const waveformsByPath = waveformsByOwner(track?.audioRequests ?? [], pathOfOwner);
        return nodeToTreeState(instance.canvas, "", bars, waveformsByPath);
    }

    getNodeState(nodeId: string): NodeState | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        const node = findNode(canvas, nodeId);
        if (!node) return null;
        return { id: node.id, type: node.className, properties: node.properties };
    }

    /**
     * What a document node of the current track holds before any command has
     * acted on it, whatever frame is showing and whether or not it is on screen:
     * the props an editor shows for the node itself, where {@link getNodeState}
     * is the node at this frame. `null` when the track holds no such row.
     */
    getNodeInitialProps(nodeId: string): NodeState["properties"] | null {
        return this.stateEvaluator.currentInstance?.baselineProps(nodeId) ?? null;
    }

    // ---- Direct manipulation ----------------------------------------------
    // Where a node's pixels are, what is under a point, and a write path fast
    // enough for a drag. See `runtime/node-picking.ts` for the geometry.

    /**
     * The on-screen box of one node at the current frame, or `null` when the path
     * does not resolve. See {@link NodeBox}.
     *
     * @param path Structural path from {@link TreeState.path}.
     */
    getNodeBox(path: string): NodeBox | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        // Through `nodeBoxAt`, so a path naming a mesh inside a `Canvas3D`
        // resolves too — see `node-picking3d.ts`.
        return nodeBoxAt(canvas, path);
    }

    /**
     * The node's **own** props at a structural path — what it holds right now,
     * in its own coordinate space, the space {@link setNodeOverride} writes into —
     * or `null` when the path doesn't resolve.
     */
    getNodePropsAt(path: string): NodeState["properties"] | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        const node = nodeAt(canvas, path);
        return node ? node.properties : null;
    }

    /** Every visible node's box in draw order — one tree walk instead of N {@link getNodeBox} calls. */
    getNodeBoxes(): NodeBox[] {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return [];
        const out: NodeBox[] = [];
        collectBoxes(canvas, "", out, true);
        return out;
    }

    /**
     * Project points around the `Node3D` at `path`, or `null` when the path
     * doesn't resolve to one. See {@link Node3DFrame}.
     */
    projectNode3D(
        path: string,
        parentPoints: readonly Vector3[],
        localPoints: readonly Vector3[],
    ): Node3DFrame | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        return projectNode3DAt(canvas, path, parentPoints, localPoints);
    }

    /**
     * Where a viewport point lands on the plane the node at `path` is positioned
     * in, in that plane's own y-up frame — see {@link parentPlanePointAt}.
     */
    parentPlanePoint(path: string, point: Vector2): Vector2 | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        return parentPlanePointAt(canvas, path, point);
    }

    /**
     * Where a viewport point lands in the coordinates the node at `path`
     * positions its children in, or `null` when those are pixels — see
     * {@link childPlanePointAt}.
     */
    childPlanePoint(path: string, point: Vector2): Vector2 | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        return childPlanePointAt(canvas, path, point);
    }

    /**
     * What keeps the node at `path` looking as it does once it moves under the
     * node at `parentPath` — see {@link reparentPlacementAt}.
     */
    reparentPlacement(path: string, parentPath: string, offsets: readonly Vector2[]): ReparentPlacement | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        return reparentPlacementAt(canvas, path, parentPath, offsets);
    }

    /** The points an editor may drag on the node at `path`, in viewport space — see {@link nodeHandlesAt}. */
    nodeHandles(path: string): NodeHandle[] | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        return nodeHandlesAt(canvas, path);
    }

    /** The value of `prop` that puts its handle under a viewport point — see {@link handleValueAt}. */
    handleValue(path: string, prop: string, point: Vector2): Vector2 | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        return handleValueAt(canvas, path, prop, point);
    }

    /**
     * Where a Text node's caret slots landed on screen, or `null` when the path
     * doesn't resolve, the node isn't text, or the measurer has no caret model.
     * See {@link NodeTextLayout}.
     */
    getTextLayout(path: string): NodeTextLayout | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        const node = findNodeByPath(canvas, path);
        return node instanceof Node2D
            ? this.textLayoutOf(node, path)
            : null;
    }

    /** `node`'s caret slots in viewport space, or `null` when this controller's measurer keeps no glyph positions. */
    private textLayoutOf(node: Node2D, path: string): NodeTextLayout | null {
        const source = asTextBlockSource(this.measurer);
        return source ? nodeTextLayout(node, path, source) : null;
    }

    /**
     * The topmost node under a viewport-space point (origin at the viewport
     * centre, y-up), or `null`. `tolerance` is grab-slop in **scene units** —
     * the host's pixel slop divided by its preview zoom. See {@link pickNode}.
     */
    pickNode(point: Vector2, tolerance = 0): NodeBox | null {
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return null;
        return pickNode(canvas, point, tolerance);
    }

    /**
     * Layer transient prop values over a node, on top of whatever the document
     * evaluates to, re-applied after every evaluation until cleared — for an
     * editor dragging a node at pointer rate without rebuilding anything. Not
     * persistence: the host commits the value to its document on drop and
     * clears the override.
     *
     * @param path  Structural path from {@link TreeState.path}.
     * @param props Props the node accepts. Merged over any existing override.
     */
    setNodeOverride(path: string, props: NodeOverride): void {
        const existing = this.overrides.get(path);
        this.overrides.set(path, existing ? { ...existing, ...props } : { ...props });
        this.applyOverrides();
    }

    /**
     * Drop one node's overrides, or all of them when `path` is omitted, and
     * repaint so the node snaps back to what the document says.
     *
     * Rebuilds the current track's tree to do it: an override was written
     * straight onto a live prop, and the timeline only restores what its own
     * commands write. Cheap enough for a pointer-up, which is the only place it
     * belongs.
     *
     * @param path Structural path, as {@link setNodeOverride} takes — not an id,
     *   since a node a composite built for itself has no authored one to name.
     */
    clearNodeOverrides(path?: string): void {
        const cleared = path === undefined
            ? (this.overrides.size > 0 && (this.overrides.clear(), true))
            : this.overrides.delete(path);
        if (!cleared) return;
        this.stateEvaluator.rebuild();
        // Through `repaint` for both of its guards — see there.
        this.repaint();
    }

    /** Hidden/locked state for one track's nodes. Not authored, so it rides beside the document. */
    setEditorStates(trackId: string, states: NodeEditorStates | undefined): void {
        this.stateEvaluator.setEditorStates(trackId, states);
        this.repaint();
    }

    /**
     * Re-lay-out and repaint the current frame. Cheap enough for a pointer-rate
     * drag loop: `stateAt` early-returns for the frame already current.
     *
     * Does nothing **before the first frame has been drawn** — its assets have
     * not been loaded, and the last complete frame is a blank surface, which is
     * what should stay up — **nor between a swap and its paint**, which owes a
     * paint of its own. See {@link pendingSwap}.
     */
    repaint(): void {
        if (!this.hasPainted) return;
        if (this.pendingSwap !== 0 && this.isCurrent(this.pendingSwap)) return;
        this.renderAt(this.stateEvaluator.currentFrame);
        this.settleTrailing();
    }

    /**
     * Repaint a paused frame as the decodes its draw asked for land — one it could
     * not draw at all, and an upgrade of one it drew below demand, which no paint
     * waits for. Never while playing: the next tick picks them up. A seek, swap or
     * screenshot still on its way paints for itself, and once more when it lands
     * if an upgrade arrived after its render.
     */
    private settleTrailing(): void {
        if (this.trailingSettle || this.disposed || this.isPlaying || !this.hasBackgroundDecodes()) return;
        void this.repaintBehindDecodes().catch((error) => {
            console.error("[PlaybackController] background decode failed:", error);
        });
    }

    private trailingSettle = false;

    private hasBackgroundDecodes(): boolean {
        return this.storageAdapter.hasPendingDecodes() || this.storageAdapter.hasPendingUpgrades();
    }

    private async repaintBehindDecodes(): Promise<void> {
        // Released in `finally` on the same turn as the return, so a paint landing
        // right after this gives up can start the next one.
        this.trailingSettle = true;
        try {
            for (let pass = 0; pass < SETTLE_PASSES && this.hasBackgroundDecodes(); pass++) {
                const [decoded, upgraded] = await Promise.all([
                    this.storageAdapter.warmPendingDecodes(),
                    this.storageAdapter.warmPendingUpgrades(),
                ]);
                if (!(decoded || upgraded) || this.disposed || this.isPlaying) return;
                if (this.paintInFlight !== 0) {
                    this.repaintOwedSince = this.renders;
                    return;
                }
                this.renderAt(this.stateEvaluator.currentFrame);
            }
        } finally {
            this.trailingSettle = false;
        }
    }

    /** Write every held override onto its node. No-op when none are set. */
    private applyOverrides(): void {
        if (this.overrides.size === 0) return;
        const canvas = this.stateEvaluator.currentCanvas;
        if (!canvas) return;
        for (const [path, props] of this.overrides) {
            findNodeByPath(canvas, path)?.set(props as never);
        }
    }

    play(speed: number = 1, reverse: boolean = false): void {
        if (this.currentFrame >= this.totalFrames) {
            this.seek(0).then(() => this.masterClock.play(speed, reverse)).catch(() => { });
            return;
        }
        this.masterClock.play(speed, reverse);
    }

    pause(): void {
        this.masterClock.pause();
    }

    setMuted(muted: boolean): void {
        this.audioDevice.setMuted(muted);
    }

    dispose(): void {
        this.disposed = true;
        this.masterClock.dispose();
        this.audioDevice.dispose();
        this.stateEvaluator.dispose();
        this.store.dispose();
        this.assetManager.dispose();
    }
}

/** How far from the playhead a built tree is kept, in seconds. */
const TRIM_HORIZON_SECONDS = 30;

/** `adapter`, settling upgrades alongside what a frame needs — for a paint that is kept rather than shown. */
function settlingUpgrades(adapter: StorageAdapter): Pick<StorageAdapter, "warmPendingDecodes"> {
    return {
        async warmPendingDecodes() {
            const [decoded, upgraded] = await Promise.all([adapter.warmPendingDecodes(), adapter.warmPendingUpgrades()]);
            return decoded || upgraded;
        },
    };
}

/** What a missing-asset error says was needed, as a declaration. */
function declOf(error: AssetNotLoadedError, catalog: AssetCatalog): AssetDecl | undefined {
    switch (error.assetType) {
        case "image":
            return { type: "image", src: error.src };
        case "font":
            return { type: "font", family: error.src, weight: 400 };
        case "video":
            try {
                return { type: "video", src: error.src, trimStart: 0, trimEnd: catalog.getVideoDuration(error.src) };
            } catch {
                return undefined;
            }
        default:
            return undefined;
    }
}

// Every Node2D is a container (children may be empty); kept for callers that
// want an explicit "has children" check.
export function isParentNode(node: Node2D): boolean {
    return node.children.length > 0;
}

/**
 * `node` and its subtree as {@link TreeState}, indexed over the authored child
 * list — the same one every other structural-path walk reads, so selection,
 * bars and `getNodeBox` share one set of paths.
 */
function nodeToTreeState(
    node: Node,
    path: string,
    bars: ReadonlyMap<string, { startFrame: number; endFrame: number }>,
    waveformsByPath: ReadonlyMap<string, WaveformInfo[]>,
): TreeState {
    const state: TreeState = {
        id: node.id,
        path,
        type: node.className,
        children: node._allChildren.map((c, i) => nodeToTreeState(c, nodePath(path, i), bars, waveformsByPath)),
    };
    const waveform = waveformsByPath.get(path);
    if (waveform && waveform.length > 0) state.waveform = waveform;
    const bar = bars.get(path);
    if (bar) {
        state.startFrame = bar.startFrame;
        state.endFrame = bar.endFrame;
    }
    return state;
}

/**
 * Group a track's audio requests into per-node waveform entries, keyed by the
 * structural path their owner has in the tree right now. A request whose owner
 * is not in the tree has no bar to land on.
 */
function waveformsByOwner(
    requests: readonly AudioRequest[],
    pathOfOwner: ReadonlyMap<string, string>,
): Map<string, WaveformInfo[]> {
    const byPath = new Map<string, WaveformInfo[]>();
    for (const req of requests) {
        const path = req.ownerId !== undefined ? pathOfOwner.get(req.ownerId) : "";
        if (path === undefined) continue;
        const info: WaveformInfo = {
            src: req.src,
            startTime: req.startAt,
            endTime: Number.isFinite(req.endAt) ? req.endAt : null,
        };
        const list = byPath.get(path);
        if (list) list.push(info);
        else byPath.set(path, [info]);
    }
    return byPath;
}

/** The node at a structural path (`""` = root, `"0.2"` = third child of the first), walking the authored list. */
function findNodeByPath(root: Node2D, path: string): Node | null {
    if (path === "") return root;
    let node: Node = root;
    for (const seg of path.split(".")) {
        const next = node._allChildren[Number(seg)];
        if (!next) return null;
        node = next;
    }
    return node;
}

function findNode(root: Node, id: string): Node | null {
    if (root.id === id) return root;

    for (const child of root._allChildren) {
        const found = findNode(child, id);
        if (found) return found;
    }

    return null;
}
