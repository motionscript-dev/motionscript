import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { comp, node, project, still, track } from "./document.fixtures";
import { Registry, setTheme, type VisualDocument, type Theme } from "@motionscript/core";
import { component2d } from "@motionscript/core/sdk";
import { NothingToDrawError } from "../src/frame-loop";
import { createStillRenderer, type StillRenderer } from "../src/still";
import { createBrowserEngine } from "../src/engine";
import { snapshotPixels } from "./pixels.fixtures";

/**
 * The long-lived single-frame renderer.
 *
 * Two properties matter and neither is visible from the returned bytes, so they
 * are asserted structurally: that repeated renders **reuse one surface**
 * (the whole reason to hold a renderer rather than call `exportScreenshot` in a
 * loop), and that the renderer **applies its own theme** rather than leaving the
 * caller to remember the global `setTheme` — the failure mode there is silent,
 * a token resolving to nothing and the frame rendering with wrong colors.
 *
 * Private members are reached through `as any`, as the video-window suite does:
 * the surface identity is genuinely internal, and exporting it purely for a test
 * would be worse than reaching for it here.
 */

const VIEWPORT = { width: 64, height: 64 };
const RED: Theme = { colors: { brand: "#ff0000" } };

let renderer: StillRenderer;

beforeAll(async () => {
    // Warm the renderer once, so later creates are cheap.
    const warm = await createStillRenderer({ viewport: VIEWPORT });
    warm.dispose();
});

afterEach(() => {
    renderer?.dispose();
});

async function make(theme?: Theme, registry?: Registry): Promise<StillRenderer> {
    renderer = await createStillRenderer({ viewport: VIEWPORT, theme, registry });
    return renderer;
}

/** The GPU backend the context is currently drawing with. */
const surfaceOf = (r: StillRenderer) => (r as any).renderContext.backend;

/** Center pixel of the last drawn frame, as [r, g, b, a]. */
function centerPixel(r: StillRenderer): [number, number, number, number] {
    const snapshot = snapshotPixels((r as any).renderContext);
    const { pixels, width, height } = snapshot;
    const i = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

const fullBleed = (fill: string) => still(node("r", "rect", { width: "fill", height: "fill", fill }));

// Three frames at 60fps, red then green then blue. Stamps rather than a tween,
// because what is under test is frame *addressing*, and a stamp says "this frame
// is that colour" directly. The chain ends on the last stamp, so the explicit
// length gives blue a frame of its own.
const threeFrames = comp(
    [node("r", "rect", { width: "fill", height: "fill", fill: "#ff0000" })],
    [
        1 / 60, { target: "r", type: "set", args: { fill: "#00ff00" } },
        1 / 60, { target: "r", type: "set", args: { fill: "#0000ff" } },
    ],
    3 / 60,
);

/** A still whose only node cannot be constructed (its children builder throws), so its track fails to build. */
const broken = still(node("x", "broken"));
const brokenRegistry = () => new Registry().addNode("broken", component2d({
    key: "broken",
    children: () => {
        throw new Error("cannot build");
    },
}));

/** A red still whose track builds, with one node whose declaration throws. */
const halfDeclared = still(
    node("r", "rect", { width: "fill", height: "fill", fill: "#ff0000" }),
    node("u", "undeclarable", { width: 0, height: 0 }, null, 1),
);
const undeclarableRegistry = () => new Registry().addNode("undeclarable", component2d({
    key: "undeclarable",
    load: () => {
        throw new Error("cannot declare");
    },
}));

/** Decode encoded still bytes: their size and centre pixel. */
async function decode(bytes: Uint8Array): Promise<{ width: number; height: number; centre: number[] }> {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const centre = [...ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data];
    return { width: bitmap.width, height: bitmap.height, centre };
}

describe("StillRenderer", () => {
    it("renders a still document", async () => {
        const r = await make();
        const drawn = await r.render(fullBleed("#ff0000"));

        expect(drawn).toEqual({ frame: 0, totalFrames: 1 });
        expect(centerPixel(r)).toEqual([255, 0, 0, 255]);
    });

    it("reuses one surface across renders", async () => {
        const r = await make();
        await r.render(fullBleed("#ff0000"));
        const first = surfaceOf(r);

        await r.render(fullBleed("#00ff00"));

        expect(surfaceOf(r)).toBe(first);
        expect(centerPixel(r)).toEqual([0, 255, 0, 255]);
    });

    it("keeps that surface when the manifest is swapped", async () => {
        const r = await make();
        await r.render(fullBleed("#ff0000"));
        const first = surfaceOf(r);

        r.setManifest({ image: {}, video: {}, audio: {}, font: {} });
        await r.render(fullBleed("#ff0000"));

        expect(surfaceOf(r)).toBe(first);
    });

    it("rebuilds the surface when the viewport changes", async () => {
        const r = await make();
        await r.render(fullBleed("#ff0000"));
        const first = surfaceOf(r);

        r.setViewport({ width: 32, height: 32 });
        await r.render(fullBleed("#00ff00"));

        expect(surfaceOf(r)).not.toBe(first);
        expect(r.canvas.width).toBe(32);
        expect(snapshotPixels((r as any).renderContext).width).toBe(32);
        expect(centerPixel(r)).toEqual([0, 255, 0, 255]);
    });

    it("resolves theme tokens without the caller touching setTheme", async () => {
        // Clear the global registry first: if the renderer did not apply its own
        // theme, "brand" would resolve to nothing and this would not be red.
        setTheme(undefined);
        const r = await make(RED);

        await r.render(fullBleed("brand"));

        expect(centerPixel(r)).toEqual([255, 0, 0, 255]);
    });

    it("re-applies its theme after another caller replaced the global one", async () => {
        const r = await make(RED);
        await r.render(fullBleed("brand"));

        setTheme({ colors: { brand: "#0000ff" } });
        await r.render(fullBleed("brand"));

        expect(centerPixel(r)).toEqual([255, 0, 0, 255]);
    });

    it("refuses to encode before any frame has been drawn", async () => {
        const r = await make();

        await expect(r.toBytes()).rejects.toThrow("Nothing has been rendered yet.");
        expect(() => r.toDataURL()).toThrow("Nothing has been rendered yet.");

        await r.render(fullBleed("#ff0000"));
        expect((await r.toBytes()).length).toBeGreaterThan(0);

        // A new surface is blank until something is drawn onto it.
        r.setViewport({ width: 32, height: 32 });
        await expect(r.toBytes()).rejects.toThrow("Nothing has been rendered yet.");
    });

    it("encodes the drawn frame as a decodable PNG", async () => {
        const r = await make();
        await r.render(fullBleed("#ff0000"));

        const blob = await r.toBlob({ format: "png" });
        expect(blob.type).toBe("image/png");

        const bitmap = await createImageBitmap(blob);
        expect(bitmap.width).toBe(VIEWPORT.width);
        expect(bitmap.height).toBe(VIEWPORT.height);
    });

    it("addresses a frame by index, time or first/last", async () => {
        const r = await make();

        const last = await r.render(threeFrames, { frame: "last" });
        expect(last.totalFrames).toBe(3);
        expect(last.frame).toBe(2);
        expect(centerPixel(r)).toEqual([0, 0, 255, 255]);

        await r.render(threeFrames, { frame: "first" });
        expect(centerPixel(r)).toEqual([255, 0, 0, 255]);

        await r.render(threeFrames, { frame: 1 });
        expect(centerPixel(r)).toEqual([0, 255, 0, 255]);

        // fps defaults to 60, so 1/60s in is frame 1.
        await r.render(threeFrames, { time: 1 / 60 });
        expect(centerPixel(r)).toEqual([0, 255, 0, 255]);

        // A time that is a frame boundary up to float error is that frame.
        const second = await r.render(threeFrames, { time: 2 * (1 / 60) });
        expect(second.frame).toBe(2);
    });

    it("clamps a frame past the end to the last one", async () => {
        const r = await make();

        const drawn = await r.render(fullBleed("#0000ff"), { frame: 9999 });

        expect(drawn).toEqual({ frame: 0, totalFrames: 1 });
        expect(centerPixel(r)).toEqual([0, 0, 255, 255]);
    });

    it("reports the whole project's length whichever frame it draws", async () => {
        // Every span is declared, so the first frame knows where the last track
        // ends without building it — there is no measured prefix left for a
        // caller to mistake for the total.
        const r = await make();
        const solid = (id: string, fill: string, frame: number) =>
            track(id, fullBleed(fill), { startAt: frame / 60, duration: 1 / 60 });
        const threeTracks = project([solid("r", "#ff0000", 0), solid("g", "#00ff00", 1), solid("b", "#0000ff", 2)]);

        const first = await r.render(threeTracks, { frame: "first" });
        expect(first).toEqual({ frame: 0, totalFrames: 3 });
        expect(centerPixel(r)).toEqual([255, 0, 0, 255]);

        const last = await r.render(threeTracks, { frame: "last" });
        expect(last).toEqual({ frame: 2, totalFrames: 3 });
        expect(centerPixel(r)).toEqual([0, 0, 255, 255]);
    });

    it("refuses to draw after dispose", async () => {
        const r = await make();
        r.dispose();
        await expect(r.render(fullBleed("#ff0000"))).rejects.toThrow(/disposed/);
    });

    it("applies an explicit scale to that call only", async () => {
        const r = await make();

        await r.render(fullBleed("#ff0000"), { scale: 2 });
        expect((await decode(await r.toBytes())).width).toBe(VIEWPORT.width * 2);

        await r.render(fullBleed("#ff0000"));
        expect(r.scale).toBe(1);
        expect(r.canvas.width).toBe(VIEWPORT.width);
        expect((await decode(await r.toBytes())).width).toBe(VIEWPORT.width);
    });

    it("throws a NothingToDrawError for a frame whose every track failed to build", async () => {
        const r = await make(undefined, brokenRegistry());

        const thrown = await r.render(project([track("bad", broken)])).catch((error: unknown) => error);

        expect(thrown).toBeInstanceOf(NothingToDrawError);
        expect((thrown as NothingToDrawError).frame).toBe(0);
        expect((thrown as Error).message).toMatch(/^Frame 0 has nothing to draw — every track on it failed to build:\n {2}bad: .*cannot build/);
    });

    it("draws a track that built though one of its nodes failed to declare", async () => {
        const r = await make(undefined, undeclarableRegistry());

        await r.render(halfDeclared);

        expect(centerPixel(r)).toEqual([255, 0, 0, 255]);
    });
});

describe("session.image", () => {
    const opened: Array<{ dispose(): void }> = [];
    afterEach(() => {
        while (opened.length) opened.pop()!.dispose();
    });

    async function open(document: VisualDocument) {
        const engine = await createBrowserEngine({});
        const session = engine.open({ document, viewport: VIEWPORT, fps: 60 });
        opened.push(engine, session);
        return session;
    }

    it("gives each of several overlapping calls its own frame", async () => {
        const session = await open(threeFrames);

        const stills = await Promise.all([
            session.image({ frame: { kind: "first" } }),
            session.image({ frame: { kind: "frame", frame: 1 } }),
            session.image({ frame: { kind: "last" } }),
        ]);

        expect(stills.map((s) => s.frame)).toEqual([0, 1, 2]);
        const centres = await Promise.all(stills.map(async (s) => (await decode(s.bytes)).centre));
        expect(centres).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
    });

    it("draws at an explicit scale for that call only", async () => {
        const session = await open(fullBleed("#ff0000"));

        const doubled = await session.image({ scale: 2 });
        const plain = await session.image();

        expect((await decode(doubled.bytes)).width).toBe(VIEWPORT.width * 2);
        expect((await decode(plain.bytes)).width).toBe(VIEWPORT.width);
    });
});
