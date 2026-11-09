import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setTheme, type Theme } from "@motionscript/core";
import { node, project, still, track } from "./document.fixtures";
import { createStillRenderer, stillFrameSpec, type StillRenderer } from "../src/still";
import { snapshotPixels } from "./pixels.fixtures";

/**
 * `StillRenderer`'s encode, frame addressing, gap frames, canvas ownership and
 * the precedence between its own settings and a document's.
 * `still-renderer.test.ts` covers rendering, reuse of the surface, theming,
 * scale and the engine's `session.image`.
 */

const VIEWPORT = { width: 40, height: 30 };
const RED: Theme = { colors: { brand: "#ff0000" } };

beforeAll(async () => {
    (await createStillRenderer({ viewport: VIEWPORT })).dispose();
});

const made: StillRenderer[] = [];
afterEach(() => {
    setTheme(undefined);
    vi.restoreAllMocks();
    while (made.length) made.pop()!.dispose();
});

async function make(options: Parameters<typeof createStillRenderer>[0] = {}): Promise<StillRenderer> {
    const renderer = await createStillRenderer({ viewport: VIEWPORT, ...options });
    made.push(renderer);
    return renderer;
}

const fullBleed = (fill: string) => still(node("r", "rect", { width: "fill", height: "fill", fill }));

async function decode(source: Blob | Uint8Array | string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
    const blob = typeof source === "string" ? await (await fetch(source)).blob() : source instanceof Blob ? source : new Blob([source as BlobPart]);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

describe("encoding", () => {
    it("is a PNG by default, and a JPEG when asked", async () => {
        const renderer = await make();
        await renderer.render(fullBleed("#ff0000"));

        const png = await renderer.toBlob();
        const jpeg = await renderer.toBlob({ format: "jpeg" });

        expect(png.type).toBe("image/png");
        expect(jpeg.type).toBe("image/jpeg");
        expect([...(await renderer.toBytes()).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
        expect([...(await renderer.toBytes({ format: "jpeg" })).slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    });

    it("takes a JPEG quality, and ignores it for a PNG", async () => {
        const renderer = await make();
        await renderer.render(project([track("t", still(...Array.from({ length: 24 }, (_, i) =>
            node(`n${i}`, "rect", { width: 5, height: 5, x: (i * 7) % 30 - 15, y: (i * 11) % 22 - 11, fill: `hsl(${i * 61}, 90%, 50%)` }, null, i))))]));

        const low = await renderer.toBytes({ format: "jpeg", quality: 0.05 });
        const high = await renderer.toBytes({ format: "jpeg", quality: 1 });
        expect(high.length).toBeGreaterThan(low.length);

        const pngLow = await renderer.toBytes({ format: "png", quality: 0.05 });
        const pngHigh = await renderer.toBytes({ format: "png", quality: 1 });
        expect(pngLow).toEqual(pngHigh);
    });

    it("is a data URL from toDataURL, in the format asked for", async () => {
        const renderer = await make();
        await renderer.render(fullBleed("#00ff00"));

        const png = renderer.toDataURL();
        const jpeg = renderer.toDataURL({ format: "jpeg", quality: 0.5 });

        expect(png).toMatch(/^data:image\/png;base64,/);
        expect(jpeg).toMatch(/^data:image\/jpeg;base64,/);
        const decoded = await decode(png);
        expect([...decoded.data.slice(0, 4)]).toEqual([0, 255, 0, 255]);
    });

    it("rejects when the browser yields no blob, and from toBytes too", async () => {
        const renderer = await make();
        await renderer.render(fullBleed("#00ff00"));
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));

        await expect(renderer.toBlob()).rejects.toThrow("Still encode produced no data.");
        await expect(renderer.toBytes()).rejects.toThrow("Still encode produced no data.");
    });

    it("throws when no 2D canvas can be made to encode through", async () => {
        const renderer = await make();
        await renderer.render(fullBleed("#00ff00"));
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

        expect(() => renderer.toDataURL()).toThrow("Still encode: could not read the surface into a 2d canvas.");
    });

    it("encodes the frame on the surface now, not the one it last encoded", async () => {
        const renderer = await make();
        await renderer.render(fullBleed("#ff0000"));
        const first = await decode(await renderer.toBytes());

        await renderer.render(fullBleed("#0000ff"));
        const second = await decode(await renderer.toBytes());

        expect([...first.data.slice(0, 3)]).toEqual([255, 0, 0]);
        expect([...second.data.slice(0, 3)]).toEqual([0, 0, 255]);
    });
});

describe("naming a frame", () => {
    it("takes the time over the frame, converting with the fps", () => {
        expect(stillFrameSpec({ time: 0.5, frame: 3 }, 10)).toEqual({ kind: "frame", frame: 5 });
        expect(stillFrameSpec({ time: 0.5 }, 24)).toEqual({ kind: "frame", frame: 12 });
    });

    it("rounds a time to the nearest whole frame", () => {
        expect(stillFrameSpec({ time: 0.26 }, 10)).toEqual({ kind: "frame", frame: 3 });
        expect(stillFrameSpec({ time: 0.24 }, 10)).toEqual({ kind: "frame", frame: 2 });
        expect(stillFrameSpec({ time: 0.3 }, 10)).toEqual({ kind: "frame", frame: 3 });
    });

    it("passes first, last and a frame spec straight through, and defaults to the first frame", () => {
        expect(stillFrameSpec(undefined, 10)).toEqual({ kind: "first" });
        expect(stillFrameSpec({}, 10)).toEqual({ kind: "first" });
        expect(stillFrameSpec({ frame: "first" }, 10)).toEqual({ kind: "first" });
        expect(stillFrameSpec({ frame: "last" }, 10)).toEqual({ kind: "last" });
        expect(stillFrameSpec({ frame: 7 }, 10)).toEqual({ kind: "frame", frame: 7 });
        const spec = { kind: "frame", frame: 4 } as const;
        expect(stillFrameSpec({ frame: spec }, 10)).toBe(spec);
        expect(stillFrameSpec({ frame: { kind: "last" } }, 10)).toEqual({ kind: "last" });
    });

    it("hands a negative or non-numeric frame on as it is, for the draw to clamp", () => {
        expect(stillFrameSpec({ frame: -3 }, 10)).toEqual({ kind: "frame", frame: -3 });
        expect(stillFrameSpec({ frame: NaN }, 10)).toEqual({ kind: "frame", frame: NaN });
    });

    it("maps a negative time to a negative frame and a NaN time to NaN", () => {
        expect(stillFrameSpec({ time: -0.5 }, 10)).toEqual({ kind: "frame", frame: -5 });
        expect(stillFrameSpec({ time: NaN }, 10)).toEqual({ kind: "frame", frame: NaN });
    });

    it("clamps a negative frame to the first when drawing", async () => {
        const renderer = await make();
        const doc = project([
            track("a", fullBleed("#ff0000"), { duration: 1 / 60 }),
            track("b", fullBleed("#00ff00"), { startAt: 1 / 60, duration: 1 / 60 }),
        ]);

        const drawn = await renderer.render(doc, { frame: -4 });

        expect(drawn.frame).toBe(0);
    });
});

describe("a frame with nothing on it", () => {
    // Frame 0 is before the only track starts.
    const gap = project([track("late", fullBleed("#ff0000"), { startAt: 3 / 10, duration: 1 / 10 })], { fps: 10 });

    it("is opaque black on the surface", async () => {
        const renderer = await make({ fps: 10 });
        await renderer.render(gap, { frame: 0 });

        const { pixels } = snapshotPixels((renderer as unknown as { renderContext: unknown }).renderContext);

        expect([...pixels.slice(0, 4)]).toEqual([0, 0, 0, 255]);
        const middle = ((VIEWPORT.height >> 1) * VIEWPORT.width + (VIEWPORT.width >> 1)) * 4;
        expect([...pixels.slice(middle, middle + 4)]).toEqual([0, 0, 0, 255]);
    });

    it("encodes to a PNG with no pixel below full alpha", async () => {
        const renderer = await make({ fps: 10 });
        await renderer.render(gap, { frame: 0 });

        const { data } = await decode(await renderer.toBytes());

        for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 255) throw new Error(`pixel ${(i - 3) / 4} has alpha ${data[i]}`);
        }
        expect([...data.slice(0, 3)]).toEqual([0, 0, 0]);
    });

    it("keeps a translucent fill opaque once encoded, over black", async () => {
        const renderer = await make();
        await renderer.render(fullBleed("#ff000080"));

        const { data } = await decode(await renderer.toBytes());

        expect(data[3]).toBe(255);
        expect(data[0]).toBeGreaterThan(100);
        expect(data[0]).toBeLessThan(160);
    });
});

describe("canvas ownership", () => {
    it("hides a canvas it made, appends it to the page and removes it on dispose", async () => {
        const before = document.body.querySelectorAll("canvas").length;

        const renderer = await make();

        expect(renderer.canvas.isConnected).toBe(true);
        expect(renderer.canvas.style.display).toBe("none");
        expect(document.body.querySelectorAll("canvas")).toHaveLength(before + 1);

        renderer.dispose();
        expect(renderer.canvas.isConnected).toBe(false);
        expect(document.body.querySelectorAll("canvas")).toHaveLength(before);
    });

    it("draws into a host's canvas, sizes it to the viewport at the scale, and leaves it in place on dispose", async () => {
        const host = document.createElement("canvas");
        host.width = 3;
        host.height = 3;
        document.body.appendChild(host);

        try {
            const renderer = await make({ canvas: host, scale: 2 });

            expect(renderer.canvas).toBe(host);
            expect({ width: host.width, height: host.height }).toEqual({ width: 80, height: 60 });
            expect(host.style.display).not.toBe("none");

            renderer.dispose();
            expect(host.isConnected).toBe(true);
        } finally {
            host.remove();
        }
    });

    it("is resized again for a call's own scale and for a new viewport", async () => {
        const host = document.createElement("canvas");
        document.body.appendChild(host);
        try {
            const renderer = await make({ canvas: host });
            await renderer.render(fullBleed("#ff0000"), { scale: 3 });
            expect({ width: host.width, height: host.height }).toEqual({ width: 120, height: 90 });

            renderer.setViewport({ width: 10, height: 10 });
            expect({ width: host.width, height: host.height }).toEqual({ width: 10, height: 10 });
        } finally {
            host.remove();
        }
    });

    it("disposes twice without error, and refuses every guarded method after", async () => {
        const renderer = await make();
        await renderer.render(fullBleed("#ff0000"));

        renderer.dispose();
        expect(() => renderer.dispose()).not.toThrow();

        await expect(renderer.render(fullBleed("#ff0000"))).rejects.toThrow(/disposed/);
        expect(() => renderer.setManifest({ image: {}, video: {}, audio: {}, font: {} })).toThrow(/disposed/);
        expect(() => renderer.setViewport({ width: 1, height: 1 })).toThrow(/disposed/);
        // `toBlob` reads the surface before it returns its promise, so it throws instead of rejecting.
        expect(() => renderer.toBlob()).toThrow(/disposed/);
        expect(() => renderer.toDataURL()).toThrow(/disposed/);
        await expect(renderer.toBytes()).rejects.toThrow(/disposed/);
    });

    it("lets a theme be set on a disposed renderer, since nothing is drawn with it", async () => {
        const renderer = await make();
        renderer.dispose();

        expect(() => renderer.setTheme(RED)).not.toThrow();
    });
});

describe("precedence between the renderer and a document", () => {
    it("draws at the renderer's viewport whatever size the document asks for", async () => {
        const renderer = await make();
        const doc = project([track("t", fullBleed("#ff0000"))], { viewport: { width: 500, height: 400 } });

        await renderer.render(doc);

        const { width, height } = await decode(await renderer.toBlob());
        expect({ width, height }).toEqual(VIEWPORT);
        expect(renderer.viewport).toEqual(VIEWPORT);
    });

    it("takes the document's frame rate over its own, and uses its own for a document with none", async () => {
        const renderer = await make({ fps: 30 });
        const own = project([track("t", fullBleed("#ff0000"), { duration: 1 })], { fps: 10 });
        const bare = project([track("t", fullBleed("#ff0000"), { duration: 1 })]);

        expect((await renderer.render(own, { time: 0.5 })).frame).toBe(5);
        expect((await renderer.render(bare, { time: 0.5 })).frame).toBe(15);
        expect(renderer.fps).toBe(30);
    });

    it("falls back to 60 fps and 1920×1080 when it is given neither", async () => {
        const renderer = await createStillRenderer({});
        made.push(renderer);

        expect(renderer.fps).toBe(60);
        expect(renderer.viewport).toEqual({ width: 1920, height: 1080 });
        expect(renderer.scale).toBe(1);
    });

    it("does nothing for a viewport of the size it already has", async () => {
        const renderer = await make();
        await renderer.render(fullBleed("#ff0000"));
        const surface = (renderer as unknown as { renderContext: { surface: unknown } }).renderContext.surface;

        renderer.setViewport({ ...VIEWPORT });
        await renderer.render(fullBleed("#ff0000"));

        expect((renderer as unknown as { renderContext: { surface: unknown } }).renderContext.surface).toBe(surface);
    });

    it("applies the theme it was given, replaces it, and draws without one when cleared", async () => {
        setTheme(undefined);
        const renderer = await make({ theme: RED });

        await renderer.render(fullBleed("brand"));
        expect([...(await decode(await renderer.toBytes())).data.slice(0, 3)]).toEqual([255, 0, 0]);

        renderer.setTheme({ colors: { brand: "#00ff00" } });
        await renderer.render(fullBleed("brand"));
        expect([...(await decode(await renderer.toBytes())).data.slice(0, 3)]).toEqual([0, 255, 0]);
    });
});
