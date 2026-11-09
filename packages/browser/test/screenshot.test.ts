import { afterEach, describe, expect, it } from "vitest";
import { Registry, setTheme, type Theme } from "@motionscript/core";
import { component2d } from "@motionscript/core/sdk";
import { NothingToDrawError } from "../src/frame-loop";
import { comp, node, project, still, track } from "./document.fixtures";
import { exportScreenshot } from "../src/screenshot";

/**
 * `exportScreenshot`, the one-shot wrapper over `StillRenderer`: a
 * frame of a document as PNG or JPEG bytes, decoded back here to see what it
 * holds.
 */

const VIEWPORT = { width: 40, height: 30 };
const FPS = 10;
const RED: Theme = { colors: { brand: "#ff0000" } };

afterEach(() => setTheme(undefined));

const fullBleed = (fill: string) => still(node("r", "rect", { width: "fill", height: "fill", fill }));
/** Red, green, blue: one frame each. */
const threeFrames = comp(
    [node("r", "rect", { width: "fill", height: "fill", fill: "#ff0000" })],
    [
        1 / FPS, { target: "r", type: "set", args: { fill: "#00ff00" } },
        1 / FPS, { target: "r", type: "set", args: { fill: "#0000ff" } },
    ],
    3 / FPS,
);

async function decode(bytes: Uint8Array): Promise<{ width: number; height: number; centre: number[] }> {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, centre: [...ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data] };
}

const shoot = (document_: Parameters<typeof exportScreenshot>[0]["document"], over: Partial<Parameters<typeof exportScreenshot>[0]> = {}) =>
    exportScreenshot({ document: document_, viewport: VIEWPORT, fps: FPS, ...over });

describe("exportScreenshot", () => {
    it("is the first frame as a PNG by default, at the viewport's size", async () => {
        const shot = await shoot(fullBleed("#ff0000"));

        expect([...shot.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
        expect(await decode(shot.bytes)).toEqual({ ...VIEWPORT, centre: [255, 0, 0, 255] });
        expect(shot).toMatchObject({ frame: 0, totalFrames: 1 });
    });

    it("is a JPEG at the scale given when asked", async () => {
        const shot = await shoot(fullBleed("#ff0000"), { format: "jpeg", scale: 2 });

        expect([...shot.bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
        const decoded = await decode(shot.bytes);
        expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 80, height: 60 });
        expect(Math.abs(decoded.centre[0] - 255)).toBeLessThan(12);
    });

    it("takes a JPEG quality, 0.92 when none is given", async () => {
        // Noise, so the quality shows in the size.
        const noisy = project([track("t", still(...Array.from({ length: 30 }, (_, i) =>
            node(`n${i}`, "rect", { width: 6, height: 6, x: (i * 7) % 36 - 18, y: (i * 11) % 26 - 13, fill: `hsl(${i * 47}, 90%, 50%)` }, null, i))), { duration: 1 / FPS })]);

        const low = await shoot(noisy, { format: "jpeg", quality: 0.05 });
        const high = await shoot(noisy, { format: "jpeg", quality: 1 });
        const defaulted = await shoot(noisy, { format: "jpeg" });
        const explicit = await shoot(noisy, { format: "jpeg", quality: 0.92 });

        expect(high.bytes.length).toBeGreaterThan(low.bytes.length);
        expect(defaulted.bytes.length).toBe(explicit.bytes.length);
    });

    it("captures the frame it is told to, as an index, first or last, or a frame spec", async () => {
        const at = async (frame: Parameters<typeof exportScreenshot>[0]["frame"]) => {
            const shot = await shoot(threeFrames, { frame });
            return { frame: shot.frame, totalFrames: shot.totalFrames, centre: (await decode(shot.bytes)).centre };
        };

        expect(await at(undefined)).toEqual({ frame: 0, totalFrames: 3, centre: [255, 0, 0, 255] });
        expect(await at("first")).toEqual({ frame: 0, totalFrames: 3, centre: [255, 0, 0, 255] });
        expect(await at(1)).toEqual({ frame: 1, totalFrames: 3, centre: [0, 255, 0, 255] });
        expect(await at("last")).toEqual({ frame: 2, totalFrames: 3, centre: [0, 0, 255, 255] });
        expect(await at({ kind: "frame", frame: 1 })).toEqual({ frame: 1, totalFrames: 3, centre: [0, 255, 0, 255] });
        expect(await at({ kind: "last" })).toEqual({ frame: 2, totalFrames: 3, centre: [0, 0, 255, 255] });
    });

    it("clamps a frame past the end to the last", async () => {
        const shot = await shoot(threeFrames, { frame: 500 });

        expect(shot.frame).toBe(2);
    });

    it("lets the call's viewport and frame rate win over the document's own", async () => {
        const doc = { ...project([track("t", fullBleed("#ff0000"), { duration: 1 })], { viewport: { width: 100, height: 100 }, fps: 5 }) };

        const shot = await shoot(doc);

        const { width, height } = await decode(shot.bytes);
        expect({ width, height }).toEqual(VIEWPORT);
        // 1 s at 10 fps, not at the document's 5.
        expect(shot.totalFrames).toBe(10);
    });

    it("takes the document's own size and rate when the call gives none", async () => {
        const doc = project([track("t", fullBleed("#ff0000"), { duration: 1 })], { viewport: { width: 50, height: 20 }, fps: 5 });

        const shot = await exportScreenshot({ document: doc });

        const { width, height } = await decode(shot.bytes);
        expect({ width, height }).toEqual({ width: 50, height: 20 });
        expect(shot.totalFrames).toBe(5);
    });

    it("falls back to 1920×1080 at 60 fps when neither says", async () => {
        const shot = await exportScreenshot({ document: fullBleed("#ff0000") });

        const { width, height } = await decode(shot.bytes);
        expect({ width, height }).toEqual({ width: 1920, height: 1080 });
    });

    it("draws a themed document in its own colours, and a `theme` for one with none", async () => {
        setTheme({ colors: { brand: "#0000ff" } });

        const own = await shoot({ ...fullBleed("brand"), theme: RED } as never);
        const given = await shoot(fullBleed("brand"), { theme: RED });

        expect((await decode(own.bytes)).centre).toEqual([255, 0, 0, 255]);
        expect((await decode(given.bytes)).centre).toEqual([255, 0, 0, 255]);
    });

    it("throws for a project with no tracks, naming what it was asked for", async () => {
        await expect(shoot(project([], { fps: FPS, viewport: VIEWPORT }))).rejects.toThrow("The project has no tracks to screenshot.");
    });

    it("throws the still's own error for a frame whose every track failed to build", async () => {
        const broken = project([track("bad", still(node("x", "broken")), { duration: 1 / FPS })], { fps: FPS, viewport: VIEWPORT });
        const registry = new Registry().addNode("broken", component2d({
            key: "broken",
            children: () => { throw new Error("cannot build"); },
        }));

        await expect(shoot(broken, { registry })).rejects.toBeInstanceOf(NothingToDrawError);
    });

    it("leaves no canvas behind, whether it succeeded or threw", async () => {
        const before = document.body.querySelectorAll("canvas").length;

        await shoot(fullBleed("#ff0000"));
        await shoot(project([track("bad", still(node("x", "no-such-type")), { duration: 1 / FPS })], { fps: FPS, viewport: VIEWPORT })).catch(() => undefined);

        expect(document.body.querySelectorAll("canvas")).toHaveLength(before);
    });
});
