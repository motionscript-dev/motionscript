import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAssetBytes, localAssetBytes, setAssetByteSource } from "../src/asset-bytes";

/**
 * The byte source is consulted, and a miss changes nothing.
 *
 * Both halves matter. Without the first, a host that already holds an asset's
 * bytes downloads them anyway. Without the second, a host whose local store is
 * empty — or broken, or a private window — would fail every load instead of
 * behaving exactly as it did before this seam existed.
 */

afterEach(() => {
    setAssetByteSource(null);
});

describe("localAssetBytes", () => {
    it("answers null when no source is installed", async () => {
        expect(await localAssetBytes("https://example.test/a.webp")).toBeNull();
    });

    it("hands back what the source returns, by source URL", async () => {
        const blob = new Blob(["bytes"]);
        const source = vi.fn(async (src: string) =>
            src === "https://example.test/a.webp" ? blob : null,
        );
        setAssetByteSource(source);

        expect(await localAssetBytes("https://example.test/a.webp")).toBe(blob);
        expect(await localAssetBytes("https://example.test/b.webp")).toBeNull();
        // The key is the manifest key, unchanged — nothing here rewrites a src.
        expect(source).toHaveBeenCalledWith("https://example.test/a.webp");
    });

    it("treats a throwing source as a miss, not a failure", async () => {
        setAssetByteSource(async () => {
            throw new Error("IndexedDB unavailable");
        });

        // The adapter falls through to `fetch`, which is what it would have
        // done had the source never been installed. A host's local store
        // failing must not fail a render.
        expect(await localAssetBytes("https://example.test/a.webp")).toBeNull();
    });

    it("replaces rather than stacks, so two sources cannot disagree", async () => {
        const first = new Blob(["first"]);
        const second = new Blob(["second"]);
        setAssetByteSource(async () => first);
        setAssetByteSource(async () => second);

        expect(await localAssetBytes("https://example.test/a.webp")).toBe(second);
    });

    it("goes back to the network when cleared", async () => {
        setAssetByteSource(async () => new Blob(["bytes"]));
        setAssetByteSource(null);

        expect(await localAssetBytes("https://example.test/a.webp")).toBeNull();
    });
});

describe("loadAssetBytes", () => {
    it("joins a load already out for the same source instead of fetching again", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const fetchMock = vi.fn(async () => {
            await gate;
            return new Response("bytes");
        });
        vi.stubGlobal("fetch", fetchMock);

        const a = loadAssetBytes("https://example.test/font.ttf");
        const b = loadAssetBytes("https://example.test/font.ttf");
        const c = loadAssetBytes("https://example.test/other.ttf");
        release();

        expect(await a).toBe(await b);
        await c;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("asks again once the first load has finished, so new bytes at a source are seen", async () => {
        const fetchMock = vi.fn(async () => new Response("bytes"));
        vi.stubGlobal("fetch", fetchMock);

        await loadAssetBytes("https://example.test/a.webp");
        await loadAssetBytes("https://example.test/a.webp");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("lets a failed load be retried", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response("", { status: 500 }))
            .mockResolvedValueOnce(new Response("bytes"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(loadAssetBytes("https://example.test/a.webp")).rejects.toThrow(/HTTP 500/);
        expect(await (await loadAssetBytes("https://example.test/a.webp")).text()).toBe("bytes");
    });

    it("joins a load the host byte source is answering", async () => {
        const source = vi.fn(async () => new Blob(["local"]));
        setAssetByteSource(source);

        const [a, b] = await Promise.all([loadAssetBytes("blob-key"), loadAssetBytes("blob-key")]);
        expect(a).toBe(b);
        expect(source).toHaveBeenCalledTimes(1);
    });
});
