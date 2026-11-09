import { afterEach, describe, expect, it } from "vitest";
import type { AssetManifest, VisualDocument } from "@motionscript/core";
import { setAssetByteSource } from "../src/asset-bytes";
import { comp, node, project, track } from "./document.fixtures";
import { FPS, VIEWPORT, centres, render, solidProject } from "./export-video.fixtures";
import { serve } from "./media.fixtures";

/**
 * A `Video` node in an export: its frames have to be the picture, on every frame
 * of the file, whether the scene is exported as a project's track or on its own
 * as a clip — which is how a host exports scene by scene.
 */

afterEach(() => setAssetByteSource(null));

const SRC = "clip.mp4";

/** A second of solid red, encoded by the exporter itself. */
async function redClip(): Promise<{ blob: Blob; manifest: AssetManifest }> {
    const bytes = await render({ document: solidProject("#ff0000", FPS), includeAudio: false });
    const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
    return {
        blob,
        manifest: {
            image: {},
            audio: {},
            font: {},
            video: { [SRC]: { src: SRC, width: VIEWPORT.width, height: VIEWPORT.height, duration: 1, sizeBytes: blob.size } },
        },
    };
}

/** A black stage holding one video that fills it. */
const scene = (): VisualDocument =>
    comp(
        [
            node("", "canvas2d", { fill: "#000000" }),
            node("v", "video", { src: SRC, fit: "fill", width: "fill", height: "fill" }),
        ],
        [],
        1,
    );

function expectRed(pixels: number[][]): void {
    expect(pixels.length).toBeGreaterThanOrEqual(FPS - 1);
    for (const [r, g, b] of pixels) {
        expect(r).toBeGreaterThan(180);
        expect(g).toBeLessThan(70);
        expect(b).toBeLessThan(70);
    }
}

describe("exportVideo — a Video node", () => {
    it("draws the video on every frame of a project's track", async () => {
        const { blob, manifest } = await redClip();
        serve({ [SRC]: blob });
        const document = project([track("t", scene())], { fps: FPS, viewport: VIEWPORT });

        expectRed(await centres(await render({ document, manifest, includeAudio: false })));
    });

    it("draws the video when its bytes come from a URL the adapter fetches itself", async () => {
        const { blob, manifest } = await redClip();
        // No byte source: the manifest's own `src` is what is fetched, with range requests.
        const url = URL.createObjectURL(blob);
        const described = { ...manifest, video: { [SRC]: { ...manifest.video[SRC], src: url } } };

        expectRed(
            await centres(await render({ document: scene(), manifest: described, fps: FPS, viewport: VIEWPORT, includeAudio: false })),
        );
    });

    it("draws the video when the scene is exported on its own, as a clip", async () => {
        const { blob, manifest } = await redClip();
        serve({ [SRC]: blob });

        expectRed(
            await centres(await render({ document: scene(), manifest, fps: FPS, viewport: VIEWPORT, includeAudio: false })),
        );
    });
});
