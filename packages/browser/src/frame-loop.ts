import {
    AssetCatalog, AssetManager, AudioSink, type AudioRequest, type BuildError, type CanvasRenderContext2D, ClipStore, MeasureContext2D,
    AssetTimeline, type AssetTimelineResult, type FrameRange, type ProjectDocument, type Registry,
    isFatalRenderIssue, RenderBackendError, type RenderIssue, renderIssueKey, renderSettled, SETTLE_PASSES, setTheme, toRenderIssue,
    type FrameSpec, type Size2D, spansCovering, StateEvaluator, type StorageAdapter, type Theme, yieldToScheduler,
} from "@motionscript/core";

/** Rendering a timeline is portable; encoding is not, so the codec is injected as a `VideoFrameSink` (exporter.ts: mediabunny over WebCodecs). */

export type ScreenshotFormat = "png" | "jpeg";

export type { FrameSpec };

export interface ScheduledAudioRequest {
    request: AudioRequest;
    /** Seconds added to the request's clip-relative times (its track's start). A wrong value exports in apparent sync and drifts, which no pixel comparison catches. */
    globalOffset: number;
}

/** Where finished frames go. `TAudio` ties the sink to its {@link AudioMixer}: the mixed form is platform-specific and only its own sink consumes it. */
export interface VideoFrameSink<TAudio = unknown> {
    /** Called once before the first frame. `hasAudio` is passed because a muxer declares its tracks before writing, and whether any audio is scheduled is only known after discovery, which runs after the sink is built. */
    start(info: {
        width: number;
        height: number;
        fps: number;
        totalFrames: number;
        hasAudio: boolean;
    }): Promise<void>;

    /**
     * One frame has been drawn and the surface flushed. **Deliberately does not receive pixels**: a browser sink lets
     * WebCodecs pull from the canvas, while a buffer here would force a GPU->CPU `readPixels` on every frame. A sink
     * that needs bytes (ffmpeg over stdin) reads them from its own render target. Do not "simplify" this signature.
     */
    addFrame(timestamp: number, duration: number): Promise<void>;

    /** Mixed audio for the whole timeline, if any was produced. */
    addAudio?(mixed: TAudio): Promise<void>;

    /** Finish the container. Returns encoded bytes, or nothing if the sink delivered them itself. */
    finalize(): Promise<Uint8Array | void>;
}

/** Mixes every scheduled request into one timeline-length buffer. */
export interface AudioMixer<TAudio = unknown> {
    mix(requests: readonly ScheduledAudioRequest[], totalDuration: number): Promise<TAudio | null>;
}

/** Audio is mixed offline at the end, so the per-frame pass needs an `AudioSink` that does nothing. */
export class NoopAudioSink extends AudioSink {
    /** Nothing here records a request, so `AssetManager` can skip the whole sync. */
    override get schedulesAudio(): boolean { return false; }

    has(_src: string): boolean { return true; }
    async append(_src: string, _data: ArrayBuffer): Promise<void> { }
    retain(_keep: ReadonlySet<string>): void { }
    schedule(_requests: readonly AudioRequest[]): void { }
    syncTo(_clipTime: number): void { }
    play(_time: number, _speed: number, _reverse: boolean): void { }
    stop(): void { }
}

/** What the frame loop draws with: any backend's context and adapter (the loop uses only core's base members). */
interface RenderHarness {
    renderContext: CanvasRenderContext2D & { pixelRatio: number };
    storageAdapter: StorageAdapter;
    assetCatalog: AssetCatalog;
}

interface CommonParams extends RenderHarness {
    /** Its fps and viewport resolved — see `Session`. */
    project: ProjectDocument;
    registry: Registry;
    /** Theme for a project that carries none of its own. */
    theme?: Theme;
    /** What the backend drew but not as the document says, once per kind, feature and node. A lost device or crashed backend throws a {@link RenderBackendError} instead. */
    onIssue?: (issue: RenderIssue) => void;
}

/** Hands the context's issues since the last call to `onIssue`, once per key in `seen`; throws on one that makes the drawn frames untrustworthy. */
function drainIssues(renderContext: CanvasRenderContext2D, seen: Set<string>, onIssue?: (issue: RenderIssue) => void): void {
    for (const raw of renderContext.takeRenderIssues()) {
        const issue = toRenderIssue(raw);
        if (isFatalRenderIssue(issue)) throw new RenderBackendError(issue);
        const key = renderIssueKey(issue);
        if (seen.has(key)) continue;
        seen.add(key);
        onIssue?.(issue);
    }
}

/** Draw one frame, settling and re-rendering until it is accurate. See `renderSettled`. */
async function renderWarmFrame(
    { renderContext, storageAdapter }: RenderHarness,
    draw: () => void,
    frame: number,
): Promise<void> {
    const outcome = await renderSettled(() => renderContext.execute(draw), storageAdapter, () => true);
    if (outcome === "exhausted") {
        console.warn(`[export] frame ${frame} still had pending decodes after ${SETTLE_PASSES} renders; it may not be exact.`);
    }
}

/** Makes the adapter decode exactly what each frame draws, so a frame is the same whatever was rendered before. Returns the restore: a live preview's adapter must not come back pinned. */
function exactDecodes(storageAdapter: StorageAdapter): () => void {
    const previous = storageAdapter.getDecodePolicy();
    storageAdapter.setDecodePolicy("exact");
    return () => storageAdapter.setDecodePolicy(previous);
}

function outputOf(project: ProjectDocument): { fps: number; viewport: Size2D } {
    const { fps, viewport } = project;
    if (fps === undefined || viewport === undefined) {
        throw new Error("Rendering takes a project whose fps and viewport are resolved — see Session.");
    }
    return { fps, viewport };
}

/** `frames`, or the whole timeline; a range that is empty or leaves the timeline is refused rather than clamped. */
function checkedRange(frames: FrameRange | undefined, totalFrames: number): FrameRange {
    if (!frames) return { start: 0, end: totalFrames };
    const { start, end } = frames;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > totalFrames) {
        throw new RangeError(`Frames ${start} to ${end} are not a range inside this timeline's ${totalFrames} frames.`);
    }
    return { start, end };
}

/** Build the discovery + evaluator pair both entry points drive, over one store so each track builds once. */
function prepare(params: CommonParams) {
    const { project, registry, assetCatalog, renderContext } = params;
    const { fps, viewport } = outputOf(project);
    // The theme is process-global, so anything else drawing in this page may
    // have replaced it; applied before the first build, which resolves tokens.
    const applyTheme = () => setTheme(project.theme ?? params.theme);
    applyTheme();
    // The render context *is* the measurer (it extends `MeasureContext2D`); named rather than cast so the compiler checks it.
    const measurer: MeasureContext2D = renderContext;
    const scope = { registry, viewport, fps, assets: assetCatalog, measurer };
    const loads: { manager?: AssetManager } = {};
    const store = new ClipStore(project, scope, { isReady: (key) => loads.manager?.isReady(key) ?? false });
    const precomper = new AssetTimeline(project, scope, { store });
    const stateEvaluator = new StateEvaluator(project, scope, store);
    return { store, precomper, stateEvaluator, measurer, fps, viewport, loads, applyTheme };
}

/** Loads the layout gates of `trackIds`, then rebuilds any whose compile measured a face before it was resident (every build runs before an asset has loaded). */
async function settleLayoutGates(store: ClipStore, manager: AssetManager, trackIds: readonly string[]): Promise<void> {
    const gates = trackIds.flatMap((id) => store.layoutGates(id).filter((record) => !manager.isReady(record.src)));
    if (gates.length > 0) await manager.loadRecords(gates);
    store.settleGates(trackIds);
}

/**
 * Collects every audio request with the absolute offset it plays at ({@link ScheduledAudioRequest.globalOffset}).
 * Exported because a **split** export mixes once over the whole timeline in the coordinator (concatenated AAC would
 * put the encoder's priming delay at every join) and must schedule exactly as this does: a drifted copy would give
 * a file that plays perfectly and is out of sync.
 */
export function collectAudio(precomp: AssetTimelineResult): ScheduledAudioRequest[] {
    const out: ScheduledAudioRequest[] = [];
    for (const track of precomp.tracks) {
        const globalOffset = track.startFrame / precomp.fps;
        for (const request of track.audioRequests) out.push({ request, globalOffset });
    }
    return out;
}

export interface RenderTimelineParams<TAudio> extends CommonParams {
    scale?: number;
    sink: VideoFrameSink<TAudio>;
    mixer?: AudioMixer<TAudio>;
    /** Set false for a silent file: no mix and no audio track. Not muting: audio is still discovered (the same pass finds the frames' assets), just not encoded. */
    includeAudio?: boolean;
    /**
     * Render only these frames, timestamped from 0, with no audio: one segment of a
     * split export. Only the tracks they cover are discovered.
     */
    frames?: FrameRange;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
}

/** Drives every frame of `project` (or `frames`) into `sink`, then mixes audio and finalizes. The caller owns the render context and surface; this neither creates nor disposes them. */
export async function renderTimeline<TAudio>(
    params: RenderTimelineParams<TAudio>,
): Promise<Uint8Array | void> {
    const { scale = 1, sink, mixer, onProgress, signal, includeAudio = true } = params;
    const harness: RenderHarness = params;
    const { renderContext, storageAdapter } = harness;

    if (params.project.tracks.length === 0) return;
    signal?.throwIfAborted();

    renderContext.pixelRatio = scale;
    const { store, precomper, stateEvaluator, measurer, fps, viewport, loads, applyTheme } = prepare(params);
    const restorePolicy = exactDecodes(storageAdapter);
    const seen = new Set<string>();
    try {
        // Not this render's: a device lost before it started was recovered from before it draws.
        renderContext.takeRenderIssues();
        const { start, end } = checkedRange(params.frames, precomper.result().totalFrames);
        const trackIds = params.frames
            ? store.spans.filter((span) => span.startFrame < end && span.endFrame >= start).map((span) => span.id)
            : params.project.tracks.map((track) => track.id);
        if (params.frames) for (const id of trackIds) store.discover(id);
        const precomp = params.frames ? precomper.result() : precomper.run();
        const { totalDuration } = precomp;
        const frameCount = end - start;
        // Before the sink starts, so a refused export encodes nothing.
        assertDrawable(store, precomp, start, end - 1);
        const assetManager = loads.manager = new AssetManager(precomp, storageAdapter, new NoopAudioSink());
        await settleLayoutGates(store, assetManager, trackIds);
        const scheduled = collectAudio(precomp);
        const wantsAudio = includeAudio && !params.frames && scheduled.length > 0 && mixer !== undefined;

        await sink.start({
            width: viewport.width * scale,
            height: viewport.height * scale,
            fps,
            totalFrames: frameCount,
            hasAudio: wantsAudio,
        });

        const frameDuration = 1 / fps;
        let globalTime = 0;
        // An export is a perfectly monotonic forward walk, the pattern the adapter's look-ahead decode window is built
        // for. At the default (not playing) every video frame instead takes the random-access branch: a seek + decode
        // plus a second full render (see `renderWarmFrame`). Restored in the `finally` so a cancelled export doesn't
        // leave a caller-owned adapter believing a playhead is running.
        storageAdapter.setPlaying(true);
        try {
            for (let f = start; f < end; f++) {
                signal?.throwIfAborted();

                await assetManager.loadAt(f);
                applyTheme();
                stateEvaluator.stateAt(f);
                stateEvaluator.layout(measurer);
                await renderWarmFrame(harness, () => stateEvaluator.render(renderContext), f);
                drainIssues(renderContext, seen, params.onIssue);

                await sink.addFrame(globalTime, frameDuration);
                globalTime += frameDuration;
                const done = f - start + 1;
                // Video occupies most of the range; the audio mix and finalize are the tail.
                onProgress?.((done / frameCount) * (wantsAudio ? 0.85 : 1));

                // Hand the host back its event loop periodically so a long export stays interruptible.
                if ((f + 1) % 4 === 0) await yieldToScheduler();
            }
        } finally {
            storageAdapter.setPlaying(false);
        }

        if (wantsAudio) {
            const mixed = await mixer!.mix(scheduled, totalDuration);
            if (mixed !== null && sink.addAudio) await sink.addAudio(mixed);
            onProgress?.(0.97);
        }

        // The last frame's device may have been lost after it was drawn.
        drainIssues(renderContext, seen, params.onIssue);
        const bytes = await sink.finalize();
        onProgress?.(1);
        return bytes;
    } finally {
        restorePolicy();
        stateEvaluator.dispose();
        store.dispose();
    }
}

export interface DrawFrameParams extends CommonParams {
    scale?: number;
    frame: FrameSpec;
}

export interface DrawnFrame {
    frame: number;
    totalFrames: number;
}

/** Every track covering {@link frame} failed to build; drawn anyway it would be a blank frame with the cause hidden, so a still and an export both refuse it. */
export class NothingToDrawError extends Error {
    override readonly name = "NothingToDrawError";

    constructor(
        readonly frame: number,
        readonly failures: readonly BuildError[],
    ) {
        const causes = failures.map((failure) => `  ${failure.trackId}: ${failure.message}`).join("\n");
        super(`Frame ${frame} has nothing to draw — every track on it failed to build:\n${causes}`);
    }
}

/** Draws one frame into the caller's render context and leaves it on the surface, via the same path as {@link renderTimeline} so a still equals the video's frame. Only tracks on that frame are discovered. The context stays the caller's (never created, resized or disposed), so a host can call this repeatedly and keep the decode cache warm. */
export async function drawFrameAt(params: DrawFrameParams): Promise<DrawnFrame> {
    const { scale = 1, frame, project } = params;
    const harness: RenderHarness = params;
    const { renderContext, storageAdapter } = harness;

    if (project.tracks.length === 0) throw new Error("The project has no tracks to render.");

    renderContext.pixelRatio = scale;
    const { store, precomper, stateEvaluator, measurer, loads } = prepare(params);
    const restorePolicy = exactDecodes(storageAdapter);
    try {
        const { totalFrames } = precomper.result();
        const requested =
            frame.kind === "first" ? 0
                : frame.kind === "last" ? totalFrames - 1
                    : frame.frame;
        const targetFrame = Math.max(0, Math.min(totalFrames - 1, Math.floor(requested)));
        const precomp = precomper.ensureCovering(targetFrame);
        assertDrawable(store, precomp, targetFrame);

        const assetManager = loads.manager = new AssetManager(precomp, storageAdapter, new NoopAudioSink());
        await settleLayoutGates(store, assetManager, spansCovering(store.spans, targetFrame).map((span) => span.id));
        await assetManager.loadAt(targetFrame);
        stateEvaluator.stateAt(targetFrame);
        stateEvaluator.layout(measurer);
        renderContext.takeRenderIssues();
        await renderWarmFrame(harness, () => stateEvaluator.render(renderContext), targetFrame);
        drainIssues(renderContext, new Set(), params.onIssue);

        return { frame: targetFrame, totalFrames };
    } finally {
        restorePolicy();
        // The pass flushed the surface, so the pixels survive teardown; in `finally` so a mid-draw throw doesn't leak a scene graph.
        stateEvaluator.dispose();
        store.dispose();
    }
}

/** Throws {@link NothingToDrawError} for the first frame in `first..last` whose every track failed to build. Only a build that threw counts: `buildErrors` also carries a node's failed declaration, and such a track still draws. */
function assertDrawable(store: ClipStore, precomp: AssetTimelineResult, first: number, last = first): void {
    const failed = new Map(precomp.buildErrors
        .filter((error) => store.failed(error.trackId))
        .map((error) => [error.trackId, error]));
    if (failed.size === 0) return;
    for (let frame = first; frame <= last; frame++) {
        const covering = spansCovering(store.spans, frame);
        if (covering.length > 0 && covering.every((span) => failed.has(span.id))) {
            throw new NothingToDrawError(frame, covering.map((span) => failed.get(span.id)!));
        }
    }
}
