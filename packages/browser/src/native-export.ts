import { ManifestAssetCatalog, Registry, resolveProjectDocument, DEFAULT_OUTPUT, type AssetManifest } from "@motionscript/core";
import { createNativeExportContext, NATIVE_RECORD, type NativeExportContext } from "@motionscript/renderer";
import { renderTimeline, type VideoFrameSink } from "./frame-loop";
import { exportGeometry, motionGraphicsBitrate, type ExportParams } from "./exporter";
import { loadRenderer } from "./renderer";
import { WebAudioMixer } from "./audio/mixer";

/**
 * Where a native export's stream goes: a host process that replays it with
 * the renderer's `replay` module (Rust, feature `native`) on the native GPU
 * and encodes the frames itself. Experimental.
 */
export interface NativeExportTransport {
    /** The host renderer's built-in effect names, in its index order (`NativeRenderer::effect_names`). */
    readonly effects: readonly string[];
    /** The next bytes of the stream, in order. Resolves when the transport can take more. */
    write(bytes: Uint8Array): Promise<void>;
    /** The stream is complete; resolves with the file's bytes, or nothing when the host wrote it elsewhere. */
    finish(): Promise<Uint8Array | void>;
    /** The export failed or was cancelled: stop the host process, keep no file. */
    abort?(reason: unknown): void;
}

export type NativeExportParams = Omit<ExportParams, "format" | "returnBytes" | "filename" | "rendererWasmUrl"> & {
    rendererWasmUrl?: string | URL;
    transport: NativeExportTransport;
};

/** Stream bytes held before they are handed to the transport. */
const FLUSH_BYTES = 1 << 18;

const CODEC_INDEX = { avc: 0, hevc: 1, av1: 2 } as const;

class NativeSink implements VideoFrameSink<AudioBuffer> {
    constructor(
        private readonly context: NativeExportContext,
        private readonly transport: NativeExportTransport,
        private readonly output: { width: number; height: number },
        private readonly encoding: { codec: number; bitrate?: number },
    ) { }

    private async flush(force = false): Promise<void> {
        if (this.context.out.size >= (force ? 1 : FLUSH_BYTES)) await this.transport.write(this.context.out.take());
    }

    async start(info: { width: number; height: number; fps: number; totalFrames: number }): Promise<void> {
        const { width, height } = this.output;
        const bitrate = this.encoding.bitrate ?? motionGraphicsBitrate(width, height, info.fps);
        this.context.out.record(NATIVE_RECORD.BEGIN, [width, height, Math.round(info.fps * 1000), info.totalFrames, bitrate, this.encoding.codec, 0]);
        await this.flush(true);
    }

    async addFrame(): Promise<void> {
        this.context.frameDone();
        await this.flush();
    }

    async addAudio(mixed: AudioBuffer): Promise<void> {
        const channels = mixed.numberOfChannels, frames = mixed.length;
        const pcm = new Float32Array(frames * channels);
        for (let c = 0; c < channels; c++) {
            const data = mixed.getChannelData(c);
            for (let i = 0; i < frames; i++) pcm[i * channels + c] = data[i];
        }
        this.context.out.record(NATIVE_RECORD.AUDIO, [mixed.sampleRate, channels], new Uint8Array(pcm.buffer));
        await this.flush(true);
    }

    async finalize(): Promise<Uint8Array | void> {
        this.context.out.record(NATIVE_RECORD.END, []);
        await this.flush(true);
        return this.transport.finish();
    }
}

const EMPTY_MANIFEST: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };

/**
 * Experimental: {@link exportVideo} through a native host process. The frame
 * loop, adapter, text and assets run here exactly as for a canvas export;
 * what would be drawn is streamed to `transport` instead, and the host draws
 * it with the same renderer on the native GPU and encodes it. `video.codec`
 * (avc by default, hevc or av1) and the bitrate are passed on in the stream.
 */
export async function exportVideoNative(params: NativeExportParams): Promise<Uint8Array | void> {
    const {
        document: source, registry = new Registry(), scale = 1, manifest = EMPTY_MANIFEST, theme,
        includeAudio = true, video, audio = {}, frames, onProgress, signal, supersample = 2, transport,
    } = params;
    const project = resolveProjectDocument(source, params, DEFAULT_OUTPUT);
    if (project.tracks.length === 0) return;
    signal?.throwIfAborted();
    const viewport = project.viewport!;
    const fps = project.fps!;
    const { output, oversample, renderScale } = exportGeometry(viewport, scale, supersample);
    if (output.width % 4 !== 0) throw new RangeError(`A native export's width must be a multiple of 4 (NV12 packing); ${output.width} is not.`);

    // The WASM for text and shader validation only: nothing here draws.
    const renderer = await loadRenderer({ rendererWasmUrl: params.rendererWasmUrl }, { gpu: false });
    const assetCatalog = new ManifestAssetCatalog(manifest);
    const storageAdapter = renderer.createStorageAdapter({ catalog: assetCatalog, viewport, fps });
    const renderContext = createNativeExportContext(storageAdapter, {
        viewport,
        effects: transport.effects,
        size: { width: output.width * oversample, height: output.height * oversample },
    });
    const codec = video?.codec === "hevc" || video?.codec === "av1" ? CODEC_INDEX[video.codec] : CODEC_INDEX.avc;
    const bitrate = typeof video?.bitrate === "number" ? video.bitrate : undefined;
    try {
        return await renderTimeline<AudioBuffer>({
            project, registry, theme, scale: renderScale, includeAudio, frames,
            renderContext: renderContext as never, storageAdapter, assetCatalog,
            sink: new NativeSink(renderContext, transport, output, { codec, bitrate }),
            mixer: new WebAudioMixer(audio.sampleRate, assetCatalog),
            onProgress, onIssue: params.onIssue, signal,
        });
    } catch (error) {
        transport.abort?.(error);
        throw error;
    } finally {
        renderContext.dispose();
    }
}
