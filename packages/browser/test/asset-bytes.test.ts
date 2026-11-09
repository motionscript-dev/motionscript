import { afterEach, describe, expect, it, vi } from "vitest";
import { localAssetBytes, setAssetByteSource } from "../src/asset-bytes";

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
