import { AssetCatalog } from "@/assets/catalog";
import { AssetNotLoadedError } from "@/assets/errors";
import { AssetRecord } from "@/assets/record";
import { Size2D } from "@/attributes/layout/size";

/** How an adapter picks the decode resolution and how strict it is about what it cannot load. `"exact"` (export, stills): the level follows the current draw alone, so a frame is the same whatever was drawn before on a reused adapter, and an undescribed font family is refused. `"interactive"` (preview): reuse any resident level that is good enough, upgrade in the background, and draw an undescribed family in the fallback face. */
export type DecodePolicy = "exact" | "interactive";

export abstract class StorageAdapter {
    protected catalog: AssetCatalog;
    protected viewport: Size2D;
    constructor(catalog: AssetCatalog, viewport: Size2D) {
        this.catalog = catalog;
        this.viewport = viewport;
    }

    /** Points the adapter at a different catalog, keeping its caches. Safe because the catalog supplies only *metadata* and caches are keyed by source URL: a dropped src leaves an orphaned decode, an added one isn't cached yet. The viewport has no such setter; changing output size rebuilds the adapter. */
    setCatalog(catalog: AssetCatalog): void {
        this.catalog = catalog;
    }
    /** Every asset src whose load is in flight, with its promise; the render path awaits these so no draw happens mid-load. */
    protected inFlightLoads = new Map<string, Promise<void>>();
    /** Keys of assets that have been fully loaded and are ready to use. */
    protected cachedAssets = new Set<string>();

    /** Whether `key` has finished loading and is usable now. */
    isLoaded(key: string): boolean {
        return this.cachedAssets.has(key);
    }

    async loadAsset(key: string, value: AssetRecord): Promise<void> {
        const existing = this.inFlightLoads.get(key);
        if (existing) return existing;
        if (this.cachedAssets.has(key)) return;

        const job = this.runLoad(key, value);
        this.inFlightLoads.set(key, job);
        try {
            await job;
        } finally {
            this.inFlightLoads.delete(key);
        }
    }

    private async runLoad(key: string, value: AssetRecord): Promise<void> {
        let loaded = true;
        switch (value.type) {
            case 'image':
                await this.loadImage(key);
                break;
            case 'video':
                await this.loadVideo(key, value.startFrame, value.endFrame, value.trimStart, value.trimEnd);
                break;
            case 'font': {
                const { fontFamily, fontWeight } = this.parseFontKey(key);
                loaded = await this.loadFont(key, fontFamily, fontWeight);
                if (!loaded && this.getDecodePolicy() === "exact") {
                    throw new AssetNotLoadedError(
                        "font",
                        fontFamily,
                        `The manifest has no font entry for "${fontFamily}", so this frame would be shaped against the fallback face and differ from the one drawn once it is described. Add the family to the manifest's font record.`,
                    );
                }
                break;
            }
            case 'audio':
                // Audio files load on demand via fetchAudioData / syncAudio, not loadAsset.
                break;
            case 'loader':
                // Loaders are opaque callbacks run directly by the AssetManager and
                // never dispatched through the storage adapter.
                throw new Error("Loader records must not be routed through StorageAdapter.loadAsset");
            default: {
                const _exhaustive: never = value;
                throw new Error(`Unsupported asset type: ${(_exhaustive as AssetRecord).type}`);
            }
        }

        // Only a load that happened is cached: caching an undescribable font family marked it handled for this adapter's life, so a manifest that later described it (installing a typeface) could never load it.
        if (loaded) this.cachedAssets.add(key);
    }

    protected parseFontKey(key: string): { fontFamily: string; fontWeight: number } {
        const [fontFamily, weightStr] = key.split('@');
        const fontWeight = weightStr ? parseInt(weightStr, 10) : 400;
        return {
            fontFamily: fontFamily || key,
            fontWeight: isNaN(fontWeight) ? 400 : fontWeight,
        };
    }

    /** Decode resolution follows the draw, so a load names only the source. */
    abstract loadImage(src: string): Promise<void>;
    abstract loadVideo(
        src: string,
        startFrame: number,
        endFrame: number,
        trimStart: number,
        trimEnd?: number,
    ): Promise<void>;
    abstract loadAudio(
        src: string,
        startFrame: number,
        endFrame: number,
        trimStart: number,
        trimEnd?: number,
    ): Promise<void>;
    abstract fetchAudioData(src: string): Promise<ArrayBuffer>;
    /** Registers every face of `fontFamily` the catalog describes; `false` means the manifest has no entry. Not an error while previewing (the platform fallback shapes it), but a blocking caller refuses it (see {@link DecodePolicy}), and it must not be remembered as handled either way (see {@link runLoad}). */
    abstract loadFont(src: string, fontFamily: string, fontWeight: number): Promise<boolean>;

    /** Decodes any exact media frames the last render needed but couldn't satisfy synchronously (a video frame at a freshly-seeked time) and reports whether there were any. A blocking caller renders, awaits this, and re-renders while it returns true. No-op by default. */
    async warmPendingVideo(): Promise<boolean> {
        return false;
    }

    setDecodePolicy(policy: DecodePolicy): void {
    }

    /** Read back so a caller that borrows the adapter can restore it. */
    getDecodePolicy(): DecodePolicy {
        return "interactive";
    }

    /** Whether the most recent render left decodes that {@link warmPendingDecodes} would settle. */
    hasPendingDecodes(): boolean {
        return false;
    }

    /** Settles what the last render could not draw acceptably under the current policy (video frames, every exact image level under `"exact"`, a source drawn with nothing resident under `"interactive"`); reports whether there was any. Defaults to {@link warmPendingVideo} so older adapters keep working. See `renderSettled`. */
    async warmPendingDecodes(): Promise<boolean> {
        return this.warmPendingVideo();
    }

    /** Whether an `"interactive"` decode is on its way that would draw the last render sharper. A paint doesn't wait for it; a preview repaints when {@link warmPendingUpgrades} reports a landing. */
    hasPendingUpgrades(): boolean {
        return false;
    }

    async warmPendingUpgrades(): Promise<boolean> {
        return false;
    }

    /** Whether playback is live: video prefetches ahead only while playing and quiesces on pause. No-op by default. */
    setPlaying(playing: boolean): void {
    }

    dispose(): void {
        this.inFlightLoads.clear();
        this.cachedAssets.clear();
    }
}
