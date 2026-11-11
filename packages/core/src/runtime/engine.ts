import { Size2D } from "@/attributes/layout/size";
import type { Shader } from "@/attributes/shape/shaders/pack";
import { AssetCatalog } from "@/assets/catalog";
import { AssetManifest } from "@/assets/manifest";
import { Registry, type NodeConstructor, type RegistryOptions } from "@/document/registry";
import { AudioSink } from "@/platform/audio-sink";
import { Exporter } from "@/platform/exporter";
import { Ticker } from "@/platform/ticker";
import { StorageAdapter } from "@/platform/storage-adapter";
import { CanvasRenderContext2D } from "@/render/canvas-render-context2d";
import { MeasureContext2D } from "@/render/measure-context";
import { RenderSurface } from "@/render/surface";
import { OpenOptions, Session } from "./session";

export type EngineRenderContext = CanvasRenderContext2D & RenderSurface;

export interface PlatformDeps {
    catalog: AssetCatalog;
    viewport: Size2D;
    fps: number;
}

/**
 * Each seam is a factory, not an instance: a storage adapter is per-viewport (it clamps decode resolution, so
 * a decode cached for one viewport is wrong at a larger one) while the engine outlives any session.
 *
 * The type parameter lets a platform hand its factories a richer storage adapter without `core` naming that
 * type; core stores and forwards these, never inspects them.
 */
export interface EnginePlatform<TStorage extends StorageAdapter = StorageAdapter> {
    createStorageAdapter(deps: PlatformDeps): TStorage;
    createRenderContext(storage: TStorage): EngineRenderContext;
    createMeasureContext(storage: TStorage): MeasureContext2D;
    createAudioSink(): AudioSink;
    /**
     * `null` when this environment has no realtime playback (a headless export has no wall clock): the session
     * reports `playback === null` rather than faking one.
     *
     * This seam separates preview from export, not browser from server: an export is frame-stepped in either,
     * because a wall-clock export drifts. Handed `audioDevice` because a clock that drives sound must share its
     * timebase (the browser's runs on the device's `AudioContext`).
     */
    createTicker(fps: number, audioDevice: AudioSink): Ticker | null;
    createExporter(): Exporter;
    /** Torn down with the engine. For a platform holding a device or a process. */
    dispose?(): void;
}

/** What to render is passed to `open()`. */
export interface EngineOptions {
    /** Components as an array, or a record naming each key outright. */
    nodes?: RegistryOptions["nodes"];
    shaders?: RegistryOptions["shaders"];
    lerps?: RegistryOptions["lerps"];
    /** Enables `Engine.registerNode` with a source string; see `DynamicNodeConfig`. */
    dynamicNodes?: RegistryOptions["dynamicNodes"];
    /** See `RegistryOptions.strict`. */
    strict?: boolean;
    /**
     * Asset metadata the renderer needs before it loads a file (an image's size, a clip's duration). Reconciled
     * with {@link Engine.setManifest} rather than rebuilt, so a change keeps every decode already cached.
     */
    manifest?: AssetManifest;
    /** Viewport used when a source carries none. Defaults to 1920×1080. */
    viewport?: Size2D;
    /** Frame rate used when a source carries none. Defaults to 60. */
    fps?: number;
}

export const DEFAULT_VIEWPORT: Size2D = { width: 1920, height: 1080 };
export const DEFAULT_FPS = 60;
/** What a document renders at when neither the caller nor the document says. */
export const DEFAULT_OUTPUT: { viewport: Size2D; fps: number } = { viewport: DEFAULT_VIEWPORT, fps: DEFAULT_FPS };
export const EMPTY_MANIFEST: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };

/**
 * Expensive and meant to be shared, one per app: the caches underneath it (registered fonts, decoded images,
 * shaped paragraphs) are why a warm engine beats a cold one, and live here so a preview, a filmstrip and an
 * export share them.
 *
 * What belongs here rather than on a `Session`: if two open documents could disagree about it, it is session
 * state. They can disagree about a theme; they cannot disagree about whether `"pulseRing"` is a registered
 * type, since one of them is simply invalid.
 */
export class Engine<TStorage extends StorageAdapter = StorageAdapter> {
    readonly viewport: Size2D;
    readonly fps: number;

    constructor(
        readonly platform: EnginePlatform<TStorage>,
        options: EngineOptions = {},
    ) {
        this._registry = new Registry({
            nodes: options.nodes,
            shaders: options.shaders,
            lerps: options.lerps,
            dynamicNodes: options.dynamicNodes,
            strict: options.strict,
        });
        this.viewport = options.viewport ?? DEFAULT_VIEWPORT;
        this.fps = options.fps ?? DEFAULT_FPS;
        this._manifest = options.manifest ?? EMPTY_MANIFEST;
        this._exporter = platform.createExporter();
    }

    get manifest(): AssetManifest {
        return this._manifest;
    }

    get exporter(): Exporter {
        return this._exporter;
    }

    /** Replaces what the catalog reports, not the bytes behind it, so existing sessions keep every decode. */
    setManifest(manifest: AssetManifest): void {
        this._manifest = manifest;
        for (const notify of this._manifestListeners) notify(manifest);
    }

    /**
     * Cheap: the renderer, fonts, decoded images and shaped paragraphs belong to the engine and are shared across
     * every session.
     */
    open(options: OpenOptions): Session {
        return new Session(this as Engine, options);
    }

    knows(key: string): boolean {
        return this._registry.hasNode(key);
    }

    /** Read-only: register or replace through `registerNode`/`registerShader`. */
    get registry(): Registry {
        return this._registry;
    }

    /**
     * Always `async`: one calling convention whether the argument resolves immediately (a class) or needs
     * compiling (a string).
     */
    async registerNode(
        nodeOrSource: NodeConstructor | string,
        options?: { replace?: boolean },
    ): Promise<NodeConstructor> {
        if (typeof nodeOrSource === "string") {
            return this._registry.addNodeFromSource(nodeOrSource, options);
        }
        this._registry.addNode(nodeOrSource, options);
        return nodeOrSource;
    }

    /** See `Registry.addShader` for why the key is never inferred from the pack. */
    registerShader(key: string, pack: unknown, options?: { replace?: boolean }): Shader {
        return this._registry.addShader(key, pack, options);
    }

    dispose(): void {
        this._manifestListeners.clear();
        this.platform.dispose?.();
    }

    /**
     * Not public surface; reach it through `registerNode`/`registerShader`/`knows`. A `Session` (same package)
     * reads it directly; nothing enforces that, as with `_onManifestChange`.
     */
    readonly _registry: Registry;
    private _manifest: AssetManifest;
    private readonly _exporter: Exporter;
    private readonly _manifestListeners = new Set<(m: AssetManifest) => void>();

    /** @internal A `Session` registers here for the life of its catalog. */
    _onManifestChange(notify: (m: AssetManifest) => void): () => void {
        this._manifestListeners.add(notify);
        return () => this._manifestListeners.delete(notify);
    }
}
