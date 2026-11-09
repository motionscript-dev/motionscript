import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ManifestAssetCatalog, RenderBackendError, Registry, resolveProjectDocument, type RenderIssue } from "@motionscript/core";
import { drawFrameAt, renderTimeline } from "../src/frame-loop";
import type { BrowserRenderContext, BrowserRenderer } from "../src/engine";
import { loadRenderer } from "../src/renderer";
import { comp, node } from "./document.fixtures";

/**
 * An export never reads `buildErrors`, so what its renderer could not draw
 * reaches the host through `onIssue`, and a lost device fails it rather than
 * encoding the frames drawn on the dead one.
 */

const VIEWPORT = { width: 64, height: 64 };
const FPS = 10;
const MANIFEST = { image: {}, video: {}, audio: {}, font: {} };

type IssuingContext = BrowserRenderContext & { script: (execute: number) => RenderIssue[] };

/** The renderer's context, its issues per execute scripted by frame-draw count. */
function issuing(context: BrowserRenderContext): IssuingContext {
    const out = context as IssuingContext;
    const execute = context.execute.bind(context);
    const pending: RenderIssue[] = [];
    let executes = 0;
    out.script = () => [];
    out.execute = (callback) => {
        execute(callback);
        pending.push(...out.script(++executes));
    };
    out.takeRenderIssues = () => pending.splice(0);
    return out;
}

let renderer: BrowserRenderer;
const cleanup: (() => void)[] = [];

beforeAll(async () => {
    renderer = await loadRenderer();
});

afterEach(() => {
    for (const f of cleanup.splice(0)) f();
});

async function harness(doc = comp([node("r", "rect", { width: 32, height: 32 })], [], 1)) {
    const canvas = document.createElement("canvas");
    canvas.width = VIEWPORT.width;
    canvas.height = VIEWPORT.height;
    document.body.appendChild(canvas);
    const assetCatalog = new ManifestAssetCatalog(MANIFEST);
    const storageAdapter = renderer.createStorageAdapter({ catalog: assetCatalog, viewport: VIEWPORT, fps: FPS });
    const renderContext = issuing(renderer.createRenderContext(storageAdapter));
    renderContext.mount(canvas);
    await renderContext.whenMounted?.();
    cleanup.push(() => {
        renderContext.dispose();
        canvas.remove();
    });
    const project = resolveProjectDocument(
        doc,
        { viewport: VIEWPORT }, { viewport: VIEWPORT, fps: FPS },
    );
    return { project, registry: new Registry(), renderContext, storageAdapter, assetCatalog };
}

const blend = (nodeId: string): RenderIssue => ({ kind: "missing", feature: "blend:color-dodge", nodeId, message: "color-dodge is not drawn" });

describe("render issues on the export path", () => {
    it("hands each kind, feature and node to onIssue once", async () => {
        const h = await harness();
        h.renderContext.script = (n) => (n === 1 ? [] : [blend("r"), blend("r"), ...(n === 4 ? [blend("s")] : [])]);
        const issues: RenderIssue[] = [];
        let finalized = false;
        await renderTimeline({
            ...h, includeAudio: false, onIssue: (i) => issues.push(i),
            sink: { start: async () => { }, addFrame: async () => { }, finalize: async () => { finalized = true; return new Uint8Array(); } },
        });
        expect(issues).toEqual([blend("r"), blend("s")]);
        expect(finalized).toBe(true);
    });

    it("fails with a retryable RenderBackendError once the device is lost, and encodes nothing more", async () => {
        const h = await harness();
        h.renderContext.script = (n) => (n === 3 ? [{ kind: "device-lost", message: "the GPU device was lost" }] : []);
        let frames = 0;
        let finalized = false;
        const run = renderTimeline({
            ...h, includeAudio: false,
            sink: { start: async () => { }, addFrame: async () => { frames++; }, finalize: async () => { finalized = true; return new Uint8Array(); } },
        });
        const error = await run.then(() => null, (e: unknown) => e);
        expect(error).toBeInstanceOf(RenderBackendError);
        expect((error as RenderBackendError).retryable).toBe(true);
        expect((error as RenderBackendError).issue.kind).toBe("device-lost");
        expect(frames).toBe(2);
        expect(finalized).toBe(false);
    });

    it("ignores issues from before the render began, and reports a still's own", async () => {
        const h = await harness();
        h.renderContext.script = (n) => (n === 1 ? [{ kind: "device-lost", message: "an earlier loss" }] : [blend("r")]);
        h.renderContext.execute(() => { });
        const issues: RenderIssue[] = [];
        await drawFrameAt({ ...h, frame: { kind: "first" }, onIssue: (i) => issues.push(i) });
        expect(issues).toEqual([blend("r")]);
    });

    it("reports a stored SkSL shader fill as a shader issue on its node, and draws the rest", async () => {
        const sksl = { type: "shader", language: "sksl", source: "half4 main(float2 p) { return half4(1); }" };
        const h = await harness(comp([node("lit", "rect", { width: 32, height: 32, fill: [sksl] })], [], 1));
        const plain = renderer.createRenderContext(h.storageAdapter);
        const canvas = document.createElement("canvas");
        canvas.width = VIEWPORT.width;
        canvas.height = VIEWPORT.height;
        plain.mount(canvas);
        await plain.whenMounted?.();
        cleanup.push(() => plain.dispose());
        const issues: RenderIssue[] = [];
        await drawFrameAt({ ...h, renderContext: plain, frame: { kind: "first" }, onIssue: (i) => issues.push(i) });
        expect(issues.map((i) => [i.kind, i.feature, i.nodeId])).toEqual([["shader", "fill:shader-sksl", "lit"]]);
    });
});
