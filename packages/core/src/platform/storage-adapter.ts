import { AssetCatalog } from "@/assets/catalog";
import { AssetNotLoadedError } from "@/assets/errors";
import { AssetRecord } from "@/assets/record";
import { Size2D } from "@/attributes/layout/size";

/**
 * How an adapter picks the resolution to decode media at, and how strict it is
 * about what it cannot load.
 *
 * `"exact"` — export, stills, screenshots: the level follows the current draw
 * alone, so a frame is the same pixels whatever was drawn before it on a reused
 * adapter, and a font family the manifest cannot describe is refused rather
 * than shaped against the fallback face. `"interactive"` — preview: reuse
 * whatever resident level is already good enough, and upgrade in the
 * background; an undescribed family draws in the fallback face until a manifest
 * describes it.
 */
export type DecodePolicy = "exact" | "interactive";

export abstract class StorageAdapter {
    protected catalog: AssetCatalog;
    protected viewport: Size2D;
    constructor(catalog: AssetCatalog, viewport: Size2D) {
        this.catalog = catalog;
        this.viewport = viewport;
    }

    /**
     * Point the adapter at a different asset catalog, keeping every decode it has
     * already cached.
     *
     * Safe because the catalog supplies *metadata* (durations, intrinsic sizes)
     * while the caches are keyed by source URL: a src the new catalog drops leaves
     * an orphaned decode, and a src it adds simply isn't cached yet. Neither is a
     * correctness problem, which is what lets a long-lived renderer take an
     * updated manifest without paying to re-decode everything still in use.
     *
     * The viewport has no such setter; a host that changes output size rebuilds
     * the adapter.
     */
    setCatalog(catalog: AssetCatalog): void {
        this.catalog = catalog;
    }
    /**
     * Every asset src whose loadXxx is currently in flight, mapped to its
     * pending promise. The render path awaits these to guarantee no draw
     * happens while a load is still resolving. Cleared on completion.
     */
    protected inFlightLoads = new Map<string, Promise<void>>();
    /** Keys of assets that have been fully loaded and are ready to use. */
    protected cachedAssets = new Set<string>();

    // ─── Asset loading dispatch ───────────────────────────────────────────────

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
                // Audio files are loaded on-demand via fetchAudioData / syncAudio, not through loadAsset.
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

        // Only a load that actually happened is cached. This matters for exactly
        // one case: a font family the manifest cannot describe. Caching it anyway
        // marked the family handled for the life of this adapter, so a manifest
        // that *later* described it — which is what installing a typeface does,
        // folded into the live manifest without rebuilding the controller — could
        // never load it, and the text stayed in the fallback face until something
        // else tore the adapter down.
        if (loaded) this.cachedAssets.add(key);
    }

    // ─── Font key parsing ─────────────────────────────────────────────────────

    protected parseFontKey(key: string): { fontFamily: string; fontWeight: number } {
        const [fontFamily, weightStr] = key.split('@');
        const fontWeight = weightStr ? parseInt(weightStr, 10) : 400;
        return {
            fontFamily: fontFamily || key,
            fontWeight: isNaN(fontWeight) ? 400 : fontWeight,
        };
    }

    // ─── Abstract load methods ────────────────────────────────────────────────

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
    /**
     * Register every face of `fontFamily` the catalog describes.
     *
     * Returns whether the family was actually loaded. `false` means the manifest
     * has no entry for it. Not an error while previewing (an undescribed family
     * shapes against the platform fallback, which is what a system font name
     * does), but a blocking caller refuses it — see {@link DecodePolicy} — and
     * it must not be remembered as handled either way: see the note in
     * {@link runLoad}.
     */
    abstract loadFont(src: string, fontFamily: string, fontWeight: number): Promise<boolean>;

    // ─── Frame warming ────────────────────────────────────────────────────────

    /**
     * Decode any exact media frames the most recent render asked for but couldn't
     * satisfy synchronously (e.g. a video frame at a freshly-seeked timestamp),
     * and report whether there were any. A blocking caller (seek / screenshot /
     * export) renders once, awaits this, and re-renders while it returns true so
     * the frame is accurate even on a cold jump. Defaults to a no-op for adapters
     * with no time-varying media.
     */
    async warmPendingVideo(): Promise<boolean> {
        return false;
    }

    setDecodePolicy(policy: DecodePolicy): void {
        // no-op for adapters that decode at one resolution
    }

    /** Read back so a caller that borrows the adapter can restore it. */
    getDecodePolicy(): DecodePolicy {
        return "interactive";
    }

    /** Whether the most recent render left decodes that {@link warmPendingDecodes} would settle. */
    hasPendingDecodes(): boolean {
        return false;
    }

    /**
     * Settle what the last render could not draw acceptably under the current
     * policy — video frames, every exact image level under `"exact"`, a source
     * drawn with nothing resident under `"interactive"` — and report whether there
     * was any. See `renderSettled`.
     *
     * Defaults to {@link warmPendingVideo} so an adapter written against it keeps
     * working; that alias goes away after one release.
     */
    async warmPendingDecodes(): Promise<boolean> {
        return this.warmPendingVideo();
    }

    /**
     * Whether an `"interactive"` decode is on its way that would draw the last
     * render sharper. Not something a paint waits for: a preview shows what is
     * resident and repaints when {@link warmPendingUpgrades} reports a landing.
     */
    hasPendingUpgrades(): boolean {
        return false;
    }

    /** Await the upgrades {@link hasPendingUpgrades} reports; whether one landed. */
    async warmPendingUpgrades(): Promise<boolean> {
        return false;
    }

    /**
     * Notify the adapter whether playback is live. Time-varying media (video) uses
     * this to prefetch ahead only while playing and to quiesce on pause, so a
     * paused timeline doesn't drain a backlog of stale decodes. No-op by default.
     */
    setPlaying(playing: boolean): void {
        // no-op for adapters with no time-varying media
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    dispose(): void {
        this.inFlightLoads.clear();
        this.cachedAssets.clear();
    }
}
