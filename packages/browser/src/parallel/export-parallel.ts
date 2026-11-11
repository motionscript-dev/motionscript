import { DEFAULT_OUTPUT, placeTracks, Registry, renderIssueKey, resolveProjectDocument, totalFramesOf, type AssetManifest } from "@motionscript/core";
import { createSegmentJoiner, type ConcatOptions } from "../concat";
import { exportGeometry, plainVideoEncoding, resolveVideoEncoding, type ExportParams } from "../exporter";
import { formatSpec } from "../formats";
import { mixTimelineAudio } from "../mix-timeline-audio";
import type { ExportLane, SegmentSpec } from "./lane";
import { planChunks } from "./plan";
import { runLanes } from "./run-lanes";

export interface ParallelExportParams extends Omit<ExportParams, "frames" | "returnBytes" | "filename"> {
    /** Where the frames are drawn, most preferred first. A run starts on the first alone and admits the next only while that raises throughput (see `LaneGovernor`), so the first should be the warmest, usually `localLane()`. */
    lanes: readonly ExportLane[];
    /** Write the file here as it is joined; the call then resolves to an empty array. See `ConcatOptions.stream`. */
    stream?: ConcatOptions["stream"];
    /** Seconds per chunk; by default from the timeline's length and the lane count. */
    chunkSeconds?: number;
    /** Handed to every lane in its spec, for what only the host knows (see `serveExportLane`). */
    host?: unknown;
    /** How many lanes are rendering, each time that changes. */
    onLanes?: (active: number) => void;
}

const EMPTY_MANIFEST: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };
const DEFAULT_SUPERSAMPLE = 2;
/** The share of progress drawing takes; finishing the file is the rest. */
const DRAWN = 0.97;

/** {@link exportVideo} rendered in chunks across `lanes` and joined without re-encoding. Each chunk is a frame range of the **whole** project, so layered and gapped timelines split like any other. All chunks use one pinned encoding, the audio is mixed once over the whole timeline (joined AAC would click at every seam), and each chunk is muxed as soon as it and the ones before it are done. Progress is frames drawn across every lane, so it never goes back. */
export async function exportVideoParallel(params: ParallelExportParams): Promise<Uint8Array> {
    const {
        registry = new Registry(), scale = 1, format = "mp4", manifest = EMPTY_MANIFEST,
        includeAudio = true, audio = {}, signal, onProgress, supersample = DEFAULT_SUPERSAMPLE,
    } = params;
    if (formatSpec(format).kind !== "video") {
        throw new RangeError(`exportVideoParallel writes video; "${format}" is audio, which exportAudio writes.`);
    }
    const project = resolveProjectDocument(params.document, params, DEFAULT_OUTPUT);
    if (project.tracks.length === 0) throw new Error("exportVideoParallel: the project has no tracks.");
    signal?.throwIfAborted();
    const fps = project.fps!;
    const totalFrames = totalFramesOf(placeTracks(project.tracks, fps));

    const { output } = exportGeometry(project.viewport!, scale, supersample);
    const encoding = plainVideoEncoding(await resolveVideoEncoding(params.video, format, output, fps), output);
    const spec: SegmentSpec = {
        project, manifest, theme: params.theme, scale, supersample, format, encoding, host: params.host,
    };
    const chunks = planChunks(totalFrames, {
        fps, keyFrameInterval: encoding.keyFrameInterval, lanes: params.lanes.length, chunkSeconds: params.chunkSeconds,
    });

    // Started now so it is ready by the first join; failures surface there.
    const mixed = includeAudio
        ? mixTimelineAudio({
            document: project, registry, manifest, sampleRate: audio.sampleRate,
            rendererWasmUrl: params.rendererWasmUrl,
        })
        : Promise.resolve(null);
    mixed.catch(() => {});

    let reported = 0;
    const seenIssues = new Set<string>();
    const report = (p: number) => {
        if (p <= reported) return;
        reported = p;
        onProgress?.(p);
    };

    // One signal for both ways a run ends early: the caller cancelling, and the join failing.
    const run = new AbortController();
    const abortRun = () => run.abort(signal?.reason);
    if (signal?.aborted) abortRun();
    signal?.addEventListener("abort", abortRun, { once: true });

    // Keyed by first frame: a merged range spans several planned chunks.
    const ready = new Map<number, { end: number; bytes: Uint8Array }>();
    let joinedTo = 0;
    let joining: Promise<void> = Promise.resolve();
    let joiner: ReturnType<typeof createSegmentJoiner> | null = null;
    const pump = () => {
        joining = joining.then(async () => {
            while (ready.has(joinedTo)) {
                joiner ??= createSegmentJoiner({ stream: params.stream, audio: await mixed, audioBitrate: audio.bitrate });
                const { end, bytes } = ready.get(joinedTo)!;
                ready.delete(joinedTo);
                joinedTo = end;
                await joiner.append(bytes);
            }
        });
        return joining;
    };

    try {
        await runLanes({
            lanes: params.lanes, spec, chunks, signal: run.signal,
            onIssue: (issue) => {
                const key = renderIssueKey(issue);
                if (seenIssues.has(key)) return;
                seenIssues.add(key);
                params.onIssue?.(issue);
            },
            onFrames: (frames) => report(DRAWN * Math.min(1, frames / totalFrames)),
            onActive: params.onLanes,
            onChunk: (chunk, bytes) => {
                ready.set(chunk.start, { end: chunk.end, bytes });
                pump().catch((error: unknown) => run.abort(error));
            },
        });
        await pump();
        if (joinedTo !== totalFrames) throw new Error(`exportVideoParallel: joined ${joinedTo} of ${totalFrames} frames.`);
        const bytes = await joiner!.finish();
        report(1);
        return bytes;
    } catch (error) {
        await joining.catch(() => {});
        await (joiner as ReturnType<typeof createSegmentJoiner> | null)?.cancel().catch(() => {});
        throw error;
    } finally {
        signal?.removeEventListener("abort", abortRun);
    }
}
