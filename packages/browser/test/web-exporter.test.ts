import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferSource, Input, MP4 } from "mediabunny";
import { Registry, setTheme, type ProjectDocument, type StillDocument } from "@motionscript/core";
import { node, project, still, track } from "./document.fixtures";
import { createBrowserEngine } from "../src/engine";

/**
 * The engine's exporter, driven through `session.export()` and `session.image()`
 * with the real encoders, and what disposing the engine and a
 * session lets go of. How a request maps onto `exportVideo` is in
 * `web-exporter-mapping.test.ts`.
 *
 * VP9 stands in for the default H.264 for the same reason `export-video.test.ts`
 * gives: every Chromium encodes it.
 */

const VIEWPORT = { width: 32, height: 32 };
const FPS = 10;
const VP9 = { video: { codec: "vp9" as const }, supersample: 1 };

const solid = (fill: string): StillDocument => still(node("r", "rect", { width: "fill", height: "fill", fill }));
const twoFrames = (fill: string): ProjectDocument => project([track("t", solid(fill), { duration: 2 / FPS })], { fps: FPS, viewport: VIEWPORT });

const cleanup: Array<() => void> = [];
afterEach(() => {
    setTheme(undefined);
    vi.restoreAllMocks();
    while (cleanup.length) cleanup.pop()!();
});

async function open(document: StillDocument | ProjectDocument, options: Parameters<typeof createBrowserEngine>[0] = {}) {
    const engine = await createBrowserEngine({ viewport: VIEWPORT, fps: FPS, ...options });
    const session = engine.open({ document, viewport: VIEWPORT, fps: FPS });
    cleanup.push(() => { session.dispose(); engine.dispose(); });
    return { engine, session };
}

/** The canvases the page holds now: an exporter's still renderer is the one thing here that adds one and keeps it. */
const canvases = (): HTMLCanvasElement[] => [...document.body.querySelectorAll("canvas")];

async function decodeCentre(bytes: Uint8Array): Promise<number[]> {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    return [...ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data];
}

describe("session.export()", () => {
    it("resolves to an MP4 of the timeline, unless the caller asks for a download", async () => {
        const { session } = await open(twoFrames("#ff0000"));
        const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { });

        const bytes = (await session.export({ encode: VP9 }))!;

        expect(bytes).toBeInstanceOf(Uint8Array);
        const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
        const video = await input.getPrimaryVideoTrack();
        expect(video).not.toBeNull();
        expect(video!.codec).toBe("vp9");
        expect(video!.displayWidth).toBe(VIEWPORT.width);
        expect(await input.getPrimaryAudioTrack()).toBeNull();
        expect(click).not.toHaveBeenCalled();
    });

    it("triggers a download and resolves to nothing on request", async () => {
        const { session } = await open(twoFrames("#ff0000"));
        const downloads: string[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            downloads.push(this.download);
        });

        const result = await session.export({ encode: { ...VP9, download: true, filename: "reel.mp4" } });

        expect(result).toBeUndefined();
        expect(downloads).toEqual(["reel.mp4"]);
    });

    it("encodes with the engine's video settings when the call gives none", async () => {
        const { session } = await open(twoFrames("#ff0000"), { video: { codec: "vp9" } });

        const bytes = (await session.export({ encode: { supersample: 1 } }))!;

        const video = await new Input({ source: new BufferSource(bytes), formats: [MP4] }).getPrimaryVideoTrack();
        expect(video!.codec).toBe("vp9");
    });

    it("exports the size the session was opened at, scaled by the request", async () => {
        const { session } = await open(twoFrames("#ff0000"));

        const bytes = (await session.export({ scale: 2, encode: VP9 }))!;

        const video = await new Input({ source: new BufferSource(bytes), formats: [MP4] }).getPrimaryVideoTrack();
        expect({ width: video!.displayWidth, height: video!.displayHeight }).toEqual({ width: 64, height: 64 });
    });

    it("resolves to nothing for a project with no tracks", async () => {
        const { session } = await open(project([], { fps: FPS, viewport: VIEWPORT }));

        expect(await session.export({ encode: VP9 })).toBeUndefined();
    });
});

describe("session.image()", () => {
    it("is the last frame as a PNG by default", async () => {
        const { session } = await open(solid("#00ff00"));

        const drawn = await session.image();

        expect(drawn).toMatchObject({ frame: 0, totalFrames: 1 });
        expect([...drawn.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
        expect(await decodeCentre(drawn.bytes)).toEqual([0, 255, 0, 255]);
    });

    it("is a JPEG when asked, at the quality given", async () => {
        const { session } = await open(solid("#00ff00"));

        const low = await session.image({ format: "jpeg", quality: 0.1 });
        const high = await session.image({ format: "jpeg", quality: 1 });

        expect([...low.bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
        expect(high.bytes.length).toBeGreaterThan(0);
    });

    it("names the frame by index, first or last, and reports the clamped one", async () => {
        const { session } = await open(project([
            track("a", solid("#ff0000"), { duration: 1 / FPS }),
            track("b", solid("#00ff00"), { startAt: 1 / FPS, duration: 1 / FPS }),
            track("c", solid("#0000ff"), { startAt: 2 / FPS, duration: 1 / FPS }),
        ], { fps: FPS, viewport: VIEWPORT }));

        const first = await session.image({ frame: { kind: "first" } });
        const middle = await session.image({ frame: { kind: "frame", frame: 1 } });
        const last = await session.image({ frame: { kind: "last" } });
        const beyond = await session.image({ frame: { kind: "frame", frame: 99 } });

        expect([first.frame, middle.frame, last.frame, beyond.frame]).toEqual([0, 1, 2, 2]);
        expect(first.totalFrames).toBe(3);
        expect(await decodeCentre(first.bytes)).toEqual([255, 0, 0, 255]);
        expect(await decodeCentre(middle.bytes)).toEqual([0, 255, 0, 255]);
        expect(await decodeCentre(last.bytes)).toEqual([0, 0, 255, 255]);
    });

    it("keeps one still renderer for every call, and it is the one canvas an engine adds", async () => {
        const before = canvases();
        const { session } = await open(solid("#00ff00"));

        await session.image();
        await session.image();
        await session.image({ scale: 2 });

        expect(canvases().filter((canvas) => !before.includes(canvas))).toHaveLength(1);
    });

    it("replaces the renderer when the request's registry is not the one it was built with", async () => {
        const { engine, session } = await open(solid("#00ff00"));
        await session.image();
        const first = canvases().at(-1)!;

        // A request that names another vocabulary cannot be drawn by a renderer compiled against this one.
        await engine.exporter.exportStill({
            project: session.document, registry: new Registry(), frame: { kind: "last" }, manifest: engine.manifest,
        });
        const second = canvases().at(-1)!;

        expect(second).not.toBe(first);
        expect(first.isConnected).toBe(false);
        expect(canvases().filter((canvas) => canvas === second)).toHaveLength(1);
    });

    it("refuses a project whose size and rate are not resolved, and carries on afterwards", async () => {
        const { engine, session } = await open(solid("#00ff00"));
        const unresolved: ProjectDocument = { kind: "project", name: "x", tracks: [] };

        await expect(engine.exporter.exportStill({
            project: unresolved, registry: engine.registry, frame: { kind: "first" },
        })).rejects.toThrow("exportStill takes a project whose fps and viewport are resolved");

        expect((await session.image()).totalFrames).toBe(1);
    });
});

describe("disposing", () => {
    it("engine.dispose() releases the still renderer and leaves open sessions alone", async () => {
        const before = canvases();
        const { engine, session } = await open(solid("#00ff00"));
        await session.image();
        expect(canvases().filter((canvas) => !before.includes(canvas))).toHaveLength(1);

        engine.dispose();

        expect(canvases().filter((canvas) => !before.includes(canvas))).toHaveLength(0);
        await expect(session.seekFrame(0)).resolves.not.toThrow();
    });

    it("engine.dispose() twice is safe", async () => {
        const { engine } = await open(solid("#00ff00"));

        engine.dispose();

        expect(() => engine.dispose()).not.toThrow();
    });

    it("session.dispose() closes the audio context its sink made, once", async () => {
        const engine = await createBrowserEngine({ viewport: VIEWPORT, fps: FPS });
        cleanup.push(() => engine.dispose());
        const close = vi.spyOn(AudioContext.prototype, "close");
        const session = engine.open({ document: solid("#00ff00"), viewport: VIEWPORT, fps: FPS });
        session.playback!.play();
        session.playback!.pause();

        session.dispose();

        // The ticker shares the sink's context and borrows it, so there is one to close, not two.
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("session.dispose() closes nothing when the session never played", async () => {
        const engine = await createBrowserEngine({ viewport: VIEWPORT, fps: FPS });
        cleanup.push(() => engine.dispose());
        const close = vi.spyOn(AudioContext.prototype, "close");
        const session = engine.open({ document: solid("#00ff00"), viewport: VIEWPORT, fps: FPS });

        session.dispose();

        expect(close).not.toHaveBeenCalled();
    });
});
