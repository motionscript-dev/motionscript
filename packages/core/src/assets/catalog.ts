import { type AudioMeta, type FontMeta, type ImageMeta, AssetManifest, type VideoMeta } from "./manifest";

/**
 * What a scene can ask about available assets: strictly read-only *metadata* (dimensions, durations, font faces).
 * Loading is the {@link AssetManager}'s job. Reachable as `node.assets` and `stage.assets`.
 *
 * **Every lookup throws on a miss rather than returning `undefined`**: a missing asset is a typo or deleted file, best
 * surfaced during the precomp pass (a `BuildError`) rather than as a shape that silently fails to paint at playback.
 * An interface so a host can supply its own; {@link ManifestAssetCatalog} is built from the project's manifest.
 */
export interface AssetCatalog {
    getImageMeta(src: string): ImageMeta;

    getVideoMeta(src: string): VideoMeta;

    getAudioMeta(src: string): AudioMeta;

    getFontMeta(key: string): FontMeta;

    /** Every face registered for a family across weights and slants, so the font matcher can resolve any weight to the nearest file. Empty if unknown. */
    getFontFamilyMetas(fontFamily: string): FontMeta[];

    /** Playback duration of a video, in seconds. */
    getVideoDuration(src: string): number;

    /** Playback duration of an audio file, in seconds. */
    getAudioDuration(src: string): number;

    /** Duration of any *playable* source: audio first, falling back to video, so a video `src` can drive a `Sound` without a duplicate audio-only entry. @throws If `src` is in neither manifest. */
    getMediaDuration(src: string): number;

    /** An image's intrinsic pixel dimensions. */
    getImageSize(src: string): { width: number; height: number };
}

/** The {@link AssetCatalog} the runtime builds: a query engine over a static {@link AssetManifest}. */
export class ManifestAssetCatalog implements AssetCatalog {
    constructor(private manifest: AssetManifest) { }

    /** Points this catalog at `manifest` in place: a session hands one catalog to the controller, clip store and every node's `assets`, so replacing the object would leave them on the old one. */
    reconcile(manifest: AssetManifest): void {
        this.manifest = manifest;
    }

    /** Normalizes a caller's asset `src` to the manifest key: the path relative to the public folder, forward slashes, no leading `./` or `/`. Authors write bare filenames, `./sub/file.png`, `/sub/file.png` or backslash paths. Fonts are keyed `family@weight` and skip this. */
    private normalizeKey(src: string): string {
        return src.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    }

    getImageMeta(src: string): ImageMeta {
        const meta = this.manifest.image[this.normalizeKey(src)];
        if (!meta) throw new Error(`Image asset not found: "${src}". Check the file exists in your public folder and the src matches its filename.`);
        return meta;
    }

    getVideoMeta(src: string): VideoMeta {
        const meta = this.manifest.video[this.normalizeKey(src)];
        if (!meta) throw new Error(`Video asset not found: "${src}". Check the file exists in your public folder and the src matches its filename.`);
        return meta;
    }

    getAudioMeta(src: string): AudioMeta {
        const meta = this.manifest.audio[this.normalizeKey(src)];
        if (!meta) throw new Error(`No audio metadata for src: ${src}`);
        return meta;
    }

    getFontMeta(key: string): FontMeta {
        const meta = this.manifest.font[key];
        if (!meta) throw new Error(`No font metadata for key: ${key}`);
        return meta;
    }

    getFontFamilyMetas(fontFamily: string): FontMeta[] {
        return Object.values(this.manifest.font).filter(meta => meta.fontFamily === fontFamily);
    }

    getVideoDuration(src: string): number {
        return this.getVideoMeta(src).duration;
    }

    getAudioDuration(src: string): number {
        return this.getAudioMeta(src).duration;
    }

    getMediaDuration(src: string): number {
        const key = this.normalizeKey(src);
        const audio = this.manifest.audio[key];
        if (audio) return audio.duration;
        const video = this.manifest.video[key];
        if (video) return video.duration;
        throw new Error(`Audio asset not found: "${src}". Check the file exists in your public folder and the src matches its filename.`);
    }

    getImageSize(src: string): { width: number; height: number } {
        const { width, height } = this.getImageMeta(src);
        return { width, height };
    }
}
