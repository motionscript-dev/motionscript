import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetManifest, StillDocument } from "@motionscript/core";
import { node, still } from "./document.fixtures";
import { createBrowserEngine } from "../src/engine";
import { exportVideo } from "../src/exporter";

/**
 * How the engine's exporter hands `session.export()` to `exportVideo`.
 *
 * `exportVideo` is replaced by a recorder, because what is under test is the
 * request it is given: which field of core's `ExportVideoRequest` and of the
 * engine's own options lands in which parameter. The real encode is covered by
 * `export-video.test.ts` and, through the engine, by `web-exporter.test.ts`.
 */

vi.mock("../src/exporter", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/exporter")>();
    return { ...actual, exportVideo: vi.fn(async (params: { returnBytes?: boolean }) => (params.returnBytes ? new Uint8Array([1, 2, 3]) : undefined)) };
});

const MANIFEST: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };
const DOCUMENT: StillDocument = still(node("r", "rect", { width: 10, height: 10 }));
const VIEWPORT = { width: 64, height: 48 };

const cleanup: Array<() => void> = [];
afterEach(() => {
    vi.mocked(exportVideo).mockClear();
    while (cleanup.length) cleanup.pop()!();
});

async function open(options: Parameters<typeof createBrowserEngine>[0] = {}) {
    const engine = await createBrowserEngine({ viewport: VIEWPORT, fps: 10, ...options });
    const session = engine.open({ document: DOCUMENT });
    cleanup.push(() => { session.dispose(); engine.dispose(); });
    return { engine, session };
}

const lastCall = () => vi.mocked(exportVideo).mock.calls.at(-1)![0];

describe("session.export() through the engine's exporter", () => {
    it("maps the request onto exportVideo's parameters", async () => {
        const { engine, session } = await open({ manifest: MANIFEST });
        const onProgress = () => { };
        const controller = new AbortController();

        const result = await session.export({
            scale: 2,
            includeAudio: false,
            onProgress,
            signal: controller.signal,
            encode: { video: { bitrate: 1_000_000 }, audio: { sampleRate: 22050 }, supersample: 3, filename: "clip.mp4" },
        });

        expect(result).toEqual(new Uint8Array([1, 2, 3]));
        expect(lastCall()).toEqual({
            document: session.document,
            registry: engine.registry,
            scale: 2,
            manifest: MANIFEST,
            includeAudio: false,
            video: { bitrate: 1_000_000 },
            audio: { sampleRate: 22050 },
            supersample: 3,
            filename: "clip.mp4",
            returnBytes: true,
            onProgress,
            signal: controller.signal,
        });
    });

    it("gives the session's project, resolved to the size and rate it was opened at", async () => {
        const { session } = await open();

        await session.export();

        expect(lastCall().document).toMatchObject({ kind: "project", fps: 10, viewport: VIEWPORT });
    });

    it("resolves to bytes unless the caller asks for the download path", async () => {
        const { session } = await open();

        expect(await session.export()).toBeInstanceOf(Uint8Array);
        expect(lastCall().returnBytes).toBe(true);
        expect(await session.export({ encode: { download: false } })).toBeInstanceOf(Uint8Array);
        expect(lastCall().returnBytes).toBe(true);

        expect(await session.export({ encode: { download: true } })).toBeUndefined();
        expect(lastCall().returnBytes).toBe(false);
    });

    it("falls back to the engine's video and audio settings, and lets a call's own win", async () => {
        const { session } = await open({ video: { codec: "vp9", bitrate: 5 }, audio: { bitrate: 64_000 } });

        await session.export();
        expect(lastCall()).toMatchObject({ video: { codec: "vp9", bitrate: 5 }, audio: { bitrate: 64_000 } });

        await session.export({ encode: { video: { codec: "av1" } } });
        expect(lastCall()).toMatchObject({ video: { codec: "av1" }, audio: { bitrate: 64_000 } });

        await session.export({ encode: { audio: { bitrate: 96_000 } } });
        expect(lastCall()).toMatchObject({ video: { codec: "vp9", bitrate: 5 }, audio: { bitrate: 96_000 } });
    });

    it("takes the engine's manifest unless the call carries one", async () => {
        const { session } = await open({ manifest: MANIFEST });
        const other: AssetManifest = { ...MANIFEST, image: { "a.png": { src: "a.png", width: 1, height: 1, sizeBytes: 0 } } };

        await session.export();
        expect(lastCall().manifest).toBe(MANIFEST);

        await session.export({ manifest: other });
        expect(lastCall().manifest).toBe(other);
    });

    it("hands over an encode option it does not know, unchecked", async () => {
        const { session } = await open();

        await expect(session.export({ encode: { notAnOption: 1 } })).resolves.toBeInstanceOf(Uint8Array);
        expect(lastCall()).not.toHaveProperty("notAnOption");
    });

});
