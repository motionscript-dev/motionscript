import {
    DEFAULT_OUTPUT, ManifestAssetCatalog, Registry, resolveProjectDocument, type AssetManifest,
    type FrameRange, type ProjectDocument, type RenderIssue, type VisualDocument, type Size2D, type StorageAdapter, type Theme,
} from "@motionscript/core";
import {
    renderTimeline,
    type VideoFrameSink,
} from "./frame-loop";
import {
    AudioBufferSource,
    BufferTarget,
    CanvasSource,
    canEncodeVideo,
    Output,
    type Quality,
    type VideoCodec,
} from 'mediabunny';
import type { BrowserRenderContext } from "./engine";
import { loadRenderer, type RendererWasmOption } from "./renderer";
import { WebAudioMixer } from "./audio/mixer";
import { deliver } from "./deliver";
import {
    audioTrackSource, DEFAULT_AUDIO_BITRATE, ensureAudioEncoder, formatSpec, type VideoFormat,
} from "./formats";

/** Reports export progress in [0, 1]; video encoding occupies most of the range, audio mixing/finalize the tail. */
export type ExportProgressCallback = (progress: number) => void;

/** How the video track is encoded; fields pass through to mediabunny's `VideoEncodingConfig`, defaulted here. */
export type VideoEncoderOptions = {
    /**
     * Defaults to the format's own: `'avc'` for MP4, `'vp9'` for WebM. `'hevc'`/`'av1'` keep hairline strokes and
     * code listings sharper at the same bitrate (still 4:2:0). An unsupported choice, or one the container cannot
     * hold, falls back to the default.
     */
    codec?: 'avc' | 'hevc' | 'av1' | 'vp9' | 'vp8';
    /**
     * Defaults to `'no-preference'` (the platform's hardware encoder): several times faster, and the only setup where
     * this sink's zero-readback design holds, since a software encoder forces a GPU->CPU copy of every frame.
     * `'prefer-software'` when byte-identical output across machines matters more than speed.
     */
    hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
    /** Bits per second or a mediabunny `Quality`. Defaults to {@link motionGraphicsBitrate}, not `QUALITY_VERY_HIGH`, which is frame-rate blind (ringing on glyph edges at 60 fps). */
    bitrate?: number | Quality;
    /** Defaults to mediabunny's `'variable'`. `'constant'` is the reproducible-output choice. */
    bitrateMode?: 'constant' | 'variable';
    /** Seconds between key frames (default 1). Shorter than mediabunny's 2 because inter frames carry a frame's error, so flat synthetic backgrounds shimmer less; it also halves seek granularity. */
    keyFrameInterval?: number;
    /** Defaults to `'quality'`, which also guarantees no frame is dropped: the only correct setting for a file being written. */
    latencyMode?: 'quality' | 'realtime';
    /** A [content hint](https://w3c.github.io/mst-content-hint/#video-content-hints). Defaults to `'detail'`: bias towards sharp edges and fine texture over smoothing motion. Ignored where unimplemented. */
    contentHint?: string;
};

/** Bits per pixel per frame for the default bitrate. Motion graphics (hard glyph edges, flat fields, noise-free gradients) compress worse than camera footage, so this is well above a streaming preset. */
const BITS_PER_PIXEL = 0.2;
/** Floor, so a tiny viewport still gets enough bits to be legible. */
const MIN_VIDEO_BITRATE = 2_000_000;
/** Ceiling: past it the returns are gone and AVC levels start excluding hardware decoders (4K60 lands here; level 5.1 allows 240 Mbps). */
const MAX_VIDEO_BITRATE = 100_000_000;

/** Default video bitrate scaled by **both** axes: mediabunny's `Quality` levels scale with resolution only, so doubling the frame rate halved the bits per frame (clean stills, mushy video). */
export function motionGraphicsBitrate(width: number, height: number, fps: number): number {
    const raw = width * height * fps * BITS_PER_PIXEL;
    return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, raw)));
}

/** How the mixed audio track is encoded. */
export type AudioEncoderOptions = {
    /** Bitrate in bits per second for AAC, Opus and MP3; WAV ignores it. Defaults to 192 kbps. */
    bitrate?: number;
    /** Mixdown sample rate in Hz. Defaults to the mixer's own (44100); Opus is resampled to 48 kHz. */
    sampleRate?: number;
};

/** See {@link VideoEncoderOptions.keyFrameInterval}. */
const DEFAULT_KEY_FRAME_INTERVAL = 1;
/** See {@link ExportParams.supersample}. */
const DEFAULT_SUPERSAMPLE = 2;

export type ExportParams = RendererWasmOption & {
    /** A project, or a lone still or composition as the one track of one. */
    document: ProjectDocument | VisualDocument;
    /** The vocabulary its clips compile against. Defaults to what the library ships. */
    registry?: Registry;
    /** Win over the document's own; 1920×1080 at 60 fps when neither says. */
    viewport?: Size2D;
    fps?: number;
    scale?: number;
    /** The container, and with it the default codecs: H.264 and AAC for `'mp4'` (the default), VP9 and Opus for `'webm'`. */
    format?: VideoFormat;
    /** Defaults to `export.<extension>`. */
    filename?: string;
    manifest?: AssetManifest;
    /** Theme for a document that carries none of its own. */
    theme?: Theme;
    /** Set false to produce a silent file: no audio track, mix skipped. Defaults to true. */
    includeAudio?: boolean;
    /** Video encoder settings; see {@link VideoEncoderOptions} for the defaults. */
    video?: VideoEncoderOptions;
    /** Audio encoder settings; ignored when `includeAudio` is false. */
    audio?: AudioEncoderOptions;
    /**
     * Encode only these frames (`end` excluded), timestamped from 0 and silent:
     * one segment of a split export, for `concatVideoSegments` to join. Mix
     * the audio once with `mixTimelineAudio` instead.
     */
    frames?: FrameRange;
    onProgress?: ExportProgressCallback;
    signal?: AbortSignal;
    /**
     * What the renderer drew but not as the document says, once per kind,
     * feature and node. A lost GPU device fails the export with a
     * `RenderBackendError` instead.
     */
    onIssue?: (issue: RenderIssue) => void;
    /**
     * Render each frame at this multiple of the output resolution and downsample before encoding (default 2; 1 turns
     * it off). Every browser-encodable codec is 4:2:0, so chroma fringing on saturated edges is a property of the
     * format; downsampling first makes each chroma sample average four real pixels (2 measured 2.7 dB closer to a
     * reference than a 1x encode). Costs `supersample²` render work; `scale: 2` is cheaper and better when the
     * resolution is wanted in the file. Clamped to {@link MAX_RENDER_AXIS}.
     */
    supersample?: number;
    /** Return the encoded bytes instead of triggering a browser download (for headless drivers that write to disk). */
    returnBytes?: boolean;
}

const EMPTY_MANIFEST: AssetManifest = {
    image: {},
    video: {},
    audio: {},
    font: {},
};

/**
 * mediabunny/WebCodecs frame sink wrapping the very canvas the renderer draws into: `addFrame` costs only a timestamp
 * because WebCodecs pulls pixels from the canvas with no GPU->CPU readback (hence the seam signals a frame rather
 * than passing one). Holds only for a hardware encoder; a software one forces a full-frame copy every frame.
 */
export class MediabunnyVideoSink implements VideoFrameSink<AudioBuffer> {
    private readonly target = new BufferTarget();
    private readonly output: Output;
    private readonly video: CanvasSource;
    private audio: AudioBufferSource | null = null;

    constructor(
        canvas: HTMLCanvasElement,
        /** Encoded output size, which is the canvas' own unless supersampling is on. */
        output: { width: number; height: number },
        private readonly format: VideoFormat,
        encoding: ResolvedVideoEncoding,
        private readonly audioOptions: AudioEncoderOptions = {},
    ) {
        const downsampling = output.width !== canvas.width || output.height !== canvas.height;
        this.video = new CanvasSource(canvas, {
            codec: encoding.codec,
            bitrate: encoding.bitrate,
            hardwareAcceleration: encoding.hardwareAcceleration,
            keyFrameInterval: encoding.keyFrameInterval,
            latencyMode: encoding.latencyMode,
            contentHint: encoding.contentHint,
            ...(encoding.bitrateMode !== undefined && { bitrateMode: encoding.bitrateMode }),
            // `fit` is exact (the canvas is a whole multiple of the output) but mediabunny requires it when both axes are given.
            ...(downsampling && { transform: { width: output.width, height: output.height, fit: 'fill' as const } }),
        });
        this.output = new Output({ format: formatSpec(format).container(), target: this.target });
    }

    async start(info: { fps: number; hasAudio: boolean }): Promise<void> {
        this.output.addVideoTrack(this.video, { frameRate: info.fps });
        // Tracks must be declared before the muxer starts.
        if (info.hasAudio) {
            await ensureAudioEncoder(this.format);
            this.audio = audioTrackSource(this.format, this.audioOptions.bitrate ?? DEFAULT_AUDIO_BITRATE);
            this.output.addAudioTrack(this.audio);
        }
        await this.output.start();
    }

    async addFrame(timestamp: number, duration: number): Promise<void> {
        await this.video.add(timestamp, duration);
    }

    async addAudio(mixed: AudioBuffer): Promise<void> {
        if (!this.audio) return;
        await this.audio.add(mixed);
    }

    async finalize(): Promise<Uint8Array> {
        this.video.close();
        this.audio?.close();
        await this.output.finalize();
        const buffer = this.target.buffer;
        if (!buffer) throw new Error('Export produced no data');
        return new Uint8Array(buffer);
    }
}

function evenUp(n: number): number {
    const rounded = Math.round(n);
    return rounded % 2 === 0 ? rounded : rounded + 1;
}

/** Longest axis the render surface may reach: a 4K export at `supersample: 2` already draws 8K frames, and 8192 is WebGPU's default `maxTextureDimension2D`. */
const MAX_RENDER_AXIS = 8192;

/** How far the frame can be supersampled at this output size; reduced rather than refused, since a slightly softer file beats no file. */
function fittedSupersample(requested: number, output: { width: number; height: number }): number {
    const longest = Math.max(output.width, output.height);
    let factor = Math.max(1, Math.round(requested));
    while (factor > 1 && longest * factor > MAX_RENDER_AXIS) factor--;
    return factor;
}

/**
 * The codec to encode with: the one asked for if the container holds it and this platform can encode it at this
 * size, else the format's default, else its fallback (`'avc'` MP4, `'vp8'` WebM). The fallback is not probed.
 */
async function resolveCodec(
    requested: VideoCodec | undefined,
    format: VideoFormat,
    size: { width: number; height: number },
    fps: number,
): Promise<VideoCodec> {
    const { codecs, fallback } = formatSpec(format).video!;
    let wanted = requested ?? codecs[0];
    if (!codecs.includes(wanted)) {
        console.warn(`[motionscript] ${format.toUpperCase()} cannot hold ${wanted}; exporting as ${CODEC_NAMES[codecs[0]]} instead.`);
        wanted = codecs[0];
    }
    for (const codec of new Set([wanted, codecs[0], fallback])) {
        if (codec === fallback || await canEncode(codec, size, fps)) {
            if (codec !== wanted) {
                console.warn(`[motionscript] No ${wanted} encoder available; exporting as ${CODEC_NAMES[codec]} instead.`);
            }
            return codec;
        }
    }
    return fallback;
}

const CODEC_NAMES: Record<VideoCodec, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', vp8: 'VP8' };

async function canEncode(codec: VideoCodec, size: { width: number; height: number }, fps: number): Promise<boolean> {
    try {
        return await canEncodeVideo(codec, {
            width: size.width,
            height: size.height,
            bitrate: motionGraphicsBitrate(size.width, size.height, fps),
        });
    } catch {
        // A probe that throws is a probe that answered "no".
        return false;
    }
}

/** Every encoder setting, decided; a split export pins one across segments since `concatVideoSegments` refuses parts encoded differently. Plain data with a numeric `bitrate` (see {@link plainVideoEncoding}). */
export interface ResolvedVideoEncoding {
    codec: VideoCodec;
    /** A `Quality` is left for the encoder to size, as an export always has. */
    bitrate: number | Quality;
    hardwareAcceleration: NonNullable<VideoEncoderOptions['hardwareAcceleration']>;
    keyFrameInterval: number;
    latencyMode: NonNullable<VideoEncoderOptions['latencyMode']>;
    contentHint: string;
    bitrateMode?: VideoEncoderOptions['bitrateMode'];
}

/** {@link VideoEncoderOptions} with its defaults applied against the encoded size and rate. */
export async function resolveVideoEncoding(
    video: VideoEncoderOptions | undefined,
    format: VideoFormat,
    output: { width: number; height: number },
    fps: number,
): Promise<ResolvedVideoEncoding> {
    const codec = await resolveCodec(video?.codec, format, output, fps);
    return {
        codec,
        bitrate: video?.bitrate ?? motionGraphicsBitrate(output.width, output.height, fps),
        hardwareAcceleration: video?.hardwareAcceleration ?? 'no-preference',
        keyFrameInterval: video?.keyFrameInterval ?? DEFAULT_KEY_FRAME_INTERVAL,
        latencyMode: video?.latencyMode ?? 'quality',
        contentHint: video?.contentHint ?? 'detail',
        ...(video?.bitrateMode !== undefined && { bitrateMode: video.bitrateMode }),
    };
}

/** Turns a `Quality` into bits per second at this size, since a class instance cannot cross a `MessagePort`. */
export function plainVideoEncoding(
    encoding: ResolvedVideoEncoding,
    output: { width: number; height: number },
): ResolvedVideoEncoding & { bitrate: number } {
    const { bitrate } = encoding;
    if (typeof bitrate === 'number') return { ...encoding, bitrate };
    const quality = bitrate as unknown as { _toVideoBitrate(c: VideoCodec, w: number, h: number): number };
    return { ...encoding, bitrate: quality._toVideoBitrate(encoding.codec, output.width, output.height) };
}

/** The encoded size, rounded up to even, and how far each frame is supersampled. */
export function exportGeometry(viewport: Size2D, scale: number, supersample: number) {
    // Every block-based codec works in macroblocks, so an odd dimension is
    // padded by the encoder with a smeared strip that was never drawn.
    const output = { width: evenUp(viewport.width * scale), height: evenUp(viewport.height * scale) };
    const oversample = fittedSupersample(supersample, output);
    return { output, oversample, renderScale: scale * oversample };
}

/** A hidden canvas with a mounted render context, reusable across renders of one project. */
interface ExportSurface {
    canvas: HTMLCanvasElement;
    renderContext: BrowserRenderContext;
    storageAdapter: StorageAdapter;
    assetCatalog: ManifestAssetCatalog;
    dispose(): void;
}

/** Opens the canvas, renderer, storage and render context an export draws with, resolving once the surface can draw (a frame drawn earlier encodes blank). The canvas is a whole multiple of the output, so the downsample is exact. */
export async function openExportSurface(params: {
    canvasSize: { width: number; height: number };
    viewport: Size2D;
    fps: number;
    manifest: AssetManifest;
} & RendererWasmOption): Promise<ExportSurface> {
    const canvas = document.createElement('canvas');
    canvas.width = params.canvasSize.width;
    canvas.height = params.canvasSize.height;
    canvas.style.display = 'none';
    document.body.appendChild(canvas);
    try {
        const assetCatalog = new ManifestAssetCatalog(params.manifest);
        const renderer = await loadRenderer(params);
        const storageAdapter = renderer.createStorageAdapter({ catalog: assetCatalog, viewport: params.viewport, fps: params.fps });
        const renderContext = renderer.createRenderContext(storageAdapter);
        renderContext.mount(canvas);
        await renderContext.whenMounted?.();
        return {
            canvas, renderContext, storageAdapter, assetCatalog,
            dispose: () => {
                renderContext.dispose();
                canvas.remove();
            },
        };
    } catch (error) {
        canvas.remove();
        throw error;
    }
}

/** Renders a document frame by frame to an offscreen canvas and muxes it into MP4/WebM via mediabunny. The frame loop lives in `renderTimeline` (frame-loop.ts); this supplies the browser half: canvas, WebCodecs sink, Web Audio mixer, download. */
export async function exportVideo(params: ExportParams): Promise<Uint8Array | void> {
    const {
        // Not `document`, which would shadow the DOM global this function uses.
        document: source,
        registry = new Registry(),
        scale = 1,
        format = 'mp4',
        manifest = EMPTY_MANIFEST,
        theme,
        includeAudio = true,
        video,
        audio = {},
        frames,
        onProgress,
        signal,
        rendererWasmUrl,
        supersample = DEFAULT_SUPERSAMPLE,
        returnBytes = false,
    } = params;

    const spec = formatSpec(format);
    if (spec.kind !== 'video') throw new RangeError(`exportVideo writes video; "${format}" is audio, which exportAudio writes.`);
    const filename = params.filename ?? `export.${spec.extension}`;
    const project = resolveProjectDocument(source, params, DEFAULT_OUTPUT);
    if (project.tracks.length === 0) return;
    signal?.throwIfAborted();
    const viewport = project.viewport!;
    const fps = project.fps!;

    const { output, oversample, renderScale } = exportGeometry(viewport, scale, supersample);
    const surface = await openExportSurface({
        canvasSize: { width: output.width * oversample, height: output.height * oversample },
        viewport, fps, manifest, rendererWasmUrl,
    });

    let bytes: Uint8Array | undefined;
    try {
        const encoding = await resolveVideoEncoding(video, format, output, fps);
        bytes = await renderTimeline<AudioBuffer>({
            project, registry, theme, scale: renderScale, includeAudio, frames,
            renderContext: surface.renderContext, storageAdapter: surface.storageAdapter, assetCatalog: surface.assetCatalog,
            sink: new MediabunnyVideoSink(surface.canvas, output, format, encoding, audio),
            mixer: new WebAudioMixer(audio.sampleRate, surface.assetCatalog),
            onProgress,
            onIssue: params.onIssue,
            signal,
        }) as Uint8Array | undefined;
    } finally {
        surface.dispose();
    }

    if (!bytes) return;
    return deliver(bytes, { returnBytes, filename, mimeType: spec.mimeType });
}
