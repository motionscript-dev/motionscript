import { describe, expect, it } from "vitest";

import { StorageAdapter, type DecodePolicy } from "@/platform/storage-adapter";
import { AssetNotLoadedError } from "@/assets/errors";
import { AssetCatalog, ManifestAssetCatalog } from "@/assets/catalog";
import type { AssetManifest } from "@/assets/manifest";

const EMPTY: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };

function catalogWith(family: string): AssetCatalog {
    return new ManifestAssetCatalog({
        ...EMPTY,
        font: { [`${family}@400`]: { src: `${family}.woff2`, fontFamily: family, fontWeight: 400, sizeBytes: 0 } },
    });
}

/** Records what it was asked to load and reports fonts as loaded only when described. */
class RecordingAdapter extends StorageAdapter {
    readonly fontAttempts: string[] = [];

    constructor(catalog: AssetCatalog) {
        super(catalog, { width: 100, height: 100 });
    }

    async loadImage(): Promise<void> { }
    async loadVideo(): Promise<void> { }
    async loadAudio(): Promise<void> { }
    async fetchAudioData(): Promise<ArrayBuffer> { return new ArrayBuffer(0); }

    async loadFont(_key: string, fontFamily: string): Promise<boolean> {
        this.fontAttempts.push(fontFamily);
        return this.catalog.getFontFamilyMetas(fontFamily).length > 0;
    }

    fontRecord(family: string) {
        return { type: "font", src: family, fontFamily: family, fontWeight: 400, startFrame: 0, endFrame: 0 } as const;
    }
}

describe("StorageAdapter caching", () => {
    it("stops asking for a font once it has actually loaded", async () => {
        const adapter = new RecordingAdapter(catalogWith("Inter"));

        await adapter.loadAsset("Inter", adapter.fontRecord("Inter"));
        await adapter.loadAsset("Inter", adapter.fontRecord("Inter"));

        expect(adapter.fontAttempts).toEqual(["Inter"]);
    });

    it("keeps retrying a family the manifest cannot describe", async () => {
        // The bug this guards. Caching an undescribable family marked it handled
        // for the life of the adapter — so installing a typeface, which folds a
        // new face into the *live* manifest rather than rebuilding the
        // controller, could never load it. The text stayed in the fallback face
        // until something else tore the adapter down.
        const adapter = new RecordingAdapter(new ManifestAssetCatalog(EMPTY));

        await adapter.loadAsset("Lora", adapter.fontRecord("Lora"));
        await adapter.loadAsset("Lora", adapter.fontRecord("Lora"));

        expect(adapter.fontAttempts).toEqual(["Lora", "Lora"]);
    });

    it("loads a family that a later manifest describes", async () => {
        const adapter = new RecordingAdapter(new ManifestAssetCatalog(EMPTY));
        await adapter.loadAsset("Lora", adapter.fontRecord("Lora"));

        // What installing a typeface does.
        adapter.setCatalog(catalogWith("Lora"));
        await adapter.loadAsset("Lora", adapter.fontRecord("Lora"));

        // Asked twice, and the second attempt is the one that could succeed.
        expect(adapter.fontAttempts).toEqual(["Lora", "Lora"]);
        // And now it is remembered, so it isn't re-fetched every frame.
        await adapter.loadAsset("Lora", adapter.fontRecord("Lora"));
        expect(adapter.fontAttempts).toHaveLength(2);
    });
});

/** The policy a blocking caller — a still, an export, a screenshot — sets while it draws. */
class PolicyAdapter extends RecordingAdapter {
    private policy: DecodePolicy = "interactive";
    override setDecodePolicy(policy: DecodePolicy): void { this.policy = policy; }
    override getDecodePolicy(): DecodePolicy { return this.policy; }
}

describe("StorageAdapter font loading under the exact policy", () => {
    it("refuses a family the manifest cannot describe, rather than letting it shape against the fallback face", async () => {
        // A frame drawn in the fallback face is a different frame from the one the
        // same document draws once the family is described, so a blocking caller
        // cannot accept it: it would file, or encode, the wrong one.
        const adapter = new PolicyAdapter(new ManifestAssetCatalog(EMPTY));
        adapter.setDecodePolicy("exact");

        const load = adapter.loadAsset("Lora", adapter.fontRecord("Lora"));

        await expect(load).rejects.toBeInstanceOf(AssetNotLoadedError);
        await expect(load).rejects.toMatchObject({ assetType: "font", src: "Lora" });
        await expect(load).rejects.toThrow(/no font entry for "Lora"/);
    });

    it("remembers nothing of the refusal, so a manifest that later describes the family loads it", async () => {
        const adapter = new PolicyAdapter(new ManifestAssetCatalog(EMPTY));
        adapter.setDecodePolicy("exact");
        await expect(adapter.loadAsset("Lora", adapter.fontRecord("Lora"))).rejects.toThrow(AssetNotLoadedError);
        expect(adapter.isLoaded("Lora")).toBe(false);

        adapter.setCatalog(catalogWith("Lora"));
        await adapter.loadAsset("Lora", adapter.fontRecord("Lora"));

        expect(adapter.isLoaded("Lora")).toBe(true);
    });

    it("loads a described family as it always did", async () => {
        const adapter = new PolicyAdapter(catalogWith("Inter"));
        adapter.setDecodePolicy("exact");

        await adapter.loadAsset("Inter", adapter.fontRecord("Inter"));

        expect(adapter.isLoaded("Inter")).toBe(true);
    });

    it("leaves a preview alone: an undescribed family waits for its manifest, drawn in the fallback face meanwhile", async () => {
        const adapter = new PolicyAdapter(new ManifestAssetCatalog(EMPTY));

        await expect(adapter.loadAsset("Lora", adapter.fontRecord("Lora"))).resolves.toBeUndefined();

        expect(adapter.isLoaded("Lora")).toBe(false);
    });
});

/** An adapter that records the calls it dispatches and lets a test hold a load open. */
class DispatchAdapter extends StorageAdapter {
    readonly images: string[] = [];
    readonly videos: unknown[][] = [];
    readonly fonts: unknown[][] = [];
    readonly audioLoads: string[] = [];
    imageGate: Promise<void> = Promise.resolve();
    imageError: Error | null = null;

    constructor() {
        super(new ManifestAssetCatalog(EMPTY), { width: 100, height: 100 });
    }

    async loadImage(src: string): Promise<void> {
        this.images.push(src);
        await this.imageGate;
        if (this.imageError) throw this.imageError;
    }
    async loadVideo(...args: unknown[]): Promise<void> { this.videos.push(args); }
    async loadAudio(src: string): Promise<void> { this.audioLoads.push(src); }
    async fetchAudioData(): Promise<ArrayBuffer> { return new ArrayBuffer(0); }
    async loadFont(...args: unknown[]): Promise<boolean> { this.fonts.push(args); return true; }

    parse(key: string) { return this.parseFontKey(key); }
}

describe("StorageAdapter dispatch", () => {
    it("routes a video record to loadVideo with its window and trims", async () => {
        const adapter = new DispatchAdapter();
        await adapter.loadAsset("clip.mp4", { type: "video", src: "clip.mp4", startFrame: 5, endFrame: 20, trimStart: 1, trimEnd: 3 });
        expect(adapter.videos).toEqual([["clip.mp4", 5, 20, 1, 3]]);
        expect(adapter.isLoaded("clip.mp4")).toBe(true);
    });

    it("routes a font record to loadFont with the family and weight parsed from the key", async () => {
        const adapter = new DispatchAdapter();
        await adapter.loadAsset("Inter@700", { type: "font", src: "Inter@700", fontFamily: "Inter", fontWeight: 700, startFrame: 0, endFrame: 0 });
        expect(adapter.fonts).toEqual([["Inter@700", "Inter", 700]]);
    });

    it("throws for a loader record, which the manager runs itself, and caches nothing for it", async () => {
        const adapter = new DispatchAdapter();
        const record = { type: "loader", src: "grammar", startFrame: 0, endFrame: 0, load: async () => { } } as const;

        await expect(adapter.loadAsset("grammar", record)).rejects.toThrow("Loader records must not be routed through StorageAdapter.loadAsset");
        expect(adapter.isLoaded("grammar")).toBe(false);
        // The failed attempt is forgotten, so asking again fails the same way rather than hanging on it.
        await expect(adapter.loadAsset("grammar", record)).rejects.toThrow(/Loader records/);
    });

    it("treats an audio record as a no-op that still counts as loaded", async () => {
        const adapter = new DispatchAdapter();
        const record = { type: "audio", src: "song.mp3", startFrame: 0, endFrame: 9, trimStart: 0 } as never;

        await adapter.loadAsset("song.mp3", record);

        expect(adapter.audioLoads).toEqual([]);
        expect(adapter.images).toEqual([]);
        expect(adapter.isLoaded("song.mp3")).toBe(true);
    });

    it("throws for a record of a type it does not know", async () => {
        const adapter = new DispatchAdapter();
        await expect(adapter.loadAsset("x", { type: "hologram", src: "x" } as never)).rejects.toThrow("Unsupported asset type: hologram");
        expect(adapter.isLoaded("x")).toBe(false);
    });

    it("shares one load between concurrent requests for a key, and does not repeat it once loaded", async () => {
        const adapter = new DispatchAdapter();
        let release!: () => void;
        adapter.imageGate = new Promise<void>((resolve) => { release = resolve; });
        const record = { type: "image", src: "a.png", startFrame: 0, endFrame: 1 } as const;

        const first = adapter.loadAsset("a.png", record);
        const second = adapter.loadAsset("a.png", record);
        expect(adapter.isLoaded("a.png")).toBe(false);
        release();
        await Promise.all([first, second]);
        await adapter.loadAsset("a.png", record);

        expect(adapter.images).toEqual(["a.png"]);
        expect(adapter.isLoaded("a.png")).toBe(true);
    });

    it("forgets a load that failed, so the next request tries again and can succeed", async () => {
        const adapter = new DispatchAdapter();
        const record = { type: "image", src: "a.png", startFrame: 0, endFrame: 1 } as const;
        adapter.imageError = new Error("decode failed");

        await expect(adapter.loadAsset("a.png", record)).rejects.toThrow("decode failed");
        expect(adapter.isLoaded("a.png")).toBe(false);

        adapter.imageError = null;
        await adapter.loadAsset("a.png", record);
        expect(adapter.images).toEqual(["a.png", "a.png"]);
        expect(adapter.isLoaded("a.png")).toBe(true);
    });

    it("dispose forgets everything loaded", async () => {
        const adapter = new DispatchAdapter();
        const record = { type: "image", src: "a.png", startFrame: 0, endFrame: 1 } as const;
        await adapter.loadAsset("a.png", record);
        adapter.dispose();

        expect(adapter.isLoaded("a.png")).toBe(false);
        await adapter.loadAsset("a.png", record);
        expect(adapter.images).toEqual(["a.png", "a.png"]);
    });
});

describe("StorageAdapter font keys", () => {
    const adapter = new DispatchAdapter();

    it("reads family@weight", () => {
        expect(adapter.parse("Inter@700")).toEqual({ fontFamily: "Inter", fontWeight: 700 });
    });

    it("defaults the weight to 400 when absent or not a number", () => {
        expect(adapter.parse("Inter")).toEqual({ fontFamily: "Inter", fontWeight: 400 });
        expect(adapter.parse("Inter@")).toEqual({ fontFamily: "Inter", fontWeight: 400 });
        expect(adapter.parse("Inter@bold")).toEqual({ fontFamily: "Inter", fontWeight: 400 });
    });

    it("takes the whole key as the family when nothing precedes the @", () => {
        expect(adapter.parse("@700")).toEqual({ fontFamily: "@700", fontWeight: 700 });
    });

    it("ignores anything after a second @", () => {
        expect(adapter.parse("Inter@700@italic")).toEqual({ fontFamily: "Inter", fontWeight: 700 });
    });
});

describe("StorageAdapter defaults", () => {
    it("settles nothing: no pending decodes, no upgrades, nothing to warm", async () => {
        const adapter = new DispatchAdapter();
        expect(adapter.hasPendingDecodes()).toBe(false);
        expect(adapter.hasPendingUpgrades()).toBe(false);
        expect(await adapter.warmPendingVideo()).toBe(false);
        expect(await adapter.warmPendingDecodes()).toBe(false);
        expect(await adapter.warmPendingUpgrades()).toBe(false);
    });

    it("answers warmPendingDecodes through warmPendingVideo, so an adapter written against the older name keeps working", async () => {
        class Legacy extends DispatchAdapter {
            override async warmPendingVideo(): Promise<boolean> { return true; }
        }
        expect(await new Legacy().warmPendingDecodes()).toBe(true);
    });

    it("decodes interactively, and ignores a policy change it has no use for", () => {
        const adapter = new DispatchAdapter();
        expect(adapter.getDecodePolicy()).toBe("interactive");
        adapter.setDecodePolicy("exact");
        expect(adapter.getDecodePolicy()).toBe("interactive");
    });

    it("ignores setPlaying", () => {
        expect(() => new DispatchAdapter().setPlaying(true)).not.toThrow();
    });

    it("setCatalog keeps what is loaded", async () => {
        const adapter = new DispatchAdapter();
        await adapter.loadAsset("a.png", { type: "image", src: "a.png", startFrame: 0, endFrame: 1 });
        adapter.setCatalog(catalogWith("Inter"));
        expect(adapter.isLoaded("a.png")).toBe(true);
    });
});
