// The engine's StorageAdapter for the wgpu renderer: assets decoded into what
// the adapter's render context paints with (ImageBitmaps by asset key, video
// frames by source and time) and font bytes for ms-text. Bytes come through
// the host's `loadBytes` (a plain fetch by default), so a local store is honoured.

import { type AssetCatalog, type Size2D, StorageAdapter } from "@motionscript/core";
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";
import type { VideoFrames } from "../adapter/context";
import { assetKey, type Decoded } from "../adapter/driver";

/** WebGPU's guaranteed texture edge; larger images are downscaled to fit. */
const MAX_TEXTURE_EDGE = 8192;
/** Decoded frames kept per video (scrubbing back and forth reuses them). */
const FRAMES_PER_VIDEO = 12;

interface VideoTrack {
    duration: number;
    sink: VideoSampleSink;
    input: Input;
    /** Decoded frames by time key, oldest first. */
    frames: Map<string, ImageBitmap>;
    last: ImageBitmap | null;
}

export interface FontFile {
    bytes: Uint8Array;
    family: string;
}

const timeKey = (time: number) => time.toFixed(4);

async function fetchBytes(src: string): Promise<Blob> {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    return res.blob();
}

export class WgpuStorageAdapter extends StorageAdapter implements VideoFrames {
    readonly images = new Map<string, Decoded>();
    readonly videos = new Map<string, VideoTrack>();
    /** Every font file registered so far, in order; renderers replay them. */
    readonly fonts: FontFile[] = [];
    private fontListeners = new Set<(font: FontFile) => void>();
    private registeredFamilies = new Set<string>();
    private pending = new Map<string, { src: string; time: number }>();
    /** SVGs by asset key, kept to rasterize again at the edge a draw needs. */
    private vectors = new Map<string, { img: HTMLImageElement; edge: number }>();
    /** Vector keys a draw wants sharper, and the long edge (px) it wants. */
    private upgrades = new Map<string, number>();
    /** Other work a settled frame waits for (a surface's shader compiles): a promise while there is some. */
    private settlers = new Set<() => Promise<void> | null>();
    private audioData = new Map<string, Promise<ArrayBuffer>>();

    constructor(catalog: AssetCatalog, viewport: Size2D, readonly fps: number, private readonly loadBytes: (src: string) => Promise<Blob> = fetchBytes) {
        super(catalog, viewport);
    }

    /** The session's viewport, in scene units. */
    get size(): Size2D {
        return this.viewport;
    }

    /** Has `renderSettled` (exports, settled seeks) also wait for what `settler` reports pending. */
    addSettler(settler: () => Promise<void> | null): () => void {
        this.settlers.add(settler);
        return () => this.settlers.delete(settler);
    }

    /** Calls `listener` for each font registered from now on. */
    onFont(listener: (font: FontFile) => void): () => void {
        this.fontListeners.add(listener);
        return () => this.fontListeners.delete(listener);
    }

    async loadImage(src: string): Promise<void> {
        const key = assetKey(src);
        if (this.images.has(key)) return;
        const url = this.url(src, (c) => c.getImageMeta(src));
        const blob = await this.loadBytes(url);
        let bitmap: ImageBitmap;
        if (blob.type === "image/svg+xml" || /\.svg(\?|#|$)/i.test(url)) {
            // createImageBitmap can't decode SVG; an <img> can.
            const img = new Image();
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await blob.text())}`;
            await img.decode();
            bitmap = await createImageBitmap(img);
            this.vectors.set(key, { img, edge: Math.max(bitmap.width, bitmap.height) });
        } else {
            bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none" });
        }
        const edge = Math.max(bitmap.width, bitmap.height);
        if (edge > MAX_TEXTURE_EDGE) {
            const k = MAX_TEXTURE_EDGE / edge;
            const scaled = await createImageBitmap(bitmap, {
                resizeWidth: Math.max(1, Math.round(bitmap.width * k)),
                resizeHeight: Math.max(1, Math.round(bitmap.height * k)),
                resizeQuality: "high",
            });
            bitmap.close();
            bitmap = scaled;
        }
        this.images.set(key, { bitmap, bytes: new Uint8Array(0), width: bitmap.width, height: bitmap.height });
    }

    async loadVideo(src: string): Promise<void> {
        const key = assetKey(src);
        if (this.videos.has(key)) return;
        const url = this.url(src, (c) => c.getVideoMeta(src));
        const input = new Input({ source: new BlobSource(await this.loadBytes(url)), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track) {
            input.dispose();
            throw new Error(`loadVideo(${src}): no video track`);
        }
        const duration = await input.computeDuration();
        this.videos.set(key, { duration, sink: new VideoSampleSink(track), input, frames: new Map(), last: null });
    }

    videoFrame(src: string, time: number): ImageBitmap | null {
        const key = assetKey(src);
        const video = this.videos.get(key);
        if (!video) return null;
        const exact = video.frames.get(timeKey(time));
        if (exact) return exact;
        // By time as well: an echo asks for several frames of one clip at once.
        this.pending.set(`${key}@${timeKey(time)}`, { src: key, time });
        // The nearest earlier answer keeps playback from flashing empty while
        // the exact frame decodes; a settled render waits for it.
        return video.last;
    }

    /**
     * A draw of `src` covering `edge` device px along its long side. An SVG
     * has no resolution of its own, so one drawn larger than its raster is
     * rasterized again, at the next power-of-two multiple of its natural size.
     */
    wantImageEdge(src: string, edge: number): void {
        const key = assetKey(src);
        const vector = this.vectors.get(key);
        const image = this.images.get(key);
        if (!vector || !image || edge <= vector.edge) return;
        const natural = Math.max(image.width, image.height);
        const level = Math.min(MAX_TEXTURE_EDGE, natural * 2 ** Math.ceil(Math.log2(edge / natural)));
        if (level > vector.edge && level > (this.upgrades.get(key) ?? 0)) this.upgrades.set(key, level);
    }

    override hasPendingUpgrades(): boolean {
        return this.upgrades.size > 0;
    }

    override async warmPendingUpgrades(): Promise<boolean> {
        if (this.upgrades.size === 0) return false;
        const jobs = [...this.upgrades];
        this.upgrades.clear();
        for (const [key, edge] of jobs) {
            const vector = this.vectors.get(key), image = this.images.get(key);
            if (!vector || !image) continue;
            const k = edge / Math.max(image.width, image.height);
            const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * k)), Math.max(1, Math.round(image.height * k)));
            canvas.getContext("2d")!.drawImage(vector.img, 0, 0, canvas.width, canvas.height);
            const old = image.bitmap;
            // The natural size stays what places it; only the raster grows.
            image.bitmap = await createImageBitmap(canvas);
            vector.edge = edge;
            // Still painted by a doc until the next frame replaces it.
            queueMicrotask(() => old.close());
        }
        return true;
    }

    override hasPendingDecodes(): boolean {
        return this.pending.size > 0;
    }

    override async warmPendingDecodes(): Promise<boolean> {
        const other = [...this.settlers].map((s) => s()).filter((p) => p !== null);
        if (this.pending.size === 0 && other.length === 0) return false;
        const jobs = [...this.pending.values()];
        this.pending.clear();
        await Promise.all([...jobs.map(({ src, time }) => this.decodeFrame(src, time)), ...other]);
        return true;
    }

    private async decodeFrame(src: string, time: number): Promise<void> {
        const video = this.videos.get(src);
        if (!video) return;
        const sample = await video.sink.getSample(time);
        if (!sample) return;
        const frame = sample.toVideoFrame();
        let bitmap: ImageBitmap;
        try {
            bitmap = await createImageBitmap(frame);
        } finally {
            frame.close();
            sample.close();
        }
        video.frames.set(timeKey(time), bitmap);
        video.last = bitmap;
        while (video.frames.size > FRAMES_PER_VIDEO) {
            const [oldest, old] = video.frames.entries().next().value!;
            video.frames.delete(oldest);
            // Still painted by a doc until the next frame replaces it.
            if (old !== video.last) queueMicrotask(() => old.close());
        }
    }

    async loadAudio(): Promise<void> {}

    fetchAudioData(src: string): Promise<ArrayBuffer> {
        let data = this.audioData.get(src);
        if (!data) {
            // A video's own soundtrack is asked for under the video's key.
            const url = this.url(src, (c) => {
                try {
                    return c.getAudioMeta(src);
                } catch {
                    return c.getVideoMeta(src);
                }
            });
            data = (async () => (await this.loadBytes(url)).arrayBuffer())();
            this.audioData.set(src, data);
            data.catch(() => this.audioData.delete(src));
        }
        return data.then((b) => b.slice(0));
    }

    async loadFont(key: string, fontFamily: string): Promise<boolean> {
        if (this.registeredFamilies.has(fontFamily)) return true;
        const metas = this.catalog.getFontFamilyMetas(fontFamily);
        if (metas.length === 0) {
            if (this.getDecodePolicy() === "interactive") console.warn(`[WgpuStorageAdapter] No font manifest entry for "${key}".`);
            return false;
        }
        const sources = [...new Set(metas.map((m) => m.src))];
        const files = await Promise.all(sources.map(async (s) => new Uint8Array(await (await this.loadBytes(s)).arrayBuffer())));
        if (this.registeredFamilies.has(fontFamily)) return true;
        for (const bytes of files) {
            const font = { bytes, family: fontFamily };
            this.fonts.push(font);
            for (const listener of this.fontListeners) listener(font);
        }
        this.registeredFamilies.add(fontFamily);
        return true;
    }

    override dispose(): void {
        for (const image of this.images.values()) image.bitmap.close();
        this.images.clear();
        for (const video of this.videos.values()) {
            for (const frame of video.frames.values()) frame.close();
            video.input.dispose();
        }
        this.videos.clear();
        this.pending.clear();
        this.vectors.clear();
        this.upgrades.clear();
        this.fontListeners.clear();
        super.dispose();
    }

    /** The address a source's bytes live at: the manifest's, else the source itself. */
    private url(src: string, meta: (catalog: AssetCatalog) => { src?: string }): string {
        try {
            return meta(this.catalog).src || src;
        } catch {
            return src;
        }
    }
}
