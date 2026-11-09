import { Registry, type RenderIssue } from "@motionscript/core";
import { renderTimeline, type VideoFrameSink } from "../frame-loop";
import { exportGeometry, MediabunnyVideoSink, openExportSurface } from "../exporter";
import type { LaneEnvironment, LaneReport, LaneSession, SegmentSpec } from "./lane";

/** How often a lane reports its frames, in ms. */
const REPORT_EVERY_MS = 100;

/**
 * Open one surface for the whole export and render chunk after chunk onto it.
 * The surface is the expensive part (a WebGPU one takes up to a second and a
 * half to start), and decoded fonts and pictures stay in its storage between
 * chunks; each chunk still gets its own encoder, so it is its own file.
 */
export async function openSegmentSession(spec: SegmentSpec, env: LaneEnvironment): Promise<LaneSession> {
    const { project } = spec;
    const viewport = project.viewport!;
    const fps = project.fps!;
    const registry = env.registry ?? new Registry();
    const { output, oversample, renderScale } = exportGeometry(viewport, spec.scale, spec.supersample);
    const surface = await openExportSurface({
        canvasSize: { width: output.width * oversample, height: output.height * oversample },
        viewport, fps, manifest: spec.manifest, rendererWasmUrl: env.rendererWasmUrl,
    });

    return {
        async render(chunk, onReport, signal) {
            const sink = new TimedSink(new MediabunnyVideoSink(surface.canvas, output, spec.format, spec.encoding), onReport);
            const bytes = await renderTimeline<AudioBuffer>({
                project, registry, theme: spec.theme, scale: renderScale, includeAudio: false,
                frames: { start: chunk.start, end: chunk.end },
                renderContext: surface.renderContext, storageAdapter: surface.storageAdapter, assetCatalog: surface.assetCatalog,
                sink, signal,
                onIssue: (issue) => sink.issues.push(issue),
            });
            sink.flush();
            if (!bytes) throw new Error(`Frames ${chunk.start} to ${chunk.end} produced no bytes.`);
            return bytes;
        },
        close: () => surface.dispose(),
    };
}

/** Times each frame: drawing is the gap between frames, waiting is the encoder's backpressure. */
class TimedSink implements VideoFrameSink<AudioBuffer> {
    readonly issues: RenderIssue[] = [];
    private _frames = 0;
    private _busyMs = 0;
    private _waitMs = 0;
    private _lastEnd = 0;
    private _lastReport = 0;

    constructor(
        private readonly _inner: MediabunnyVideoSink,
        private readonly _onReport: (report: LaneReport) => void,
    ) { }

    async start(info: Parameters<MediabunnyVideoSink["start"]>[0]): Promise<void> {
        await this._inner.start(info);
        this._lastEnd = this._lastReport = performance.now();
    }

    async addFrame(timestamp: number, duration: number): Promise<void> {
        const before = performance.now();
        this._busyMs += before - this._lastEnd;
        await this._inner.addFrame(timestamp, duration);
        const after = performance.now();
        this._waitMs += after - before;
        this._lastEnd = after;
        this._frames++;
        if (after - this._lastReport >= REPORT_EVERY_MS) {
            this._lastReport = after;
            this.flush();
        }
    }

    finalize(): Promise<Uint8Array> {
        return this._inner.finalize();
    }

    flush(): void {
        const issues = this.issues.splice(0);
        this._onReport({ frames: this._frames, busyMs: this._busyMs, waitMs: this._waitMs, ...(issues.length > 0 && { issues }) });
    }
}
