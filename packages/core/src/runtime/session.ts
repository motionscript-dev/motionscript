import { Size2D } from "@/attributes/layout/size";
import { AssetManifest } from "@/assets/manifest";
import { ManifestAssetCatalog } from "@/assets/catalog";
import { setTheme } from "@/attributes/shape/fill/color/parser";
import { asProjectDocument, type ProjectDocument } from "@/document/project";
import type { VisualDocument } from "@/document/types";
import { assertValidProjectDocument } from "@/document/validate";
import { migrateDocument } from "@/document/migrate";
import { ExportStillRequest, ExportVideoRequest, ExportedStill } from "@/platform/exporter";
import { Engine, EngineRenderContext } from "./engine";
import { Playback } from "./playback";
import { clipTimeToFrame } from "./frame-time";
import { PlaybackController } from "./playback-controller";
import { AssetTimelineResult } from "./asset-timeline";
import { StorageAdapter } from "@/platform/storage-adapter";
import { SteppedClock } from "@/platform/stepped-clock";

/** A lone still or composition is the one track of a project around it. */
export interface SessionSource {
    document: ProjectDocument | VisualDocument;
    /** A lone clip document carries neither; these also win over a project's own. */
    viewport?: Size2D;
    fps?: number;
}

export interface OpenOptions extends SessionSource {
    /**
     * A canvas in a browser, a size headlessly; the platform's render context narrows it. Omit to open without
     * mounting, for a session that only exports.
     */
    target?: unknown;
    onPrecompProgress?: (result: AssetTimelineResult) => void;
}

/**
 * Cheap relative to its engine (a surface and a playhead; the caches belong to the engine), so many sessions
 * over one engine is the intended shape: a preview, a filmstrip, an export.
 *
 * The theme is still applied through a process-global registry (`setTheme`), re-applied immediately before
 * anything draws, so concurrent sessions with different themes would contend. Isolating that means threading a
 * context through every colour parse.
 */
export class Session {
    readonly viewport: Size2D;
    readonly fps: number;

    /** @internal — created by `Engine.open`, never directly. */
    constructor(
        private readonly engine: Engine,
        options: OpenOptions,
    ) {
        this._override = { viewport: options.viewport, fps: options.fps };
        this._project = resolveProjectDocument(options.document, options, engine);
        this.viewport = this._project.viewport!;
        this.fps = this._project.fps!;

        this._catalog = new ManifestAssetCatalog(engine.manifest);
        /**
         * The controller, its clip store and every node's `assets` hold this object, so a new one would reach only the
         * storage adapter.
         */
        this._unsubscribe = engine._onManifestChange((manifest: AssetManifest) => {
            this._catalog.reconcile(manifest);
            this._storage.setCatalog(this._catalog);
            this._controller.reconcileCatalog();
        });

        const deps = { catalog: this._catalog, viewport: this.viewport, fps: this.fps };
        this._storage = engine.platform.createStorageAdapter(deps);
        this._renderContext = engine.platform.createRenderContext(this._storage);
        const measurer = engine.platform.createMeasureContext(this._storage);
        const audioDevice = engine.platform.createAudioSink();
        const masterClock = engine.platform.createTicker(this.fps, audioDevice);

        // Before the first measuring pass, which resolves theme tokens.
        this.applyGlobals();

        if (options.target !== undefined) this._renderContext.mount(options.target);

        /**
         * `null` means no realtime transport here, not "nothing works": seeking, picking and drawing are the same
         * headlessly, so a stepped clock stands in and only `playback` reports the absence.
         */
        this._controller = new PlaybackController({
            project: this._project,
            registry: engine._registry,
            renderContext: this._renderContext,
            measurer,
            storageAdapter: this._storage,
            masterClock: masterClock ?? new SteppedClock(),
            audioDevice,
            assets: this._catalog,
            onPrecompProgress: options.onPrecompProgress,
        });
        this._playback = masterClock === null ? null : new Playback(this._controller);
    }

    get document(): ProjectDocument {
        return this._project;
    }

    get playback(): Playback | null {
        return this._playback;
    }

    /**
     * Exposed rather than proxied: `Session` covers the document (what is open, where it draws, how it encodes),
     * the controller inspecting and manipulating a live frame. Always present, including headlessly (see
     * `SteppedClock`).
     */
    get controller(): PlaybackController {
        return this._controller;
    }

    /** A host reads it to resize or re-frame the view. */
    get surface(): EngineRenderContext {
        return this._renderContext;
    }

    get duration(): number {
        return this._controller.totalDuration;
    }

    get totalFrames(): number {
        return this._controller.totalFrames;
    }

    async seek(seconds: number): Promise<void> {
        await this.seekFrame(Math.round(clipTimeToFrame(seconds, this.fps)));
    }

    async seekFrame(frame: number): Promise<void> {
        this.applyGlobals();
        await this._controller.seek(frame);
    }

    /**
     * The new document is diffed against the playing one and each built tree patched in place; a track is rebuilt
     * only when its change cannot be patched, and a theme change rebuilds every track. Documents are compared by
     * content with identity as the fast path, so treat them as immutable. The output's size and rate cannot change
     * under a live surface; a document asking for different ones needs a session of its own.
     */
    replace(document: ProjectDocument | VisualDocument): void {
        const next = resolveProjectDocument(document, this._override, this);
        if (next.fps !== this.fps || next.viewport!.width !== this.viewport.width
            || next.viewport!.height !== this.viewport.height) {
            throw new Error(
                `Cannot replace a ${this.viewport.width}×${this.viewport.height} @ ${this.fps}fps document with a ` +
                `${next.viewport!.width}×${next.viewport!.height} @ ${next.fps}fps one — open a new session.`,
            );
        }
        this._project = next;
        this.applyGlobals();
        this._controller.setProject(next);
    }

    image(options: Partial<Omit<ExportStillRequest, "project" | "registry">> = {}): Promise<ExportedStill> {
        this.applyGlobals();
        return this.engine.exporter.exportStill({
            ...options,
            frame: options.frame ?? { kind: "last" },
            project: this._project,
            registry: this.engine._registry,
            manifest: options.manifest ?? this.engine.manifest,
        });
    }

    export(options: Omit<ExportVideoRequest, "project" | "registry"> = {}): Promise<Uint8Array | void> {
        this.applyGlobals();
        return this.engine.exporter.exportVideo({
            ...options,
            project: this._project,
            registry: this.engine._registry,
            manifest: options.manifest ?? this.engine.manifest,
        });
    }

    dispose(): void {
        this._unsubscribe();
        this._controller.dispose();
        this._renderContext.dispose();
    }

    /** Another session may have written it since. */
    private applyGlobals(): void {
        setTheme(this._project.theme);
    }

    private readonly _override: { viewport?: Size2D; fps?: number };
    private _project: ProjectDocument;
    private readonly _catalog: ManifestAssetCatalog;
    private readonly _storage: StorageAdapter;
    private readonly _renderContext: EngineRenderContext;
    private readonly _controller: PlaybackController;
    private readonly _playback: Playback | null;
    private readonly _unsubscribe: () => void;
}

/**
 * `override` first, then the document's own, then `fallback`. Migrated and validated once, here, so every host
 * that renders a document agrees on which size wins. Throws `DocumentTooNewError` for a format this engine
 * cannot read. A migration that changed only the version stamp plays the document as given, so a host
 * replacing the same object keeps the identity fast path.
 */
export function resolveProjectDocument(
    document: ProjectDocument | VisualDocument,
    override: { viewport?: Size2D; fps?: number },
    fallback: { viewport: Size2D; fps: number },
): ProjectDocument {
    const opened = asProjectDocument(document);
    const migrated = migrateDocument(opened);
    const project = migrated.changes.length > 0 ? migrated.document : opened;
    const resolved: ProjectDocument = {
        ...project,
        viewport: override.viewport ?? project.viewport ?? fallback.viewport,
        fps: override.fps ?? project.fps ?? fallback.fps,
    };
    assertValidProjectDocument(resolved);
    return resolved;
}
