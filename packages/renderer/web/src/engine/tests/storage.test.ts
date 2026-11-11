import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetCatalog } from "@motionscript/core";
import { WgpuStorageAdapter } from "../storage";

/** A request held open until `release`, so a test can ask twice while it is out. */
function gatedLoader() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const load = vi.fn(async (src: string) => {
        await gate;
        return new Blob([src]);
    });
    return { load, release };
}

const catalog = {
    getFontFamilyMetas: (family: string) =>
        family === "Inter" ? [{ src: "inter-400.ttf" }, { src: "inter-700.ttf" }] : [],
    getImageMeta: (src: string) => ({ src: `https://cdn.test/${src}` }),
} as unknown as AssetCatalog;

const adapter = (load: (src: string) => Promise<Blob>) => new WgpuStorageAdapter(catalog, { width: 100, height: 100 }, 30, load);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("an asset asked for while it is still loading", () => {
    it("loads a font family once though each weight asks under its own key", async () => {
        const { load, release } = gatedLoader();
        const store = adapter(load);
        const heard = vi.fn();
        store.onFont(heard);

        const regular = store.loadAsset("Inter@400", { type: "font" } as never);
        const bold = store.loadAsset("Inter@700", { type: "font" } as never);
        release();
        await Promise.all([regular, bold]);

        expect(load.mock.calls.map(([src]) => src).sort()).toEqual(["inter-400.ttf", "inter-700.ttf"]);
        expect(heard).toHaveBeenCalledTimes(2);
        expect(store.fonts).toHaveLength(2);
    });

    it("shares one download between adapters (a session and the thumbnail session)", async () => {
        const { load, release } = gatedLoader();
        const first = adapter(load).loadFont("Inter@400", "Inter");
        const second = adapter(load).loadFont("Inter@400", "Inter");
        release();
        await Promise.all([first, second]);

        expect(load).toHaveBeenCalledTimes(2);
    });

    it("decodes an image once when two draws ask for it together", async () => {
        const { load, release } = gatedLoader();
        const decode = vi.fn(async () => ({ width: 4, height: 2, close() {} }));
        vi.stubGlobal("createImageBitmap", decode);
        const store = adapter(load);

        const a = store.loadImage("cat.png");
        const b = store.loadImage("./cat.png");
        release();
        await Promise.all([a, b]);

        expect(load).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledWith("https://cdn.test/cat.png");
        expect(decode).toHaveBeenCalledTimes(1);
        expect(store.images.get("cat.png")).toMatchObject({ width: 4, height: 2 });
    });

    it("tries again after a failed load", async () => {
        const load = vi
            .fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValue(new Blob(["bytes"]));
        const store = adapter(load);

        await expect(store.loadFont("Inter@400", "Inter")).rejects.toThrow("offline");
        expect(await store.loadFont("Inter@400", "Inter")).toBe(true);
    });
});
