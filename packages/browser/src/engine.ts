import {
    AudioSink,
    Engine,
    EngineOptions,
    EnginePlatform,
    EngineRenderContext,
    Exporter,
    ExportStillRequest,
    ExportVideoRequest,
    ExportedStill,
    Registry,
    Ticker,
    MeasureContext2D,
    PlatformDeps,
    StorageAdapter,
    type DynamicNodeConfig,
    type NodeConstructor,
    type NodeTypeMap,
} from "@motionscript/core";

import type { WgpuStorageAdapter } from "@motionscript/renderer";
import { loadRenderer, type RendererWasmOption } from "./renderer";
import { resolveDynamicNodes } from "./dynamic-nodes";
import { WebAudioSink } from "./audio/player";
import { WebTicker } from "./ticker";
import { exportVideo as exportVideoFile, type AudioEncoderOptions, type VideoEncoderOptions } from "./exporter";
import { exportAudio } from "./export-audio";
import { isAudioFormat, type ExportFormat } from "./formats";
import { StillRenderer } from "./still";

export interface BrowserEngineOptions extends Omit<EngineOptions, "nodes" | "dynamicNodes">, RendererWasmOption {
    /**
     * Node types any document opened here may name — components as an array
     * or a record naming each key outright, same as `EngineOptions`, plus a
     * TS source string in the **array** form only. A string default-exports a
     * component, whose `key` is its key — the record form takes no string, so
     * there is exactly one place a dynamic node's key comes from, not two that
     * could disagree.
     */
    nodes?: readonly (NodeConstructor | string)[] | NodeTypeMap;
    /**
     * Enables a source string in `nodes`, and `engine.registerNode(source)`
     * at any point afterward. Any field left unset falls back to `browser`'s
     * own default — `@motionscript/core/sdk` for `sdk`, a lazily-loaded
     * `esbuild-wasm` for `compile` — so this never needs to be passed at all
     * for the common case. `modules` has no default: only the host knows
     * which loaded packages a script it compiles may reach.
     */
    dynamicNodes?: Partial<DynamicNodeConfig>;
    /**
     * Where `esbuild-wasm`'s own `.wasm` binary is served — only read if the
     * default compiler is actually used.
     */
    compilerWasmUrl?: string;
    /** Default video encoder settings for `session.export()`. Overridable per call. */
    video?: VideoEncoderOptions;
    /** Default audio encoder settings for `session.export()`. Overridable per call. */
    audio?: AudioEncoderOptions;
}

/** What a session's frames are drawn with, and the storage and measurement it reads from. */
export interface BrowserRenderer<TStorage extends StorageAdapter = StorageAdapter> {
    createStorageAdapter(deps: PlatformDeps): TStorage;
    createRenderContext(storage: TStorage): BrowserRenderContext;
    createMeasureContext(storage: TStorage): MeasureContext2D;
    dispose?(): void;
}

/** A render context as this package drives it: an engine one, plus what exports and stills ask of it. */
export type BrowserRenderContext = EngineRenderContext & {
    /**
     * Settles once the surface `mount` began can draw. A backend whose surface
     * comes up asynchronously (a GPU device) must have it, or the first frame
     * draws onto nothing.
     */
    whenMounted?(): Promise<void>;
    /**
     * The frame last drawn, copied into a fresh 2D canvas, or `undefined` before
     * one was. What a still encodes; a WebGPU canvas is readable only in the task
     * that drew it, so a backend may draw it again here.
     */
    snapshotCanvas?(): HTMLCanvasElement | undefined;
};

/** What `session.export({ encode })` accepts in this environment. */
export interface BrowserEncodeOptions {
    /**
     * Defaults to `'mp4'`. An audio format (`'wav'`, `'mp3'`, `'m4a'`) renders no
     * frames and ignores `scale`, `frames`, `includeAudio`, `video` and `supersample`.
     */
    format?: ExportFormat;
    video?: VideoEncoderOptions;
    audio?: AudioEncoderOptions;
    supersample?: number;
    /** Set false to get the bytes back instead of triggering a browser download. */
    download?: boolean;
    filename?: string;
}

/**
 * The browser's {@link Exporter}: WebCodecs + mediabunny for video, the
 * browser's own image codecs for a still.
 *
 * **It does not reuse a session's storage adapter, and that is deliberate.** An
 * adapter's viewport clamps the resolution images decode at — `StorageAdapter`
 * documents that it has no setter for exactly this reason — so handing an export
 * the preview's adapter would paint a 2× render from decodes sized for 1×, and
 * the result would be soft in a way nothing reports. What is shared is the
 * engine's renderer backend, the same one its sessions draw with.
 */
class WebExporter implements Exporter {
    private still: StillRenderer | null = null;
    private stillRegistry: Registry | null = null;
    /** Settles once every still asked for so far has been encoded. */
    private stillQueue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly backend: BrowserRenderer,
        private readonly defaults: { video?: VideoEncoderOptions; audio?: AudioEncoderOptions } & RendererWasmOption,
    ) { }

    async exportVideo(request: ExportVideoRequest): Promise<Uint8Array | void> {
        const encode = (request.encode ?? {}) as BrowserEncodeOptions;
        if (encode.format && isAudioFormat(encode.format)) {
            return exportAudio({
                document: request.project,
                registry: request.registry,
                manifest: request.manifest,
                format: encode.format,
                audio: encode.audio ?? this.defaults.audio,
                filename: encode.filename,
                returnBytes: encode.download !== true,
                onProgress: request.onProgress,
                signal: request.signal,
                rendererWasmUrl: this.defaults.rendererWasmUrl,
            });
        }
        return exportVideoFile({
            document: request.project,
            registry: request.registry,
            scale: request.scale,
            manifest: request.manifest,
            includeAudio: request.includeAudio,
            frames: request.frames,
            format: encode.format,
            video: encode.video ?? this.defaults.video,
            audio: encode.audio ?? this.defaults.audio,
            supersample: encode.supersample,
            filename: encode.filename,
            // A `Session` asks for bytes; only an explicit `download: true` takes
            // the DOM anchor path this function offers a page.
            returnBytes: encode.download !== true,
            onProgress: request.onProgress,
            onIssue: request.onIssue,
            signal: request.signal,
            rendererWasmUrl: this.defaults.rendererWasmUrl,
        });
    }

    /**
     * Queued, rather than a renderer per call: the one renderer is what keeps a
     * GPU surface and the decode cache warm between stills, and its draw and the
     * encode of it are two steps another call's draw would land between.
     */
    exportStill(request: ExportStillRequest): Promise<ExportedStill> {
        const still = this.stillQueue.then(() => this.drawStill(request));
        this.stillQueue = still.catch(() => undefined);
        return still;
    }

    dispose(): void {
        this.still?.dispose();
        this.still = null;
    }

    private async drawStill(request: ExportStillRequest): Promise<ExportedStill> {
        const renderer = this.renderer(request);
        const drawn = await renderer.render(request.project, {
            scale: request.scale,
            onIssue: request.onIssue,
            ...frameOption(request.frame),
        });
        const bytes = await renderer.toBytes({
            format: request.format,
            quality: request.quality,
        });
        return { bytes, frame: drawn.frame, totalFrames: drawn.totalFrames };
    }

    /**
     * One `StillRenderer`, reused across calls and re-viewported when the ask
     * changes — `setViewport` is a no-op when the size already matches, and a
     * full reset when it does not, which is the same trade the class documents.
     */
    private renderer(request: ExportStillRequest): StillRenderer {
        const { project, registry } = request;
        if (project.viewport === undefined || project.fps === undefined) {
            throw new Error("exportStill takes a project whose fps and viewport are resolved — see Session.");
        }
        // A renderer compiles against the registry it was built with.
        if (this.still && this.stillRegistry !== registry) this.dispose();
        this.still ??= new StillRenderer(this.backend, {
            viewport: project.viewport,
            fps: project.fps,
            manifest: request.manifest,
            registry,
        });
        this.stillRegistry = registry;
        this.still.setViewport(project.viewport);
        if (request.manifest) this.still.setManifest(request.manifest);
        return this.still;
    }
}

/** `ExportStillRequest.frame` in the shape `StillRenderer.render` accepts. */
function frameOption(frame: ExportStillRequest["frame"]): { frame?: number | "first" | "last" } {
    if (frame.kind === "frame") return { frame: frame.frame };
    return { frame: frame.kind };
}

/**
 * An engine backed by the browser: WebGPU surfaces, Web Audio, WebCodecs.
 * Rejects with `WebGpuUnavailableError` where this browser has no WebGPU adapter.
 *
 * Async because the renderer is a wasm module and every seam below needs it. Await
 * once, at app start, and share the result — the caches underneath (registered
 * fonts, decoded images, shaped paragraphs) are the point of keeping one engine
 * rather than one per canvas.
 *
 * ```ts
 * const engine = await createBrowserEngine({ nodes: { pulseRing: PulseRing } });
 * const session = engine.open({ document, target: canvasEl });
 * session.playback!.play();
 * ```
 */
export async function createBrowserEngine(
    options: BrowserEngineOptions = {},
): Promise<Engine<WgpuStorageAdapter>> {
    const rawNodes = options.nodes;
    // `Array.isArray` doesn't narrow a `readonly T[] | U` union cleanly against
    // its `arg is any[]` (mutable) predicate — the `.filter` predicate below
    // already guarantees no string survives, so the cast is just recovering
    // what the runtime check already proved.
    const classNodes = (
        Array.isArray(rawNodes)
            ? rawNodes.filter((n): n is NodeConstructor => typeof n !== "string")
            : rawNodes
    ) as NodeTypeMap | readonly NodeConstructor[] | undefined;
    const sourceNodes = Array.isArray(rawNodes)
        ? rawNodes.filter((n): n is string => typeof n === "string")
        : [];
    // Cheap — see dynamic-nodes.ts: no WASM import happens here, only on
    // `compile`'s first actual call. Attached unconditionally so a later
    // `engine.registerNode(source)` works even when `nodes` carried no
    // string at boot.
    const dynamicNodes = resolveDynamicNodes(options.dynamicNodes, options.compilerWasmUrl);

    const renderer: BrowserRenderer<WgpuStorageAdapter> = await loadRenderer(options);
    const exporter = new WebExporter(renderer, { video: options.video, audio: options.audio, rendererWasmUrl: options.rendererWasmUrl });

    const platform: EnginePlatform<WgpuStorageAdapter> = {
        createStorageAdapter: (deps) => renderer.createStorageAdapter(deps),
        createRenderContext: (storage) => renderer.createRenderContext(storage),
        createMeasureContext: (storage) => renderer.createMeasureContext(storage),
        createAudioSink(): AudioSink {
            return new WebAudioSink();
        },
        createTicker(fps: number, audioDevice: AudioSink): Ticker {
            // Shares the device's own `AudioContext`: two independent timebases
            // in one session drift against each other, and sound is the one that
            // cannot be nudged back. A getter, so neither creates it before it
            // is needed (the first play, or the first sound to decode).
            const sink = audioDevice as WebAudioSink;
            return new WebTicker({ context: () => sink.getContext(), fps });
        },
        createExporter(): Exporter {
            return exporter;
        },
        dispose(): void {
            exporter.dispose();
            renderer.dispose?.();
        },
    };

    const engine = new Engine<WgpuStorageAdapter>(platform, { ...options, nodes: classNodes, dynamicNodes });
    for (const source of sourceNodes) {
        // Sequential — one script's error shouldn't mask another's, and
        // registration order should match array order for determinism.
        await engine.registerNode(source);
    }
    return engine;
}
