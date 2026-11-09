import { afterEach, describe, expect, it } from "vitest";
import { BufferSource, Input, MP4, VideoSampleSink } from "mediabunny";
import { Fills, type AssetManifest } from "@motionscript/core";
import { comp, node, project, still, track } from "./document.fixtures";
import { setAssetByteSource } from "../src/asset-bytes";
import { createStillRenderer } from "../src/still";
import { FPS, VIEWPORT, render } from "./export-video.fixtures";
import { encodeClip } from "./video.fixtures";

/**
 * What an exported frame is next to a still of it (RULES.md IV):
 * within a stated, recorded tolerance of one, once the lossy encode has had its
 * say; and the same frame of a video-backed document.
 */

afterEach(() => setAssetByteSource(null));

async function decodeStill(blob: Blob): Promise<Uint8ClampedArray> {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

/** Every decoded frame of an MP4, as RGBA at the viewport's size. */
async function decodedFrames(bytes: Uint8Array): Promise<Uint8ClampedArray[]> {
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
    const video = (await input.getPrimaryVideoTrack())!;
    const canvas = document.createElement("canvas");
    canvas.width = VIEWPORT.width;
    canvas.height = VIEWPORT.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const out: Uint8ClampedArray[] = [];
    for await (const sample of new VideoSampleSink(video).samples()) {
        sample.draw(ctx, 0, 0, VIEWPORT.width, VIEWPORT.height);
        out.push(ctx.getImageData(0, 0, VIEWPORT.width, VIEWPORT.height).data);
        sample.close();
    }
    return out;
}

describe("a decoded exported frame against its still", () => {
    /** Hard edges, a stroke, a rotation and a gradient: the content a 4:2:0 encode is worst at. */
    const doc = project([track("t", still(
        node("bg", "rect", { width: "fill", height: "fill", fill: "#223344" }),
        node("a", "rect", { width: 30, height: 18, rotation: 25, x: -8, y: 6, fill: "#ffcc00", stroke: { weight: 3, fill: "#101820" }, cornerRadius: 4 }, null, 1),
        node("b", "ellipse", { width: 20, height: 20, x: 14, y: -10, fill: Fills.linearGradient(["#ff0066", "#3300ff"]) }, null, 2),
    ), { duration: 2 / FPS })], { fps: FPS, viewport: VIEWPORT });

    // The recorded bound, at the encoder settings below (VP9, constant 20 Mbps, software): measured at a mean
    // error of about 2.7 levels of 255, a 99th percentile of about 39 and a worst pixel of about 113, the worst
    // sitting on the saturated edges chroma subsampling smears. H.264 at the same rate measured a little worse.
    const MEAN_ERROR = 5;
    const P99_ERROR = 48;
    const WORST_ERROR = 130;

    it("is within the bound of the still of the same frame, at fixed encoder settings", async () => {
        const bytes = await render({
            document: doc,
            video: { codec: "vp9", bitrate: 20_000_000, bitrateMode: "constant", hardwareAcceleration: "prefer-software" },
        });
        const exported = await decodedFrames(bytes);
        const renderer = await createStillRenderer({ viewport: VIEWPORT, fps: FPS });
        try {
            expect(exported).toHaveLength(2);
            for (const [frame, pixels] of exported.entries()) {
                await renderer.render(doc, { frame });
                const reference = await decodeStill(await renderer.toBlob());

                const errors: number[] = [];
                for (let i = 0; i < reference.length; i += 4) {
                    for (let c = 0; c < 3; c++) errors.push(Math.abs(reference[i + c] - pixels[i + c]));
                }
                errors.sort((a, b) => a - b);
                const mean = errors.reduce((sum, e) => sum + e, 0) / errors.length;
                expect({ frame, mean: mean <= MEAN_ERROR, p99: errors[Math.floor(errors.length * 0.99)] <= P99_ERROR, worst: errors.at(-1)! <= WORST_ERROR })
                    .toEqual({ frame, mean: true, p99: true, worst: true });
                // And it is the picture, not a flat frame: the encode did not wash it out.
                expect(errors.at(-1)).toBeGreaterThan(0);
            }
        } finally {
            renderer.dispose();
        }
    });
});

describe("the frame of a video-backed document", () => {
    const COLOURS = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff"];
    const SRC = "clip.mp4";

    const manifest: AssetManifest = {
        image: {}, audio: {}, font: {},
        video: { [SRC]: { src: SRC, width: 64, height: 64, duration: COLOURS.length / FPS, sizeBytes: 0 } },
    };
    // Muted: the mix would otherwise ask for the clip's soundtrack, which it fetches from the network
    // and which this clip does not have.
    const doc = project([track("t", comp(
        [{ ...node("v", "video", { src: SRC, width: "fill", height: "fill", muted: true }), startAt: 0 }],
        [],
        COLOURS.length / FPS,
    ), { duration: COLOURS.length / FPS })], { fps: FPS, viewport: VIEWPORT });

    const near = (pixels: ArrayLike<number>, hex: string, at = (VIEWPORT.height >> 1) * VIEWPORT.width * 4 + (VIEWPORT.width >> 1) * 4) => {
        const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return [0, 1, 2].every((c) => Math.abs(pixels[at + c] - want[c]) <= 40);
    };

    it("is the same one in the export and in the still, frame for frame", async () => {
        const clip = await encodeClip(COLOURS);
        setAssetByteSource(async (src) => (src === SRC ? clip : null));

        const exported = await decodedFrames(await render({ document: doc, manifest }));
        const renderer = await createStillRenderer({ viewport: VIEWPORT, fps: FPS, manifest });
        try {
            expect(exported).toHaveLength(COLOURS.length);
            for (const [frame, colour] of COLOURS.entries()) {
                await renderer.render(doc, { frame });
                const still_ = await decodeStill(await renderer.toBlob());
                expect({ frame, source: "still", ok: near(still_, colour) }).toEqual({ frame, source: "still", ok: true });
                expect({ frame, source: "export", ok: near(exported[frame], colour) }).toEqual({ frame, source: "export", ok: true });
            }
        } finally {
            renderer.dispose();
        }
    });
});
