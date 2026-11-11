import { afterEach, describe, expect, it } from "vitest";
import { Fills, type AssetManifest, type CompositionDocument, type ProjectDocument } from "@motionscript/core";
import { comp, node, project, track } from "./document.fixtures";
import { createBrowserEngine } from "../src/engine";
import { snapshotPixels } from "./pixels.fixtures";

/**
 * A 3D scene's textures follow it from frame to frame. A frame's image ids
 * are given out in the order it meets them, so when a second gradient plane
 * enters, the scene's own id moves on and its old one becomes a surface: the
 * renderer has to drop the scene that id held, or it goes on drawing the scene
 * into the plane's texture (a plane showing a picture of the whole scene).
 */

const VIEWPORT = { width: 96, height: 64 };
const FPS = 10;
const MANIFEST: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };

const cleanup: Array<() => void> = [];
afterEach(() => {
    while (cleanup.length) cleanup.pop()!();
});

function planes(): CompositionDocument {
    const plane = (id: string, x: number, colors: string[], startAt = 0) => ({
        ...node(id, "plane3d", { width: 1, height: 1, x, fill: Fills.linearGradient(colors) }, "view"),
        startAt,
    });
    return comp(
        [
            node("bg", "rect", { width: "fill", height: "fill", fill: "#101418" }),
            node("view", "canvas3d", { width: "fill", height: "fill", fill: [], orbit: 90, elevation: 0, zoom: 2.4, tone: "none" }, null, 1),
            plane("late", -0.6, ["#ff0066", "#ffcc00"], 1 / FPS),
            plane("early", 0.6, ["#00ccff", "#3300ff"]),
        ] as never,
        [],
        3 / FPS,
    );
}

async function pixelsOf(bytes: Uint8Array): Promise<Uint8ClampedArray> {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

/** Two scenes in a row: one with two textured planes, one with a plain box. */
function twoScenes(): ProjectDocument {
    const textured = planes();
    const plain = comp(
        [
            node("bg2", "rect", { width: "fill", height: "fill", fill: "#181018" }),
            node("view2", "canvas3d", { width: "fill", height: "fill", fill: [], orbit: 60, elevation: 20, zoom: 4, tone: "none" }, null, 1),
            node("box", "box3d", { width: 1, height: 1, depth: 1, fill: "#33ddaa" }, "view2"),
        ] as never,
        [],
        3 / FPS,
    );
    return project(
        [track("textured", textured, { duration: 3 / FPS }), track("plain", plain, { startAt: 3 / FPS, duration: 3 / FPS })],
        { fps: FPS, viewport: VIEWPORT },
    );
}

async function open(document_: CompositionDocument | ProjectDocument) {
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

/** Pixels where the session's surface and a fresh render of `frame` disagree. */
async function drift(session: Awaited<ReturnType<typeof open>>, frame: number): Promise<number> {
    const played = snapshotPixels(session.surface).pixels;
    const fresh = await pixelsOf((await session.image({ frame: { kind: "frame", frame } })).bytes);
    let differing = 0;
    for (let i = 0; i < fresh.length; i += 4) {
        const d = Math.abs(played[i] - fresh[i]) + Math.abs(played[i + 1] - fresh[i + 1]) + Math.abs(played[i + 2] - fresh[i + 2]);
        if (d > 6) differing++;
    }
    return differing;
}

describe("a 3D scene's surface textures", () => {
    it("stay their own when another enters and the scene's image id moves", async () => {
        const session = await open(planes());
        // Frame 0 holds one plane, frame 2 both: played through on one surface, then drawn afresh.
        for (const frame of [0, 1, 2]) await session.seekFrame(frame);
        expect(await drift(session, 2)).toBe(0);
    });

    it("stay their own while a timeline is scrubbed back and forth between two 3D scenes", async () => {
        const session = await open(twoScenes());
        // The plain scene takes image id 0, which is a plane's texture in the textured one.
        for (const frame of [2, 4, 1, 5, 2]) {
            await session.seekFrame(frame);
            expect({ frame, differing: await drift(session, frame) }).toEqual({ frame, differing: 0 });
        }
    });
});
