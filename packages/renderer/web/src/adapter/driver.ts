// Draws a frame from core's own pieces around the adapter's render context: build the clips, evaluate state
// at the frame, lay out, and render until no decode is pending.

import {
    AssetManager, AudioSink, ClipStore, AssetTimeline, ManifestAssetCatalog, type ProjectDocument, type Registry,
    renderSettled, setTheme, StateEvaluator, StorageAdapter,
} from "@motionscript/core";
import type { WgpuRenderContext } from "./context";

class SilentAudio extends AudioSink {
    override get schedulesAudio(): boolean { return false; }
    has(): boolean { return true; }
    async append(): Promise<void> {}
    retain(): void {}
    schedule(): void {}
    syncTo(): void {}
    play(): void {}
    stop(): void {}
}

/** Asset keys as scenes write them ("./cat.jpg") and as the manifest lists them ("cat.jpg"). */
export const assetKey = (src: string) => src.replace(/^\.?\//, "");

/** A decoded image the doc can paint with. */
export interface Decoded { bitmap: ImageBitmap; bytes: Uint8Array; width: number; height: number }

/** Media for the harness: decoded images by asset key (video and fonts later). */
export class AdapterStorage extends StorageAdapter {
    constructor(catalog: never, viewport: never, private urls: Record<string, string>, readonly images: Map<string, Decoded>, private videoUrls: Record<string, string> = {}) {
        super(catalog, viewport);
    }
    async loadImage(src: string): Promise<void> {
        const key = assetKey(src);
        if (this.images.has(key)) return;
        const url = this.urls[key];
        if (!url) return;
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        let bitmap: ImageBitmap;
        if (key.endsWith(".svg")) {
            // createImageBitmap can't decode SVG; an <img> can (at its natural size).
            const img = new Image();
            img.src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/svg+xml" }));
            await img.decode();
            bitmap = await createImageBitmap(img);
        } else bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
        this.images.set(key, { bitmap, bytes, width: bitmap.width, height: bitmap.height });
    }
    /** Open videos by asset key, and their decoded frames by key@time. */
    readonly videos = new Map<string, HTMLVideoElement>();
    readonly frames = new Map<string, ImageBitmap>();
    private pending = new Map<string, { key: string; time: number }>();

    async loadVideo(src: string): Promise<void> {
        const key = assetKey(src);
        if (this.videos.has(key) || !this.videoUrls[key]) return;
        const v = document.createElement("video");
        v.muted = true;
        v.preload = "auto";
        v.src = this.videoUrls[key];
        await new Promise<void>((resolve, reject) => {
            v.onloadeddata = () => resolve();
            v.onerror = () => reject(new Error(`video ${key} failed to load`));
        });
        this.videos.set(key, v);
    }

    /** The frame of `src` at `time` s, or null (queued for warmPendingDecodes). */
    videoFrame(src: string, time: number): ImageBitmap | null {
        const key = assetKey(src);
        const id = `${key}@${time.toFixed(6)}`;
        const f = this.frames.get(id);
        if (f) return f;
        if (this.videos.has(key)) this.pending.set(id, { key, time });
        return null;
    }

    override hasPendingDecodes(): boolean {
        return this.pending.size > 0;
    }

    override async warmPendingDecodes(): Promise<boolean> {
        if (this.pending.size === 0) return false;
        for (const [id, { key, time }] of [...this.pending]) {
            const v = this.videos.get(key)!;
            await new Promise<void>((resolve) => {
                v.onseeked = () => resolve();
                v.currentTime = time;
            });
            this.frames.set(id, await createImageBitmap(v));
            this.pending.delete(id);
        }
        return true;
    }
    async loadAudio(): Promise<void> {}
    async fetchAudioData(): Promise<ArrayBuffer> { return new ArrayBuffer(0); }
    async loadFont(): Promise<boolean> { return true; }
}

/** Media the scenes may reference: asset key → URL; videos with their duration (s). */
export interface Media { images: Record<string, string>; videos?: Record<string, { url: string; duration: number }> }

export async function drawFrameAt(project: ProjectDocument, registry: Registry, ctx: WgpuRenderContext, frame: number | "last", media: Media = { images: {} }) {
    const { fps, viewport } = project as Required<ProjectDocument>;
    setTheme(project.theme as never);
    const image = Object.fromEntries(Object.entries(media.images).map(([key, src]) => [key, { src, width: 0, height: 0, sizeBytes: 0 }]));
    const videos = media.videos ?? {};
    const video = Object.fromEntries(Object.entries(videos).map(([key, v]) => [key, { src: v.url, width: 0, height: 0, duration: v.duration, sizeBytes: 0 }]));
    const assets = new ManifestAssetCatalog({ image, video, audio: {}, font: {} });
    const storage = new AdapterStorage(assets as never, viewport as never, media.images, ctx.images, Object.fromEntries(Object.entries(videos).map(([k, v]) => [k, v.url])));
    ctx.storage = storage;
    const scope = { registry, viewport, fps, assets, measurer: ctx };
    const loads: { manager?: AssetManager } = {};
    const store = new ClipStore(project, scope as never, { isReady: (key: string) => loads.manager?.isReady(key) ?? false });
    const precomper = new AssetTimeline(project, scope as never, { store });
    const evaluator = new StateEvaluator(project, scope as never, store);
    const { totalFrames } = precomper.result();
    const target = Math.max(0, Math.min(totalFrames - 1, frame === "last" ? totalFrames - 1 : Math.floor(frame)));
    const precomp = precomper.ensureCovering(target);
    const manager = (loads.manager = new AssetManager(precomp, storage, new SilentAudio()));
    await manager.loadAt(target);
    evaluator.stateAt(target);
    evaluator.layout(ctx);
    await renderSettled(() => ctx.execute(() => evaluator.render(ctx)), storage, () => true);
    return { frame: target, totalFrames, buildErrors: precomp.buildErrors };
}
