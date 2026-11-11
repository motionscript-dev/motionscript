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

/** Which frame to draw: a global frame index, the timeline's `"first"`/`"last"`, or a `FrameSpec`. */
export type FrameRef = FrameSpec | number | "first" | "last";

export interface StillRendererOptions extends RendererWasmOption {
    /** Omit and the renderer makes its own hidden canvas and removes it on {@link StillRenderer.dispose}; a live preview passes the one it shows. */
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
    /** The vocabulary a document compiles against. Defaults to a fresh one with only what the library ships; a host with custom node types passes the same one it gave its engine. */
    registry?: Registry;
}

export interface RenderStillOptions {
    /** Which frame to draw. Defaults to the timeline's first. */
    frame?: FrameRef;
    /** Seconds into the timeline, converted with the document's fps. Wins over `frame`. */
    time?: number;
    /** Draw this call at this pixel ratio instead of the renderer's. **Resizes the canvas and rebuilds the surface**, and the next call without it rebuilds back: keep it off the per-edit path. */
    scale?: number;
    /** What the renderer drew but not as the document says; a lost GPU device throws `RenderBackendError` instead. */
    onIssue?: (issue: RenderIssue) => void;
}

export interface EncodeStillOptions {
    format?: ScreenshotFormat;
    /** JPEG quality in [0,1]; ignored for png. Defaults to 0.92. */
    quality?: number;
}

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
 * A long-lived single-frame renderer. Where `exportScreenshot` is one frame from a standing start, this keeps the
 * renderer module, its GPU surface and the storage adapter's decode cache alive, so re-rendering after an edit costs
 * discovering one frame and a draw. {@link render} goes through `drawFrameAt`, the pass the video exporter runs per
 * frame, so a preview and its exported image cannot drift apart.
 *
 * ```ts
 * const renderer = await createStillRenderer({ canvas, viewport, manifest, theme });
 * await renderer.render({ kind: "still", nodes: [...] });
 * const blob = await renderer.toBlob({ format: "png" });
 * renderer.dispose();
 * ```
 *
 * **The theme is process-global in core.** {@link render} re-applies its theme before every draw, so renderers with
 * different themes each draw correctly, but anything else calling `setTheme` between a render and a read of the
 * surface is overwritten by the next render.
 *
 * **One surface, one caller at a time.** The next render draws over the surface between a render and the encode of
 * its result, so callers sharing a renderer must be queued (as `session.image()` does).
 */
export class StillRenderer {
    readonly canvas: HTMLCanvasElement;

    private renderContext: BrowserRenderContext;
    private storageAdapter: StorageAdapter;
    private catalog: AssetCatalog;

    private readonly backend: BrowserRenderer;
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

    /** The surface is the output, so this renderer's viewport wins over any size the document asks for. */
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

    setTheme(theme?: Theme): void { this.theme = theme; }

    setManifest(manifest: AssetManifest): void {
        this.assertLive();
        this.manifest = manifest;
        this.catalog = new ManifestAssetCatalog(manifest);
        this.storageAdapter.setCatalog(this.catalog);
    }

    /** A full reset, unlike {@link setManifest}: cached decodes were made at the old viewport's resolution and the render context's handlers captured the adapter, so both are rebuilt. Call when the output format changes, not per edit. */
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

    /** Reads the surface back into a 2D canvas, which does the encoding: the renderers ship no image encoders. */
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
