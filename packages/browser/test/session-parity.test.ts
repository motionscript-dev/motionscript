import { afterEach, describe, expect, it } from "vitest";
import { Fills, type AssetManifest, type ProjectDocument, type VisualDocument } from "@motionscript/core";
import interUrl from "../../e2e/fonts/inter/inter-regular.ttf?url";
import { comp, node, project, still, track } from "./document.fixtures";
import { createBrowserEngine } from "../src/engine";
import { snapshotPixels } from "./pixels.fixtures";

/**
 * A session's playback surface and `session.image()` show the same picture
 * (RULES.md IV): the preview draws through the playback controller
 * and the image through `drawFrameAt` on a renderer of its own, and a scene with
 * strokes, rotation, a gradient and text is where two separate paths would part.
 */

const VIEWPORT = { width: 96, height: 64 };
const FPS = 10;
const MANIFEST: AssetManifest = {
    image: {}, video: {}, audio: {},
    font: { "Inter@400": { fontFamily: "Inter", fontWeight: 400, src: interUrl, sizeBytes: 0 } },
};

const cleanup: Array<() => void> = [];
afterEach(() => {
    while (cleanup.length) cleanup.pop()!();
});

const scene = (): VisualDocument => still(
    node("bg", "rect", { width: "fill", height: "fill", fill: "#16202c" }),
    node("card", "rect", {
        width: 44, height: 26, x: -18, y: 8, rotation: 18, cornerRadius: 5, fill: "#ffcc00",
        stroke: { weight: 3, fill: "#101820" },
    }, null, 1),
    node("dot", "ellipse", { width: 22, height: 22, x: 26, y: -10, fill: Fills.linearGradient(["#ff0066", "#3300ff"]) }, null, 2),
    node("label", "text", { text: "Parity", fontFamily: "Inter", fontSize: 14, fill: "#ffffff", x: -6, y: -16, rotation: -8 }, null, 3),
);

async function pixelsOf(bytes: Uint8Array): Promise<Uint8ClampedArray> {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

async function open(document_: VisualDocument | ProjectDocument) {
    const canvas = document.createElement("canvas");
    canvas.width = VIEWPORT.width;
    canvas.height = VIEWPORT.height;
    canvas.style.display = "none";
    document.body.appendChild(canvas);
    const engine = await createBrowserEngine({ viewport: VIEWPORT, fps: FPS, manifest: MANIFEST });
    const session = engine.open({ document: document_, viewport: VIEWPORT, fps: FPS, target: canvas });
    cleanup.push(() => { session.dispose(); engine.dispose(); canvas.remove(); });
    return session;
}

function differing(a: ArrayLike<number>, b: ArrayLike<number>): number {
    expect(a.length).toBe(b.length);
    let count = 0;
    for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) count++;
    }
    return count;
}

describe("a session's surface and session.image()", () => {
    it("draw the same pixels for a scene with a stroke, a rotation, a gradient and text", async () => {
        const session = await open(scene());
        await session.seekFrame(0);

        const shot = snapshotPixels(session.surface);
        const image = await pixelsOf((await session.image({ frame: { kind: "frame", frame: 0 } })).bytes);

        expect({ width: shot.width, height: shot.height }).toEqual(VIEWPORT);
        expect(differing(shot.pixels, image)).toBe(0);
        // Not two blank surfaces agreeing: the scene's gold and its text are on both.
        const colours = new Set<string>();
        for (let i = 0; i < image.length; i += 4) colours.add(`${image[i]},${image[i + 1]},${image[i + 2]}`);
        expect(colours.size).toBeGreaterThan(20);
    });

    it("draw the same pixels at each frame of a timeline that moves", async () => {
        const moving = comp(
            [node("bg", "rect", { width: "fill", height: "fill", fill: "#16202c" }), node("box", "rect", { width: 24, height: 24, x: -30, fill: "#33ddaa", stroke: { weight: 2, fill: "#ffffff" } }, null, 1)] as never,
            [{ target: "box", args: { x: 30, rotation: 90 }, duration: 3 / FPS }],
        );
        const session = await open(moving);
        expect(session.totalFrames).toBe(3);

        for (const frame of [0, 1, 2]) {
            await session.seekFrame(frame);
            const shot = snapshotPixels(session.surface);
            const image = await pixelsOf((await session.image({ frame: { kind: "frame", frame } })).bytes);
            expect({ frame, differing: differing(shot.pixels, image) }).toEqual({ frame, differing: 0 });
        }
    });

    it("draw the frame a project's tracks stack to, in the same order", async () => {
        const stacked = project([
            track("back", still(node("bg", "rect", { width: "fill", height: "fill", fill: "#202020" })), { duration: 2 / FPS }),
            track("front", still(node("f", "rect", { width: 40, height: 40, rotation: 30, fill: "#ff3355", stroke: { weight: 4, fill: "#ffffff" } })), { duration: 2 / FPS }),
        ], { fps: FPS, viewport: VIEWPORT });
        const session = await open(stacked);
        await session.seekFrame(1);

        const shot = snapshotPixels(session.surface);
        const image = await pixelsOf((await session.image({ frame: { kind: "frame", frame: 1 } })).bytes);

        expect(differing(shot.pixels, image)).toBe(0);
    });
});
