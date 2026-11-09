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

/**
 * How the video track is encoded.
 *
 * Every field is a straight pass-through to mediabunny's `VideoEncodingConfig`,
 * defaulted here rather than there so an export has one obvious place to look.
 */
export type VideoEncoderOptions = {
    /**
     * Which codec the video track is encoded with. Defaults to the format's own:
     * `'avc'` (H.264) for MP4, which every player, editor and upload target
     * accepts, and `'vp9'` for WebM.
     *
     * `'hevc'` and `'av1'` reconstruct sharp edges far better at the same
     * bitrate, which is what a listing of syntax-highlighted code or a hairline
     * stroke is made of — worth reaching for when the file is going somewhere
     * that decodes them. Both are still 4:2:0, so they narrow the gap rather
     * than close it. Availability depends on the platform's encoders; an
     * unsupported choice, or one the container cannot hold (`'avc'` in WebM),
     * falls back to the format's default rather than failing the export.
     */
    codec?: 'avc' | 'hevc' | 'av1' | 'vp9' | 'vp8';
    /**
     * Which encoder implementation WebCodecs should prefer.
     *
     * Defaults to `'no-preference'`, which lets each platform use its own
     * hardware encoder (VideoToolbox on macOS, Media Foundation/NVENC on
     * Windows, VA-API on Linux). That is typically several times faster than the
     * software path *and* it is the only configuration in which this sink's
     * zero-readback design actually holds: a software encoder needs the pixels
     * on the CPU, so it forces a full GPU→CPU copy of every frame that a
     * hardware encoder reads directly off the canvas.
     *
     * Pass `'prefer-software'` when byte-identical output across machines
     * matters more than speed — different hardware encoders tune quality and
     * colour differently at the same nominal bitrate, so the same settings do
     * not produce the same file.
     */
    hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
    /**
     * Target bitrate in bits per second, or one of mediabunny's subjective
     * `Quality` levels.
     *
     * Defaults to {@link motionGraphicsBitrate}, which is deliberately *not*
     * mediabunny's `QUALITY_VERY_HIGH`: that level is frame-rate blind, so a
     * 60 fps export got the same ~12 Mbps at 1080p as a 30 fps one and paid for
     * it with ringing along every glyph edge and banding across every gradient.
     * See that function for the reasoning.
     */
    bitrate?: number | Quality;
    /** Defaults to mediabunny's `'variable'`. `'constant'` is the reproducible-output choice. */
    bitrateMode?: 'constant' | 'variable';
    /**
     * Seconds between key frames. Defaults to 1.
     *
     * Shorter than mediabunny's 2, because a frame's error is carried by every
     * inter frame that references it: on synthetic content, where a flat
     * background makes a shimmer obvious, a keyframe twice as often visibly
     * resets the drift. It also halves the seek granularity, which matters for a
     * clip an editor is going to scrub.
     */
    keyFrameInterval?: number;
    /**
     * WebCodecs performance/quality trade-off. Defaults to `'quality'`, which
     * also guarantees no frame is dropped — the only correct setting for a file
     * being written rather than streamed.
     */
    latencyMode?: 'quality' | 'realtime';
    /**
     * A hint about what the frames contain, per
     * [mst-content-hint](https://w3c.github.io/mst-content-hint/#video-content-hints).
     *
     * Defaults to `'detail'`: encoders that honour it bias towards preserving
     * sharp edges and fine texture over smoothing motion, which is what motion
     * graphics are. Ignored where it is not implemented.
     */
    contentHint?: string;
};

/**
 * Bits per pixel per frame the default bitrate is built from.
 *
 * Rendered motion graphics are the hard case for a codec tuned on camera
 * footage: hard glyph edges, large flat fields, and gradients with no sensor
 * noise to hide the quantisation in. They compress *worse* than live action at
 * the same perceived quality, not better, so the figure here is well above what
 * a streaming preset would use — this is a master being rendered once, not a
 * bitstream being pushed down a pipe.
 */
const BITS_PER_PIXEL = 0.2;
/** Floor, so a tiny viewport still gets enough bits to be legible. */
const MIN_VIDEO_BITRATE = 2_000_000;
/**
 * Ceiling. Past this the returns are gone and the levels start excluding
 * hardware decoders — 4K60 lands here, and AVC level 5.1 (which every consumer
 * device implements) tops out at 240 Mbps, well clear of it.
 */
const MAX_VIDEO_BITRATE = 100_000_000;

/**
 * The default video bitrate for an export of this size and frame rate.
 *
 * Scaling with **both** axes is the point. mediabunny's `Quality` levels scale
 * with resolution only, so doubling the frame rate halved the bits available per
 * frame while leaving the number unchanged — which is exactly the configuration
 * that produced clean stills and a mushy video from the very same renderer.
 */
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
    /**
     * Set false to produce a silent file — no audio track is added to the
     * container and the mix is skipped entirely. Defaults to true.
     */
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
     * Render each frame at this multiple of the output resolution and downsample
     * it before encoding. **Defaults to 2**; pass 1 to turn it off.
     *
     * The one lever that improves an export at a *fixed* output size. Every
     * codec a browser can encode is 4:2:0 — colour is stored at half resolution
     * on both axes, and no bitrate buys that back — so the colour fringing along
     * a saturated glyph or a hard edge is a property of the format, not of the
     * settings. Handing the encoder an already-downsampled frame does not undo
     * the subsampling, but it does mean every chroma sample averages four real
     * pixels instead of one, which is what removes most of the crawl on fine
     * detail and much of the banding on gradients.
     *
     * Measured against a correctly-sampled reference frame of a syntax-highlighted
     * listing, `2` lands 2.7 dB closer than a 1× encode — and 1.3 dB closer than
     * an *unencoded* 1× still, which is why it is the default despite costing
     * `supersample²` times the render work per frame plus a rescale. Pass 1 when
     * turnaround matters more than the file, and note that exporting at
     * `scale: 2` is cheaper than supersampling *and* better whenever the extra
     * resolution is wanted in the file itself.
     *
     * Clamped so the render surface stays inside {@link MAX_RENDER_AXIS}, since a
     * supersampled 4K export is already drawing 8K frames.
     */
    supersample?: number;
    /**
     * When true, the encoded bytes are returned instead of triggering a
     * browser download. Used by headless drivers (e.g. the CLI) that capture
     * the output themselves and write it to disk; leave unset for the
     * interactive player, which downloads via an `<a>` element.
     */
    returnBytes?: boolean;
}

const EMPTY_MANIFEST: AssetManifest = {
    image: {},
    video: {},
    audio: {},
    font: {},
};

// ── Audio mixing ─────────────────────────────────────────────────────────────
//
// The mix itself lives in ./audio/mixer, shared with `mixTimelineAudio` so a
// split export and a whole one cannot mix differently.

// ── Video sink ───────────────────────────────────────────────────────────────

/**
 * mediabunny/WebCodecs implementation of the frame sink, writing whichever
 * container `format` names.
 *
 * Wraps the very `<canvas>` the renderer draws into, so `addFrame` costs nothing but
 * a timestamp — WebCodecs pulls the pixels from the canvas itself, with no
 * GPU→CPU readback. That is why the seam signals a frame rather than passing one.
 *
 * The readback claim holds only while the encoder is a hardware one, which is
 * why {@link VideoEncoderOptions.hardwareAcceleration} defaults to letting the
 * platform choose: a software encoder has to be handed CPU pixels, so it drags
 * a full-frame copy off the GPU on every single frame.
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
            // `fit` is exact here — the supersampled canvas is a whole multiple
            // of the output — but mediabunny requires it whenever both axes are
            // given, so it is stated rather than inferred.
            ...(downsampling && { transform: { width: output.width, height: output.height, fit: 'fill' as const } }),
        });
        this.output = new Output({ format: formatSpec(format).container(), target: this.target });
    }

    async start(info: { fps: number; hasAudio: boolean }): Promise<void> {
        this.output.addVideoTrack(this.video, { frameRate: info.fps });
        // Tracks must be declared before the muxer starts, which is why the
        // orchestrator reports this rather than leaving it to be inferred.
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

// ── Main export ──────────────────────────────────────────────────────────────

/** Round up to the nearest even integer — see the call site. */
function evenUp(n: number): number {
    const rounded = Math.round(n);
    return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * Longest axis the render surface is allowed to reach.
 *
 * Supersampling multiplies the surface, not the output: a 4K export at
 * `supersample: 2` is drawing 8K frames, and the next step up asks for a
 * 15360-wide WebGL surface that most drivers will not give and none will give
 * cheaply. 8192 is the smallest `MAX_TEXTURE_SIZE` in wide circulation, so a
 * surface inside it is one every machine that can run the export at all can
 * also allocate.
 */
const MAX_RENDER_AXIS = 8192;

/**
 * How far the frame can actually be supersampled at this output size.
 *
 * Reduced rather than refused: an export that quietly renders at 1× is a
 * slightly softer file, and one that throws because the default was too
 * ambitious for a 4K project is no file at all.
 */
function fittedSupersample(requested: number, output: { width: number; height: number }): number {
    const longest = Math.max(output.width, output.height);
    let factor = Math.max(1, Math.round(requested));
    while (factor > 1 && longest * factor > MAX_RENDER_AXIS) factor--;
    return factor;
}

/**
 * The codec to actually encode with: the one asked for if the container holds
 * it and this platform can encode it at this size, else the format's default,
 * else its fallback (`'avc'` for MP4, `'vp8'` for WebM).
 *
 * Which encoders a machine has varies by OS, browser and GPU, and an export that
 * dies at the muxer for want of an HEVC encoder is worse than one that quietly
 * produces H.264. The fallback is not probed: there is nothing to fall back to.
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

/**
 * Every encoder setting, decided. A split export pins one of these across its
 * segments, since `concatVideoSegments` refuses parts encoded differently. With
 * a numeric `bitrate` (see {@link plainVideoEncoding}) it is plain data and
 * crosses a process boundary.
 */
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

/**
 * The encoding with a `Quality` turned into the bits per second mediabunny would
 * give it at this size, since a class instance cannot cross a `MessagePort`.
 */
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
export interface ExportSurface {
    canvas: HTMLCanvasElement;
    renderContext: BrowserRenderContext;
    storageAdapter: StorageAdapter;
    assetCatalog: ManifestAssetCatalog;
    dispose(): void;
}

/**
 * Open the canvas, renderer, storage and render context an export draws with,
 * resolving once the surface can draw (a frame drawn before an asynchronously
 * started surface is ready encodes blank). The canvas is a whole multiple of the
 * output, so the downsample is exact.
 */
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

/**
 * Renders a document frame-by-frame to an offscreen canvas and muxes the result
 * into an MP4 or WebM via mediabunny.
 *
 * The frame loop itself — discovery, state evaluation, the warm-and-re-render retry
 * that keeps every frame accurate, audio scheduling, progress and cancellation —
 * lives in `renderTimeline` (frame-loop.ts). What this function
 * supplies is the browser-specific half: a canvas to draw into, a WebCodecs sink,
 * a Web Audio mixer, and the `<a download>` delivery.
 */
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
