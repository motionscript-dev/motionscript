import {
    AssetCatalog, DEFAULT_OUTPUT, ManifestAssetCatalog,
    frameSpecAtTime,
    Registry,
    resolveProjectDocument,
    type AssetManifest,
    type FrameSpec,
    type RenderIssue,
    type ProjectDocument,
    type VisualDocument,
    type Size2D,
    type StorageAdapter,
    type Theme,
} from "@motionscript/core";
import {
    drawFrameAt,
    type DrawnFrame,
    type ScreenshotFormat,
} from "./frame-loop";
import type { BrowserRenderContext, BrowserRenderer } from "./engine";
import { loadRenderer, type RendererWasmOption } from "./renderer";

const EMPTY_MANIFEST: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };

/** Anything a still can be rendered from: a project, or a lone still or composition as the one track of one. */
export type StillSource = ProjectDocument | VisualDocument;

/**
 * Which frame to draw, in whatever form is most convenient — a global frame
 * index, the timeline's first or last frame, or a `FrameSpec`.
 */
export type FrameRef = FrameSpec | number | "first" | "last";

export interface StillRendererOptions extends RendererWasmOption {
    /**
     * The canvas to draw into. Omit and the renderer creates its own hidden one
     * and removes it on {@link StillRenderer.dispose} — which is what a one-shot
     * capture wants, while a live preview passes the canvas it already shows.
     */
    canvas?: HTMLCanvasElement;
    /** Output resolution in pixels, whatever the document asks for. Defaults to 1920×1080. */
    viewport?: Size2D;
    /** Frame rate for a document that sets none. Defaults to 60. */
    fps?: number;
    /** Device pixel ratio the surface is sized at. Defaults to 1. */
    scale?: number;
    manifest?: AssetManifest;
    /** Theme for a document that carries none of its own. */
    theme?: Theme;
    /**
     * The vocabulary a document is compiled against.
     *
     * Defaults to a fresh one carrying only what the library ships — a renderer
     * owns its registry the way an engine does, so a host with custom node types
     * passes the same one it gave its engine rather than relying on whatever a
     * module happened to register.
     */
    registry?: Registry;
}

export interface RenderStillOptions {
    /** Which frame to draw. Defaults to the timeline's first. */
    frame?: FrameRef;
    /** Seconds into the timeline, converted with the document's fps. Wins over `frame`. */
    time?: number;
    /**
     * Draw this call at this pixel ratio instead of the renderer's. **Resizes the
     * canvas and rebuilds the surface**, and the next call without it rebuilds
     * them back, so keep it off the per-edit path — render the preview at its
     * normal scale and pass this only when capturing at a higher one.
     */
    scale?: number;
    /** What the renderer drew but not as the document says; a lost GPU device throws `RenderBackendError` instead. */
    onIssue?: (issue: RenderIssue) => void;
}

export interface EncodeStillOptions {
    /** Defaults to `"png"`. */
    format?: ScreenshotFormat;
    /** JPEG quality in [0,1]; ignored for png. Defaults to 0.92. */
    quality?: number;
}

/** Normalize the many ways a caller can name a frame into the engine's own form. */
export function stillFrameSpec(options: RenderStillOptions | undefined, fps: number): FrameSpec {
    if (options?.time !== undefined) return frameSpecAtTime(options.time, fps);
    const frame = options?.frame;
    if (frame === undefined || frame === "first") return { kind: "first" };
    if (frame === "last") return { kind: "last" };
    if (typeof frame === "number") return { kind: "frame", frame };
    return frame;
}

function mimeOf(format: ScreenshotFormat): string {
    return format === "jpeg" ? "image/jpeg" : "image/png";
}

/**
 * A long-lived single-frame renderer.
 *
 * Where `exportScreenshot` is one frame from a standing start, this keeps the
 * expensive things — the renderer module, its GPU surface, and the
 * storage adapter's decoded-asset cache — alive across calls, so re-rendering
 * after an edit costs discovering one frame and a draw rather than a new GL
 * context. That is
 * the difference between a one-off capture and a builder that repaints while the
 * user types.
 *
 * It is also the *same* draw: {@link render} goes through `drawFrameAt`, which is
 * the pass the video exporter runs per frame. A preview and its exported image
 * cannot drift apart, because there is only one path.
 *
 * ```ts
 * const renderer = await createStillRenderer({ canvas, viewport, manifest, theme });
 * await renderer.render({ kind: "still", nodes: [
 *     { id: "bg", type: "rect", parentId: null, layerOrder: 0, props: { width: 1920, height: 1080, fill: "bg" } },
 * ] });
 * const blob = await renderer.toBlob({ format: "png" });
 * renderer.dispose();
 * ```
 *
 * **The theme is process-global in core.** {@link render} re-applies the
 * document's (or this renderer's) before every draw, so two renderers with
 * different themes still each draw correctly; but anything else that calls
 * `setTheme` between a render and a read of the surface will have been
 * overwritten by the next render.
 *
 * **One surface, one caller at a time.** A render and the encode of its result
 * are two calls, and the next render draws over the surface between them, so
 * callers that share a renderer without knowing of each other must be queued —
 * as `session.image()` queues its calls.
 */
export class StillRenderer {
    readonly canvas: HTMLCanvasElement;

    private renderContext: BrowserRenderContext;
    private storageAdapter: StorageAdapter;
    private catalog: AssetCatalog;

    private readonly backend: BrowserRenderer;
    /** True when we made the canvas and must clean it up. */
    private readonly ownsCanvas: boolean;

    private viewportValue: Size2D;
    private readonly fpsValue: number;
    private readonly scaleValue: number;
    /** What the canvas is sized at now, which a call's own `scale` changes. */
    private surfaceScale: number;
    private manifest: AssetManifest;
    private theme?: Theme;
    private readonly registry: Registry;
    private disposed = false;
    /** False until a frame has been drawn onto the current surface; a remount clears it. */
    private drawn = false;

    /** @internal Use {@link createStillRenderer}, which loads the renderer first. */
    constructor(
        backend: BrowserRenderer,
        options: StillRendererOptions,
    ) {
        this.backend = backend;
        this.viewportValue = options.viewport ?? DEFAULT_OUTPUT.viewport;
        this.fpsValue = options.fps ?? DEFAULT_OUTPUT.fps;
        this.scaleValue = options.scale ?? 1;
        this.surfaceScale = this.scaleValue;
        this.manifest = options.manifest ?? EMPTY_MANIFEST;
        this.theme = options.theme;
        this.registry = options.registry ?? new Registry();

        this.ownsCanvas = options.canvas === undefined;
        this.canvas = options.canvas ?? document.createElement("canvas");
        if (this.ownsCanvas) {
            this.canvas.style.display = "none";
            document.body.appendChild(this.canvas);
        }
        this.sizeCanvas();

        this.catalog = new ManifestAssetCatalog(this.manifest);
        this.storageAdapter = this.backend.createStorageAdapter({
            catalog: this.catalog, viewport: this.viewportValue, fps: this.fpsValue,
        });
        this.renderContext = this.backend.createRenderContext(this.storageAdapter);
        this.renderContext.mount(this.canvas);
    }

    get viewport(): Size2D { return this.viewportValue; }
    get fps(): number { return this.fpsValue; }
    get scale(): number { return this.scaleValue; }

    /**
     * Draw one frame of `source`, at this renderer's viewport — the surface is
     * the output, so it wins over any size the document asks for.
     */
    async render(source: StillSource, options?: RenderStillOptions): Promise<DrawnFrame> {
        this.assertLive();
        const scale = options?.scale ?? this.scaleValue;
        if (scale !== this.surfaceScale) this.remount(scale);
        await this.renderContext.whenMounted?.();

        const project = resolveProjectDocument(
            source, { viewport: this.viewportValue }, { viewport: this.viewportValue, fps: this.fpsValue },
        );

        const frame = await drawFrameAt({
            project,
            registry: this.registry,
            theme: this.theme,
            scale,
            renderContext: this.renderContext,
            storageAdapter: this.storageAdapter,
            assetCatalog: this.catalog,
            frame: stillFrameSpec(options, project.fps!),
            onIssue: options?.onIssue,
        });
        this.drawn = true;
        return frame;
    }

    /** Theme for a document that carries none of its own. */
    setTheme(theme?: Theme): void { this.theme = theme; }

    /** Swap the asset manifest, keeping every decode already cached. */
    setManifest(manifest: AssetManifest): void {
        this.assertLive();
        this.manifest = manifest;
        this.catalog = new ManifestAssetCatalog(manifest);
        this.storageAdapter.setCatalog(this.catalog);
    }

    /**
     * Change the output resolution.
     *
     * A full reset, unlike {@link setManifest}: the viewport clamps the resolution
     * images are decoded *at*, so cached decodes made for the old one would be
     * soft at the new one, and the render context's handlers captured the adapter
     * when they were built — so both are rebuilt. Call this when the output format
     * changes, not per edit.
     */
    setViewport(viewport: Size2D): void {
        this.assertLive();
        if (viewport.width === this.viewportValue.width && viewport.height === this.viewportValue.height) {
            return;
        }
        this.viewportValue = viewport;
        // Disposing the context disposes the adapter it holds, so this releases
        // the old surface, its handlers and every decode in one call.
        this.renderContext.dispose();
        this.storageAdapter = this.backend.createStorageAdapter({
            catalog: this.catalog, viewport, fps: this.fpsValue,
        });
        this.renderContext = this.backend.createRenderContext(this.storageAdapter);
        this.remount(this.scaleValue);
    }

    /** Encode the frame currently on the surface. */
    async toBytes(options?: EncodeStillOptions): Promise<Uint8Array> {
        const blob = await this.toBlob(options);
        return new Uint8Array(await blob.arrayBuffer());
    }

    /** Encode the frame currently on the surface. */
    toBlob(options?: EncodeStillOptions): Promise<Blob> {
        const canvas = this.snapshotToCanvas();
        const { format = "png", quality = 0.92 } = options ?? {};
        return new Promise((resolve, reject) => {
            canvas.toBlob(
                (blob) => blob
                    ? resolve(blob)
                    : reject(new Error("Still encode produced no data.")),
                mimeOf(format),
                quality,
            );
        });
    }

    /** Encode the frame currently on the surface. */
    toDataURL(options?: EncodeStillOptions): string {
        const { format = "png", quality = 0.92 } = options ?? {};
        return this.snapshotToCanvas().toDataURL(mimeOf(format), quality);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.renderContext.dispose();
        if (this.ownsCanvas) this.canvas.remove();
    }

    /**
     * Read the surface back into a 2D canvas, which is what actually encodes: the
     * renderers ship no image encoders, so the browser's own codecs are the only
     * ones available.
     */
    private snapshotToCanvas(): HTMLCanvasElement {
        this.assertLive();
        if (!this.drawn) throw new Error("Nothing has been rendered yet.");
        const canvas = this.renderContext.snapshotCanvas?.();
        if (!canvas) throw new Error("Still encode: could not read the surface into a 2d canvas.");
        return canvas;
    }

    private sizeCanvas(): void {
        this.canvas.width = this.viewportValue.width * this.surfaceScale;
        this.canvas.height = this.viewportValue.height * this.surfaceScale;
    }

    /** Resize the backing store and mount a fresh surface over it. */
    private remount(scale: number): void {
        this.surfaceScale = scale;
        this.drawn = false;
        this.sizeCanvas();
        this.renderContext.mount(this.canvas);
    }

    private assertLive(): void {
        if (this.disposed) throw new Error("This StillRenderer has been disposed.");
    }
}

/** Create a {@link StillRenderer}; rejects with `WebGpuUnavailableError` without WebGPU. */
export async function createStillRenderer(
    options: StillRendererOptions = {},
): Promise<StillRenderer> {
    return new StillRenderer(await loadRenderer(options), options);
}
