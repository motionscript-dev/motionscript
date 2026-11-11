// A render context whose frames go to the native export sidecar instead of a
// canvas: the same adapter and backend as WgpuSurfaceContext, over a
// RecordingRenderer. The export's sink marks each finished frame
// (`frameDone`); the sidecar renders and encodes it.

import { renderIssueKey, type RenderIssue, type Size2D, type TextBlockLayout, type TextState } from "@motionscript/core";
import { WgpuRenderContext } from "../adapter/context";
import { WgpuBackend } from "../backend-wgpu";
import type { Renderer } from "../../pkg/ms_renderer.js";
import type { WgpuStorageAdapter } from "../engine/storage";
import { layoutTextBlock, measureText, shaperFor } from "../engine/text";
import { missingMessage, TRANSIENT } from "../engine/surface";
import { SKSL_EFFECT, SKSL_FILL } from "../user-shaders";
import { RecordingRenderer, REC, type StreamWriter } from "./recorder";

export class NativeExportContext extends WgpuRenderContext {
    readonly recorder: RecordingRenderer;
    private readonly backend = new WgpuBackend();
    private readonly shaper: ReturnType<typeof shaperFor>;
    private readonly stopFonts: () => void;
    private readonly stopSettle: () => void;
    private viewportKey = "";
    private frameCount = 0;

    /**
     * `size` is the render target in pixels (the output times its
     * supersampling); `effects` the sidecar's built-in effect names in its
     * index order (`ms-export info`).
     */
    constructor(private readonly store: WgpuStorageAdapter, viewport: Size2D, readonly out: StreamWriter, effects: readonly string[], private readonly size: { width: number; height: number }) {
        const shaper = shaperFor(store);
        super(viewport.width, viewport.height, (text, s, family, weight, spacing, style) => measureText(shaper, text, s, family, weight, spacing, style));
        this.shaper = shaper;
        this.storage = store;
        this.images = store.images;
        this.recorder = new RecordingRenderer(out, effects, size.width, size.height);
        const memory = this.recorder.memory;
        this.backend.attach(this.recorder as unknown as Renderer, memory, size.width, size.height);
        this.backend.setOptions(false, false);
        this.backend.collectUnused = true;
        for (const f of store.fonts) this.backend.registerFont(f.bytes, f.family);
        this.stopFonts = store.onFont((f) => this.backend.registerFont(f.bytes, f.family));
        this.stopSettle = store.addSettler(() => (this.backend.shaders.hasPending() ? this.backend.whenShadersReady() : null));
    }

    mount(): void {}
    unmount(): void {}
    whenMounted(): Promise<void> {
        return Promise.resolve();
    }

    execute(callback: () => void): void {
        if (this.isDisposed()) return;
        this.width = this.size.width / this.pixelRatio;
        this.height = this.size.height / this.pixelRatio;
        try {
            super.execute(callback);
        } finally {
            const doc = this.doc;
            const key = `${this.size.width}x${this.size.height}/${doc.width}/${doc.background.join(",")}`;
            if (key !== this.viewportKey) {
                this.backend.resize(this.size.width, this.size.height);
                this.viewportKey = key;
            }
            this.backend.sync(doc);
        }
    }

    /** The scene as last synced is the next video frame. */
    frameDone(): void {
        this.out.record(REC.FRAME, [this.frameCount++]);
    }

    override takeRenderIssues(): RenderIssue[] {
        const out = new Map<string, RenderIssue>();
        const add = (issue: RenderIssue) => out.set(renderIssueKey(issue), issue);
        for (const message of this.backend.shaderIssues) {
            add({ kind: "shader", ...(message === SKSL_EFFECT && { feature: "effect:shader-sksl" }), message });
        }
        this.backend.shaderIssues.clear();
        for (const issue of this.shaderIssues) add(issue);
        for (const kind of this.missing) {
            if (TRANSIENT.test(kind)) continue;
            const issue: RenderIssue = kind === "fill:shader-sksl"
                ? { kind: "shader", feature: kind, message: SKSL_FILL }
                : { kind: "missing", feature: kind, message: missingMessage(kind) };
            const nodes = this.missing.nodes.get(kind);
            if (!nodes?.size) add(issue);
            else for (const nodeId of nodes) add({ ...issue, nodeId });
        }
        for (const type of this.backend.missing) add({ kind: "missing", feature: `effect:${type}`, message: missingMessage(`effect:${type}`) });
        for (const what of this.backend.missing3d) add({ kind: "missing", feature: `3d:${what}`, message: missingMessage(`3d:${what}`) });
        return [...out.values()];
    }

    override layoutTextBlock(state: Partial<TextState>): TextBlockLayout | null {
        return layoutTextBlock(this.shaper, state);
    }

    override dispose(): void {
        this.stopFonts();
        this.stopSettle();
        this.store.dispose();
        super.dispose();
    }
}
