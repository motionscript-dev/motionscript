// A session's render surface on the wgpu renderer: the adapter's render
// context mounted on a <canvas>, with the preview knobs a host sets (pixel
// ratio, view, frame, clipToFrame, frameBackground).

import { renderIssueKey, type RenderIssue, type Size2D, type TextBlockLayout, type TextState } from "@motionscript/core";
import { WgpuRenderContext } from "../adapter/context";
import { WgpuBackend } from "../backend-wgpu";
import type { Doc, Node, Xform } from "../doc";
import type { WgpuStorageAdapter } from "./storage";
import { layoutTextBlock, measureText, shaperFor } from "./text";
import { SKSL_EFFECT, SKSL_FILL } from "../user-shaders";
import { addFaultTarget, crashMessage, watchDevice } from "./faults";

type Shaper = ReturnType<typeof shaperFor>;

/** What the adapter could not draw, logged once per kind per page. */
const reported = new Set<string>();

/** Kinds that mean "not loaded yet", which a settled frame waits out. */
export const TRANSIENT = /-not-(?:decoded|loaded)$/;

/** What a feature the adapter does not draw is called, by its exact kind or by its kind's prefix. */
const FEATURE_NAMES: Record<string, string> = {
    "text:path": "Text on a path",
    rasterize: "rasterize()",
    "boolean:nested": "A boolean nested in one of another kind",
    "boolean:projective": "A boolean under a 3D (projective) transform",
    "cut:compound": "A cut through a compound shape",
    "stroke:union-of-booleans": "One stroke around several booleans",
    "effect:motionBlur-shutter": "Motion blur with an off-centre shutter or over 32 samples",
    "surface:error": "A surface texture that failed to draw",
    "blend:": "The blend mode",
    "fill:blend:": "The fill blend mode",
    "op:": "The drawing op",
    "fill:": "The fill",
    "effect:": "The effect",
    "3d:": "In 3D,",
};

export function missingMessage(kind: string): string {
    if (FEATURE_NAMES[kind]) return `${FEATURE_NAMES[kind]} is not drawn by the WebGPU renderer.`;
    const prefix = Object.keys(FEATURE_NAMES).filter((p) => p.endsWith(":") && kind.startsWith(p)).sort((a, b) => b.length - a.length)[0];
    return prefix ? `${FEATURE_NAMES[prefix]} "${kind.slice(prefix.length)}" is not drawn by the WebGPU renderer.` : `Not drawn by the WebGPU renderer: ${kind}.`;
}

export class WgpuSurfaceContext extends WgpuRenderContext {
    view: { zoom: number; x: number; y: number } = { zoom: 1, x: 0, y: 0 };
    frame: Size2D | null = null;
    clipToFrame = true;
    frameBackground: "black" | "transparent" = "black";

    private canvas: HTMLCanvasElement | null = null;
    /**
     * The drawing-buffer size the host gave the canvas when it last mounted.
     * wgpu writes the canvas's width and height whenever it configures, so a
     * device that finishes starting after the host resized the canvas would
     * shrink it back; this, not the canvas, is the size to draw at.
     */
    private size = { width: 1, height: 1 };
    private backend: WgpuBackend | null = null;
    private starting: Promise<void> | null = null;
    /** The last mount rejected: a settled frame has nothing to wait for. */
    private startFailed = false;
    private startToken: object | null = null;
    private lastDoc: Doc | null = null;
    private viewportKey = "";
    private readonly shaper: Shaper;
    private readonly stopFonts: () => void;
    private readonly stopSettle: () => void;
    private readonly stopFaults: () => void;
    /** Page-wide faults (a lost device, a WebGPU error, a panic) since the last takeRenderIssues. */
    private faults: RenderIssue[] = [];
    /** The renderer panicked: nothing calls into it again. */
    private halted = false;

    constructor(private readonly store: WgpuStorageAdapter, viewport: Size2D) {
        const shaper = shaperFor(store);
        super(viewport.width, viewport.height, (text, size, family, weight, spacing, style) => measureText(shaper, text, size, family, weight, spacing, style));
        this.shaper = shaper;
        this.storage = store;
        this.images = store.images;
        this.stopFonts = store.onFont((f) => this.backend?.registerFont(f.bytes, f.family));
        // A settled frame (an export's, a seek's) is drawn again once its shaders
        // compile, or once a surface remounting after a lost device can draw.
        this.stopSettle = store.addSettler(() => {
            if (this.starting && !this.startFailed) return this.starting.catch(() => {});
            return this.backend?.shaders.hasPending() ? this.backend.whenShadersReady() : null;
        });
        this.stopFaults = addFaultTarget({
            queueIssue: (issue) => this.faults.push(issue),
            remount: () => this.remount(),
            halt: () => this.halt(),
        });
    }

    /** Renderer stats of the last frame (build/encode ms, draws, passes, …). */
    stats(): Record<string, number> | null {
        return this.backend?.stats() ?? null;
    }

    mount(target: unknown): void {
        const canvas = target as HTMLCanvasElement;
        this.size = { width: Math.max(1, canvas.width), height: Math.max(1, canvas.height) };
        if (canvas === this.canvas && (this.backend || this.starting)) {
            // A resize: the next present reconfigures to the new size.
            this.present();
            return;
        }
        this.releaseBackend();
        this.canvas = canvas;
        if (this.halted || crashMessage() !== null) return;
        const token = {};
        this.startToken = token;
        this.startFailed = false;
        const starting = (this.starting = (async () => {
            const backend = new WgpuBackend();
            await backend.init(canvas, this.size.width, this.size.height);
            if (this.startToken !== token) {
                if (!this.halted) backend.destroy();
                return;
            }
            watchDevice(backend.gpuDevice());
            // sRGB blending without dither: the engine's own look, and the canvas
            // pass draws straight into the output with no intermediate or blit.
            backend.setOptions(false, false);
            // Every frame is a new document, so unused definitions can go.
            backend.collectUnused = true;
            // A user shader that finishes compiling shows on the next draw.
            backend.onShaderReady = () => this.present();
            for (const f of this.store.fonts) backend.registerFont(f.bytes, f.family);
            this.backend = backend;
            this.starting = null;
            this.present();
        })());
        starting.catch((e) => {
            if (this.starting === starting) this.startFailed = true;
            console.error("[wgpu] the renderer failed to start:", e);
        });
    }

    /** Settles once the mounted canvas has a device to draw with; rejects if it can't get one. */
    whenMounted(): Promise<void> {
        return this.starting ?? Promise.resolve();
    }

    unmount(): void {
        this.releaseBackend();
        this.canvas = null;
    }

    execute(callback: () => void): void {
        const canvas = this.canvas;
        if (!canvas || this.isDisposed()) return;
        this.width = this.size.width / this.pixelRatio;
        this.height = this.size.height / this.pixelRatio;
        try {
            super.execute(callback);
        } finally {
            this.lastDoc = this.doc;
            this.present();
            for (const kind of this.missing) {
                if (reported.has(kind) || kind.endsWith("-not-decoded")) continue;
                reported.add(kind);
                console.warn(`[wgpu] not drawn yet: ${kind}`);
            }
        }
    }

    /**
     * Since the last call: page-wide faults, user shaders that do not compile
     * or whose uniforms miss their `Params`, and every feature the last frame
     * asked for that this renderer does not draw, once per kind and node.
     */
    override takeRenderIssues(): RenderIssue[] {
        const out = new Map<string, RenderIssue>();
        const add = (issue: RenderIssue) => out.set(renderIssueKey(issue), issue);
        for (const issue of this.faults.splice(0)) add(issue);
        const backend = this.halted ? null : this.backend;
        for (const message of backend?.shaderIssues ?? []) {
            add({ kind: "shader", ...(message === SKSL_EFFECT && { feature: "effect:shader-sksl" }), message });
        }
        backend?.shaderIssues.clear();
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
        for (const type of backend?.missing ?? []) add({ kind: "missing", feature: `effect:${type}`, message: missingMessage(`effect:${type}`) });
        for (const what of backend?.missing3d ?? []) add({ kind: "missing", feature: `3d:${what}`, message: missingMessage(`3d:${what}`) });
        return [...out.values()];
    }

    /** Settles once every user shader the last frames used has compiled (or failed); an export waits on it. */
    whenShadersReady(): Promise<void> {
        return this.backend?.whenShadersReady() ?? Promise.resolve();
    }

    override layoutTextBlock(state: Partial<TextState>): TextBlockLayout | null {
        return layoutTextBlock(this.shaper, state);
    }

    /** The frame (or the whole surface) as an image data URL. */
    screenshot(mime = "image/png", quality?: number): string | undefined {
        return this.snapshotCanvas()?.toDataURL(mime, quality);
    }

    /**
     * The frame (or the whole surface) copied into a fresh 2D canvas. A WebGPU
     * canvas is only readable in the task that drew it, so this draws it again first.
     */
    snapshotCanvas(): HTMLCanvasElement | undefined {
        const canvas = this.canvas;
        if (!canvas || !this.backend || !this.lastDoc) return undefined;
        this.present();
        let [x, y, w, h] = [0, 0, canvas.width, canvas.height];
        if (this.frame) {
            const pr = this.pixelRatio, z = this.view.zoom;
            const cx = canvas.width / 2 + this.view.x * pr, cy = canvas.height / 2 + this.view.y * pr;
            const fw = this.frame.width * z * pr, fh = this.frame.height * z * pr;
            x = Math.max(0, Math.round(cx - fw / 2));
            y = Math.max(0, Math.round(cy - fh / 2));
            w = Math.max(1, Math.min(canvas.width - x, Math.round(fw)));
            h = Math.max(1, Math.min(canvas.height - y, Math.round(fh)));
        }
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const ctx = out.getContext("2d");
        if (!ctx) return undefined;
        ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        return out;
    }

    override dispose(): void {
        this.releaseBackend();
        this.stopFonts();
        this.stopSettle();
        this.stopFaults();
        this.canvas = null;
        this.lastDoc = null;
        this.store.dispose();
        super.dispose();
    }

    protected override rootTransform(): Xform {
        const z = this.view.zoom;
        return [z, 0, 0, z, this.width / 2 + this.view.x, this.height / 2 + this.view.y];
    }

    protected override clearColor(): [number, number, number, number] {
        // Transparent around a frame, so the host's panel shows there.
        return this.frame ? [0, 0, 0, 0] : [0, 0, 0, 1];
    }

    protected override frameGroup(root: Node): Node {
        const frame = this.frame;
        if (!frame) return root;
        const box = { x: -frame.width / 2, y: -frame.height / 2, w: frame.width, h: frame.height };
        if (this.frameBackground === "black") {
            this.doc.rect(root, { transform: [1, 0, 0, 1, box.x, box.y], w: box.w, h: box.h, fill: { kind: "solid", color: [0, 0, 0, 1] } });
        }
        return this.clipToFrame ? this.doc.group(root, { clip: { ...box, r: 0 } }) : root;
    }

    /** Hands the last recorded frame to the renderer, once it has started. */
    private present(): void {
        const backend = this.backend, canvas = this.canvas, doc = this.lastDoc;
        if (!backend || !canvas || !doc || this.halted) return;
        const { width, height } = this.size;
        // The viewport (size, scale, clear colour) is written on a full upload,
        // which a resize asks for. A canvas left at another size (see `size`)
        // is configured back.
        const key = `${width}x${height}/${doc.width}/${doc.background.join(",")}`;
        if (key !== this.viewportKey || canvas.width !== width || canvas.height !== height) {
            backend.resize(width, height);
            this.viewportKey = key;
        }
        try {
            backend.sync(doc);
            backend.render();
        } catch (e) {
            console.error("[wgpu] frame failed:", e);
        }
    }

    private releaseBackend(): void {
        this.starting = null;
        this.startToken = null;
        if (!this.halted) this.backend?.destroy();
        this.backend = null;
        this.viewportKey = "";
    }

    /** The device was lost: the same canvas, mounted again on the new one (fonts, pipelines and shaders rebuilt). */
    private remount(): void {
        const canvas = this.canvas;
        if (!canvas || this.isDisposed() || this.halted) return;
        this.releaseBackend();
        this.mount(canvas);
    }

    /** The renderer panicked: its WASM is not called again, so the backend is dropped, not freed. */
    private halt(): void {
        this.halted = true;
        this.releaseBackend();
    }
}
