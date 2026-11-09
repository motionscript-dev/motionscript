import { afterEach, describe, expect, it } from "vitest";
import { BufferSource, Input, MP4, VideoSampleSink } from "mediabunny";
import { Registry, setTheme, type ProjectDocument, type Theme } from "@motionscript/core";
import { component2d } from "@motionscript/core/sdk";
import { NothingToDrawError } from "../src/frame-loop";

import { node, project, still, track } from "./document.fixtures";
import { exportVideo, type ExportParams } from "../src/exporter";

/**
 * `exportVideo` called directly, with no engine in front of it. Each case encodes
 * a real MP4 and decodes it back, because what is under test is the file.
 *
 * VP9 rather than the default H.264: every Chromium build encodes it, so these
 * cases run wherever the suite does instead of standing down without AVC.
 */

const VIEWPORT = { width: 64, height: 64 };
const FPS = 10;
const RED: Theme = { colors: { brand: "#ff0000" } };

afterEach(() => setTheme(undefined));

const fullBleed = (fill: string) => still(node("r", "rect", { width: "fill", height: "fill", fill }));
const twoFrames = (fill: string, over: Partial<ProjectDocument> = {}) =>
    project([track("t", fullBleed(fill), { duration: 2 / FPS })], { fps: FPS, viewport: VIEWPORT, ...over });

function render(params: Omit<ExportParams, "returnBytes">): Promise<Uint8Array> {
    return exportVideo({
        supersample: 1,
        video: { codec: "vp9" },
        ...params,
        returnBytes: true,
    }) as Promise<Uint8Array>;
}

/** Every decoded frame's centre pixel, as `[r, g, b]`. */
async function centres(bytes: Uint8Array): Promise<number[][]> {
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("no video track");
    const canvas = document.createElement("canvas");
    canvas.width = VIEWPORT.width;
    canvas.height = VIEWPORT.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const out: number[][] = [];
    for await (const sample of new VideoSampleSink(video).samples()) {
        sample.draw(ctx, 0, 0, VIEWPORT.width, VIEWPORT.height);
        out.push([...ctx.getImageData(VIEWPORT.width / 2, VIEWPORT.height / 2, 1, 1).data.slice(0, 3)]);
        sample.close();
    }
    return out;
}

/** Within a lossy codec's colour shift of `expected`. */
function expectNear(actual: number[][], expected: number[]): void {
    expect(actual.length).toBeGreaterThan(0);
    for (const pixel of actual) {
        for (let i = 0; i < 3; i++) expect(Math.abs(pixel[i] - expected[i])).toBeLessThanOrEqual(24);
    }
}

describe("exportVideo — theme", () => {
    it("draws a themed document in its own colours with no global theme set", async () => {
        setTheme(undefined);

        expectNear(await centres(await render({ document: twoFrames("brand", { theme: RED }) })), [255, 0, 0]);
    });

    it("draws a themed document in its own colours whatever the global theme is", async () => {
        setTheme({ colors: { brand: "#0000ff" } });

        expectNear(await centres(await render({ document: twoFrames("brand", { theme: RED }) })), [255, 0, 0]);
    });

    it("takes a `theme` for a document that carries none", async () => {
        setTheme({ colors: { brand: "#0000ff" } });

        expectNear(await centres(await render({ document: twoFrames("brand"), theme: RED })), [255, 0, 0]);
    });
});

describe("exportVideo — undrawable frames", () => {
    /** A still whose only node cannot be constructed (its children builder throws), so its track fails to build. */
    const broken = still(node("x", "broken"));
    const brokenRegistry = () => new Registry().addNode("broken", component2d({
        key: "broken",
        children: () => {
            throw new Error("cannot build");
        },
    }));

    it("rejects with the error a still throws when every track failed to build", async () => {
        const doc = project([track("bad", broken, { duration: 2 / FPS })], { fps: FPS, viewport: VIEWPORT });

        const thrown = await render({ document: doc, registry: brokenRegistry() }).catch((error: unknown) => error);

        expect(thrown).toBeInstanceOf(NothingToDrawError);
        expect((thrown as NothingToDrawError).frame).toBe(0);
        expect((thrown as Error).message).toMatch(/^Frame 0 has nothing to draw — every track on it failed to build:\n {2}bad: .*cannot build/);
    });

    it("names the first frame a still of the same document would refuse", async () => {
        const doc = project([
            track("ok", fullBleed("#ff0000"), { duration: 1 / FPS }),
            track("bad", broken, { startAt: 1 / FPS, duration: 1 / FPS }),
        ], { fps: FPS, viewport: VIEWPORT });

        const thrown = await render({ document: doc, registry: brokenRegistry() }).catch((error: unknown) => error);

        expect(thrown).toBeInstanceOf(NothingToDrawError);
        expect((thrown as NothingToDrawError).frame).toBe(1);
    });

    it("exports a track that built though one of its nodes failed to declare", async () => {
        const registry = new Registry().addNode("undeclarable", component2d({
            key: "undeclarable",
            load: () => {
                throw new Error("cannot declare");
            },
        }));
        const halfDeclared = still(
            node("r", "rect", { width: "fill", height: "fill", fill: "#ff0000" }),
            node("u", "undeclarable", { width: 0, height: 0 }, null, 1),
        );
        const doc = project([track("t", halfDeclared, { duration: 2 / FPS })], { fps: FPS, viewport: VIEWPORT });

        expectNear(await centres(await render({ document: doc, registry })), [255, 0, 0]);
    });
});

describe("exportVideo — supersampled canvas", () => {
    /** The size of every canvas an export appended to the page, in order. */
    async function canvasSizes(params: Parameters<typeof render>[0]): Promise<{ width: number; height: number }[]> {
        const seen: HTMLCanvasElement[] = [];
        const append = document.body.appendChild.bind(document.body);
        document.body.appendChild = (<T extends Node>(node: T): T => {
            if (node instanceof HTMLCanvasElement) seen.push(node);
            return append(node);
        }) as typeof document.body.appendChild;
        try {
            await render(params);
        } finally {
            document.body.appendChild = append;
        }
        return seen.map((canvas) => ({ width: canvas.width, height: canvas.height }));
    }

    it.each([1, 2, 3])("is a whole multiple of an odd output at supersample %i", async (supersample) => {
        const doc = twoFrames("#ff0000", { viewport: { width: 101, height: 57 } });

        const [offscreen] = await canvasSizes({ document: doc, supersample });

        // The output is padded to 102×58, and the canvas is that, times the factor.
        expect(offscreen).toEqual({ width: 102 * supersample, height: 58 * supersample });
    });
});
