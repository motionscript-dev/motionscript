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

/** A render context that also owns a surface — what a `Session` mounts into. */
export type EngineRenderContext = CanvasRenderContext2D & RenderSurface;

/** What a platform is given to build its per-session objects from. */
export interface PlatformDeps {
    catalog: AssetCatalog;
    viewport: Size2D;
    fps: number;
}

/**
 * How one environment supplies the pieces a `Session` runs on.
 *
 * Five of these are the seams `ControllerParams` has always declared; the sixth
 * is the {@link Exporter} port. Each is a **factory**, not an instance, because
 * a storage adapter is per-viewport (it clamps decode resolution, so a cached
 * decode made for one viewport is genuinely wrong at a larger one) while the
 * engine outlives any single session.
 *
 * The type parameter exists so a platform can hand its own factories a storage
 * adapter richer than `StorageAdapter` — a backend that needs decoded media of
 * its own — without `core` ever naming that type. Core
 * stores and forwards these; it never inspects them.
 */
export interface EnginePlatform<TStorage extends StorageAdapter = StorageAdapter> {
    createStorageAdapter(deps: PlatformDeps): TStorage;
    createRenderContext(storage: TStorage): EngineRenderContext;
    createMeasureContext(storage: TStorage): MeasureContext2D;
    createAudioSink(): AudioSink;
    /**
     * The clock a session plays against, or `null` when this environment has no
     * realtime playback — a headless export has no wall clock to sync to, and a
     * session there reports `playback === null` rather than faking one.
     *
     * This is the seam that separates **preview from export**, not browser from
     * server: an export is frame-stepped in either environment, because a
     * wall-clock export drifts.
     *
     * Handed the session's `audioDevice` because a clock that drives sound has
     * to share its timebase — the browser's runs on the audio device's own
     * `AudioContext`, and two independent clocks would drift against each other
     * within one session.
     */
    createTicker(fps: number, audioDevice: AudioSink): Ticker | null;
    createExporter(): Exporter;
    /** Torn down with the engine. For a platform holding a device or a process. */
    dispose?(): void;
}

/** Settings for the engine as a whole. What to render is passed to `open()`. */
export interface EngineOptions {
    /**
     * Node types any document opened here may name — components as an
     * array, or a record naming each key outright.
     */
    nodes?: RegistryOptions["nodes"];
    /** Shader packs any document opened here may name. Plain JSON. */
    shaders?: RegistryOptions["shaders"];
    /** Extra variable interpolations a document may name in `VariableSpec.lerp`. */
    lerps?: RegistryOptions["lerps"];
    /** Enables `Engine.registerNode` with a source string — see `DynamicNodeConfig`. */
    dynamicNodes?: RegistryOptions["dynamicNodes"];
    /** Fail a track's build on an unknown node type or command rather than building around it — see `RegistryOptions.strict`. */
    strict?: boolean;
    /**
     * Asset metadata the renderer needs *before* it loads a file — an image's
     * size, a clip's duration. Reconciled with {@link Engine.setManifest} rather
     * than rebuilt, so a manifest change keeps every decode already cached.
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
 * The configured environment a document runs in: what node types and shader
 * packs exist, where assets resolve from, who draws and who encodes.
 *
 * Expensive, and meant to be shared — one per app, not one per canvas. The
 * caches underneath it (registered fonts, decoded images, shaped paragraphs) are
 * the whole reason a warm engine beats a cold one, and they live here rather
 * than on a session so that a preview, a filmstrip of thumbnails and an export
 * all draw on the same ones.
 *
 * The rule for what belongs here rather than on a `Session`: **if two open
 * documents could disagree about it, it is session state.** Two documents can
 * disagree about a theme. They cannot disagree about whether `"pulseRing"` is a
 * registered type — one of them is simply invalid.
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

    /** The asset metadata sessions are opened against. */
    get manifest(): AssetManifest {
        return this._manifest;
    }

    /** How this engine's sessions turn themselves into bytes. */
    get exporter(): Exporter {
        return this._exporter;
    }

    /**
     * Swap in new asset metadata. Existing sessions keep every decode already
     * cached — this replaces what the *catalog* reports, not the bytes behind it.
     */
    setManifest(manifest: AssetManifest): void {
        this._manifest = manifest;
        for (const notify of this._manifestListeners) notify(manifest);
    }

    /**
     * Bind a document to this engine and a surface.
     *
     * Cheap: the expensive things — the renderer, registered fonts, decoded images,
     * shaped paragraphs — belong to the engine and are shared across every
     * session it opens.
     */
    open(options: OpenOptions): Session {
        return new Session(this as Engine, options);
    }

    /** Whether a document naming `key` can be compiled here. */
    knows(key: string): boolean {
        return this._registry.hasNode(key);
    }

    /**
     * Read-only introspection of this engine's node/command vocabulary — a
     * type's declared commands and each one's own `command({ args })`
     * descriptors, for a host that renders per-command UI from them (e.g.
     * which prop keys a `rotateTo` animates). Register or replace a type
     * through `registerNode`/`registerShader` instead; this getter exists for
     * reading the table those build, not for mutating it.
     */
    get registry(): Registry {
        return this._registry;
    }

    /**
     * Registers a node type at runtime — a class, or a TS source string
     * compiled through `dynamicNodes` (see `EngineOptions.dynamicNodes`).
     *
     * Always `async`: one calling convention whether the argument resolves
     * immediately (a class) or needs compiling first (a string).
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

    /**
     * Registers a shader pack at runtime, under an explicit key — see
     * `Registry.addShader` for why the key is never inferred from the pack.
     */
    registerShader(key: string, pack: unknown, options?: { replace?: boolean }): Shader {
        return this._registry.addShader(key, pack, options);
    }

    dispose(): void {
        this._manifestListeners.clear();
        this.platform.dispose?.();
    }

    /**
     * The node/shader/lerp vocabulary this engine's documents compile
     * against. Not part of the public surface — reach it through
     * `registerNode`/`registerShader`/`knows` instead. A `Session` (same
     * package) still reads this directly; nothing enforces that at the type
     * level, the same un-enforced convention `_onManifestChange` below
     * already uses.
     */
    readonly _registry: Registry;
    private _manifest: AssetManifest;
    private readonly _exporter: Exporter;
    /** Sessions subscribe so a `setManifest` reaches their live catalogs. */
    private readonly _manifestListeners = new Set<(m: AssetManifest) => void>();

    /** @internal — a `Session` registers here for the life of its catalog. */
    _onManifestChange(notify: (m: AssetManifest) => void): () => void {
        this._manifestListeners.add(notify);
        return () => this._manifestListeners.delete(notify);
    }
}
