// A user shader drawn outside any scene, by this renderer: a shader editor's
// live preview, a library's thumbnails, an assistant's preview frames. The
// same compile path and draw as a session's, so what an author sees here is
// what the canvas and an export show.

import { loadRendererWasm, WgpuBackend } from "../backend-wgpu";
import { Doc, type Node, type Paint } from "../doc";
import { type ShaderDiagnostic, type ShaderReport, type ShaderScope, validateShader as validate } from "../user-shaders";

export type { ShaderDiagnostic, ShaderField, ShaderReport, ShaderScope } from "../user-shaders";

/**
 * Validates a WGSL fill or effect with naga (loading the renderer's WASM on
 * first use): diagnostics located in `source`, and the reflected `Params`.
 */
export async function validateShader(scope: ShaderScope, source: string, wasmUrl?: string | URL): Promise<ShaderReport> {
    await loadRendererWasm(wasmUrl);
    return validate(scope, source);
}

/**
 * What the renderer puts in front of an author's code, for an editor to show
 * (the real header also holds the renderer's own, `ms_`-prefixed, code).
 */
export const WGSL_PRELUDE: Record<ShaderScope, string> = {
    fill: `// Provided to every WGSL fill:
struct FillIn {
    uv: vec2f,     // 0–1 across the fill's box, y down
    local: vec2f,  // px from the box's top-left
    size: vec2f,   // the box, px
    time: f32,     // the node's elapsed seconds
    scale: f32,    // device px per px
}
var<uniform> u: Params;                 // your struct Params, if you declare one
fn sample_texture(uv: vec2f) -> vec4f   // the fill's first texture, premultiplied

// You write:
fn fill(in: FillIn) -> vec4f            // premultiplied rgba, opacity not folded in
`,
    effect: `// Provided to every WGSL effect:
struct EffectIn {
    uv: vec2f,     // 0–1 across the node's box, y down
    px: vec2f,     // device px (what sample_src_px takes)
    local: vec2f,  // px from the box's top-left
    size: vec2f,   // the box, px
    time: f32,     // the node's elapsed seconds
    scale: f32,    // device px per px
    node: vec2f,      // 0–1 across the node's own box: turns and scales with it
    node_size: vec2f, // the node's own box, px
}
var<uniform> u: Params;                 // your struct Params, if you declare one
fn sample_src(uv: vec2f) -> vec4f       // the input at box uv: the node's layer, or the backdrop
fn sample_src_px(px: vec2f) -> vec4f    // the same at device px; clamped at the input's edge

// You write:
fn effect(in: EffectIn) -> vec4f        // premultiplied rgba
`,
};

export interface ShaderPreviewInput {
    scope: ShaderScope;
    source: string;
    /** `Params` values by member name. */
    uniforms: Record<string, number | readonly number[]>;
    /** Seconds (`in.time`). */
    time: number;
    /** Effects: run over what is beneath the shape (`mode: "backdrop"`) rather than the shape's own content. */
    backdrop?: boolean;
    /** Effects: how the output composites onto the input (core blend name); absent = replaces it. */
    blendMode?: string;
    /** Effects: px the effect may draw or read past the shape. */
    reach?: number;
    /** Effects: the whole frame (default), or an inset rounded rect so the untouched content shows around it. */
    frame?: "full" | "inset";
    /** The content underneath, cover-fitted, in place of the test pattern (or of nothing, under a fill). */
    image?: ImageBitmap | null;
    /** Before/after: left of `split × width` shows the content without the shader. */
    split?: number | null;
    /** A fill's texture (`sample_texture`). */
    texture?: ImageBitmap | null;
}

export interface ShaderStatus {
    state: "compiling" | "ready" | "failed" | "empty";
    /** naga's, then the browser's (`getCompilationInfo`). */
    diagnostics: ShaderDiagnostic[];
}

const INSET = 0.14;
const RADIUS = 0.06;
/** Coral, green and sky: far apart in hue, so a channel split reads at every edge. */
const DISCS: [number, number, number][] = [[0.98, 0.45, 0.4], [0.35, 0.8, 0.5], [0.35, 0.65, 0.98]];

/**
 * One preview surface on its own WebGPU device. `draw` never waits: a program
 * still compiling draws what lies beneath, and the last input is drawn again
 * when it is ready (`onDraw` says so).
 */
export class ShaderPreview {
    /** Called after a redraw the preview made by itself (a program became ready). */
    onDraw: (() => void) | null = null;
    private last: ShaderPreviewInput | null = null;
    private images = new WeakMap<ImageBitmap, number>();
    private version = 0;
    private size = "";

    private constructor(private readonly backend: WgpuBackend, private readonly canvas: HTMLCanvasElement | OffscreenCanvas) {}

    static async create(canvas: HTMLCanvasElement | OffscreenCanvas, wasmUrl?: string | URL): Promise<ShaderPreview> {
        await loadRendererWasm(wasmUrl);
        const backend = new WgpuBackend();
        await backend.init(canvas as HTMLCanvasElement, Math.max(1, canvas.width), Math.max(1, canvas.height));
        backend.setOptions(false, false);
        backend.collectUnused = true;
        const preview = new ShaderPreview(backend, canvas);
        backend.onShaderReady = () => {
            if (!preview.last) return;
            preview.draw(preview.last);
            preview.onDraw?.();
        };
        return preview;
    }

    /** Draws `input` at the canvas's current size. */
    draw(input: ShaderPreviewInput): ShaderStatus {
        this.last = input;
        const w = Math.max(1, this.canvas.width), h = Math.max(1, this.canvas.height);
        if (this.size !== `${w}x${h}`) {
            this.backend.resize(w, h);
            this.size = `${w}x${h}`;
        }
        const doc = this.build(input, w, h);
        this.backend.sync(doc);
        this.backend.render();
        return this.status(input.scope, input.source);
    }

    /** Draws `input` once its program has compiled, and resolves to the frame (straight alpha). */
    async pixels(input: ShaderPreviewInput): Promise<ImageData> {
        this.draw(input);
        await this.whenReady();
        this.draw(input);
        const px = await this.backend.readPixels();
        const w = Math.max(1, this.canvas.width), h = Math.max(1, this.canvas.height);
        const out = Uint8ClampedArray.from(px.subarray(0, w * h * 4));
        for (let i = 0; i < out.length; i += 4) {
            const a = out[i + 3];
            if (a === 0 || a === 255) continue;
            out[i] = (out[i] * 255) / a;
            out[i + 1] = (out[i + 1] * 255) / a;
            out[i + 2] = (out[i + 2] * 255) / a;
        }
        return new ImageData(out, w, h);
    }

    /** {@link pixels}, encoded. */
    async snapshot(input: ShaderPreviewInput, type = "image/png", quality?: number): Promise<Blob> {
        const image = await this.pixels(input);
        const out = new OffscreenCanvas(image.width, image.height);
        out.getContext("2d")!.putImageData(image, 0, 0);
        return out.convertToBlob({ type, quality });
    }

    /** Settles once every program drawn so far is ready or failed. */
    whenReady(): Promise<void> {
        return this.backend.whenShadersReady();
    }

    /** A program's state and diagnostics (compiling it if it is new). */
    status(scope: ShaderScope, source: string): ShaderStatus {
        if (!source.trim()) return { state: "empty", diagnostics: [] };
        const p = this.backend.shaders.program(scope, source);
        return { state: p.state, diagnostics: [...p.report.diagnostics, ...p.browser] };
    }

    destroy(): void {
        this.backend.onShaderReady = undefined;
        this.backend.destroy();
        this.last = null;
    }

    private build(input: ShaderPreviewInput, w: number, h: number): Doc {
        const doc = new Doc(w, h, [0, 0, 0, 0]);
        const root = doc.root;
        const content = (parent: Node) => (input.image ? this.cover(doc, parent, input.image, w, h) : pattern(doc, parent, w, h));
        const split = input.split == null ? 0 : Math.min(1, Math.max(0, input.split)) * w;
        if (input.scope === "fill") {
            if (input.image) content(root);
            const paint: Paint = {
                kind: "shader", source: input.source, uniforms: input.uniforms as Record<string, number | number[]>,
                box: [0, 0, w, h], time: input.time, ...(input.texture ? { texture: this.asset(doc, input.texture) } : {}),
            };
            const host = split > 0 ? doc.group(root, { clip: { x: split, y: 0, w: w - split, h, r: 0 } }) : root;
            doc.rect(host, { w, h, fill: paint });
            return doc;
        }
        content(root);
        const short = Math.min(w, h);
        const inset = input.frame === "inset";
        const m = inset ? short * INSET : 0;
        const box = { x: m, y: m, w: w - 2 * m, h: h - 2 * m, r: inset ? short * RADIUS : 0 };
        const effect = {
            type: "shader", language: "wgsl", source: input.source, uniforms: input.uniforms,
            mode: input.backdrop ? "backdrop" : "foreground",
            ...(input.blendMode && !input.backdrop ? { blendMode: input.blendMode } : {}),
            ...(input.reach ? { reach: input.reach } : {}),
        };
        const host = split > 0 ? doc.group(root, { clip: { x: split, y: 0, w: w - split, h, r: 0 } }) : root;
        const effectBox: [number, number, number, number] = [box.x, box.y, box.w, box.h];
        if (input.backdrop) {
            doc.rect(host, { transform: [1, 0, 0, 1, box.x, box.y], w: box.w, h: box.h, radii: [box.r, box.r, box.r, box.r], effects: [effect], effectBox: [0, 0, box.w, box.h], effectTime: input.time });
        } else {
            const g = doc.group(host, { clip: box, effects: [effect], effectBox, effectTime: input.time });
            content(g);
        }
        return doc;
    }

    private asset(doc: Doc, bitmap: ImageBitmap) {
        const a = doc.addImage(bitmap, bitmap.width, bitmap.height, { mipmaps: false });
        let v = this.images.get(bitmap);
        if (v === undefined) this.images.set(bitmap, (v = ++this.version));
        a.version = v;
        return a;
    }

    private cover(doc: Doc, parent: Node, bitmap: ImageBitmap, w: number, h: number) {
        doc.rect(parent, { w, h, fill: { kind: "image", image: this.asset(doc, bitmap), fit: "fill", box: [0, 0, w, h] } });
    }
}

/**
 * The ruled test pattern an effect is previewed over: a wash with a grid and
 * three saturated discs inside a white ring, because an effect is invisible on
 * a smooth field.
 */
function pattern(doc: Doc, parent: Node, w: number, h: number) {
    doc.rect(parent, { w, h, fill: { kind: "linear", from: [0, 0], to: [w, h], stops: [{ offset: 0, color: [0.16, 0.2, 0.42, 1] }, { offset: 1, color: [0.55, 0.25, 0.45, 1] }] } });
    const short = Math.min(w, h);
    const step = Math.max(12, Math.round(short / 12));
    const line = { kind: "solid" as const, color: [1, 1, 1, 0.3] as [number, number, number, number] };
    for (let x = step; x < w; x += step) doc.rect(parent, { transform: [1, 0, 0, 1, x - 0.5, 0], w: 1, h, fill: line });
    for (let y = step; y < h; y += step) doc.rect(parent, { transform: [1, 0, 0, 1, 0, y - 0.5], w, h: 1, fill: line });
    const cx = w / 2, cy = h / 2, r = short * 0.1;
    DISCS.forEach((c, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / DISCS.length;
        const x = cx + Math.cos(a) * short * 0.17, y = cy + Math.sin(a) * short * 0.17;
        doc.ellipse(parent, { transform: [1, 0, 0, 1, x - r, y - r], w: 2 * r, h: 2 * r, fill: { kind: "solid", color: [...c, 1] } });
    });
    const ring = short * 0.3;
    doc.ellipse(parent, { transform: [1, 0, 0, 1, cx - ring, cy - ring], w: 2 * ring, h: 2 * ring, stroke: { paint: { kind: "solid", color: [1, 1, 1, 0.85] }, width: Math.max(1.5, short / 90) } });
}
