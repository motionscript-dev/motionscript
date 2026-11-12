// Backend adapter for the Rust/wgpu renderer: turns document changes into
// deltas. Paints, paths and dash patterns are interned so each distinct value
// crosses into WASM once.

import { encodeScene3D, GeometryTable, TextureTable } from "./r3d/encode";
import init, { Renderer } from "../pkg/ms_renderer.js";
import { BLEND_MODES, D, Doc, type ImageAsset, imageMatrix, isProjective, KIND_CODE, MASK_CODE, MEMBER_OP, memberOp, Node, type Paint, type PathData, pathBounds } from "./doc";
import { DeltaWriter, NONE, OP } from "./protocol";
import { type AuxTexture, type Packed, PORTS } from "./effects/_port";
import { isWgslShader, normalizeUniforms } from "@motionscript/core";
import { EFFECT_BLEND, packParams, SKSL_EFFECT, type UserProgram, UserShaders } from "./user-shaders";

/** An `OP_EFFECTS` index at or above this is a user program (gpu.rs `USER_EFFECT`). */
const USER_EFFECT = 0x4000_0000;

/** A core `shader` effect as the backend reads it. */
interface UserEffect { source: string; language?: string; reach?: number; uniforms?: unknown; mode?: string; blendMode?: string; clip?: boolean }

let wasm: Promise<{ memory: WebAssembly.Memory }> | null = null;

/** Loads the renderer's WASM once; `url` overrides where it is served from. The first call wins. */
export function loadRendererWasm(url?: string | URL): Promise<{ memory: WebAssembly.Memory }> {
    wasm ??= init(url ? { module_or_path: url } : undefined) as unknown as Promise<{ memory: WebAssembly.Memory }>;
    return wasm;
}

let device: Promise<void> | null = null;

/**
 * Gets the GPU device every renderer on the page shares (gpu.rs `prewarm`).
 * Every `init` waits on it, so two surfaces mounting together ask once; a
 * failure is forgotten, so the next mount asks again.
 */
export function prewarmDevice(): Promise<void> {
    device ??= loadRendererWasm().then(() => Renderer.prewarm()).catch((e) => {
        device = null;
        throw e;
    });
    return device;
}

/** Forgets the shared device (lost), so the next `prewarmDevice` or mount asks for a new one. */
export function forgetDevice(): void {
    device = null;
    if (wasm) Renderer.forget_device();
}

const JOIN = { miter: 0, round: 1, bevel: 2 } as const;
const CAP = { butt: 0, round: 1, square: 2 } as const;
const TILE = { clamp: 0, repeat: 1, mirror: 2, decal: 3 } as const;
const MEMBER_KIND = { rect: 1, ellipse: 2, path: 3 } as const;
const ALIGN = { left: 0, right: 1, center: 2, justify: 3 } as const;
const VALIGN = { top: 0, center: 1, bottom: 2 } as const;
const utf8 = new TextEncoder();
/** Syncs an unused path or paint is kept before its id is freed for reuse. */
const KEEP_UNUSED = 120;

/** A path or paint definition and the sync that last used it. */
interface Interned { id: number; used: number; live: boolean }

// After each multiply, the shift folds the high bits down. A multiply alone carries a word's bit 31 (a float's
// sign) only to bit 31, so flipping every sign of an even count of words (a path or gradient mirrored through the
// origin) would cancel out and hash the same.
function hashWords(words: ArrayLike<number>): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < words.length; i++) {
        h = Math.imul(h ^ words[i], 0x01000193);
        h ^= h >>> 15;
    }
    return h >>> 0;
}

/** FNV-1a over a path's verbs and point bits, twice with different seeds. */
export function pathKey(d: PathData): string {
    const bits = new Uint32Array(d.points.buffer, d.points.byteOffset, d.points.length);
    let a = 0x811c9dc5, b = 0x01000193 ^ d.points.length;
    for (let i = 0; i < d.verbs.length; i++) {
        a = Math.imul(a ^ d.verbs[i], 0x01000193);
        b = Math.imul(b ^ d.verbs[i], 0x5bd1e995);
    }
    for (let i = 0; i < bits.length; i++) {
        a = Math.imul(a ^ bits[i], 0x01000193);
        a ^= a >>> 15;
        b = Math.imul(b ^ bits[i], 0x5bd1e995);
        b ^= b >>> 13;
    }
    return `${d.verbs.length}:${bits.length}:${a >>> 0}:${b >>> 0}`;
}

export class WgpuBackend {
    readonly name = "wgpu";
    private r!: Renderer;
    private w!: DeltaWriter;
    private paintIds = new WeakMap<Paint, Interned>();
    private paintByKey = new Map<string, Interned>();
    private freePaints: number[] = [];
    private pathIds = new WeakMap<PathData, Interned>();
    private pathByKey = new Map<string, Interned>();
    private freePaths: number[] = [];
    /** Counts syncs; what a definition's `used` is measured against. */
    private generation = 0;
    /**
     * Free paths and reuse paint ids nothing has used for a while. Only for a
     * caller that hands over a new document every frame (every node rewritten,
     * so every live definition is marked used); a retained document's
     * untouched nodes would lose theirs.
     */
    collectUnused = false;
    private dashIds = new Map<string, number>();
    private nextPaint = 0;
    private nextPath = 0;
    private nextDash = 0;
    private synced = false;
    private viewport = { w: 0, h: 0 };
    lastDeltaWords = 0;

    async init(canvas: HTMLCanvasElement, width: number, height: number) {
        const exports = await loadRendererWasm();
        // A failure surfaces from `create`, which asks again.
        await prewarmDevice().catch(() => {});
        this.attach(await Renderer.create(canvas, width, height), exports.memory, width, height);
    }

    /**
     * Drives `renderer` instead of a WASM one on a canvas: anything with its
     * methods, writing deltas into `memory` (the native export's recorder,
     * `native/recorder.ts`).
     */
    attach(renderer: Renderer, memory: WebAssembly.Memory, width: number, height: number) {
        this.r = renderer;
        this.w = new DeltaWriter(this.r, memory);
        this.effectIndex = new Map(this.r.effect_names().map((n, i) => [n, i]));
        this.viewport = { w: width, h: height };
        this.shaders = new UserShaders(this.r, () => this.onShaderReady?.());
    }

    /** User WGSL programs on this device. */
    shaders!: UserShaders;
    /** Called when a user shader finishes compiling, so the host can draw again. */
    onShaderReady?: () => void;
    /** User shader problems seen while syncing, by message; drained by the host. */
    readonly shaderIssues = new Set<string>();

    /** Settles once every user shader seen so far is ready or failed (an export waits on this). */
    whenShadersReady(): Promise<void> {
        return this.shaders.whenReady();
    }

    private userProgram(scope: "fill" | "effect", source: string): UserProgram {
        const p = this.shaders.program(scope, source);
        const d = p.report.diagnostics[0] ?? p.browser.find((m) => m.message.startsWith("error"));
        if (p.state === "failed" && d) {
            this.shaderIssues.add(`A WGSL shader ${scope} does not compile${d.line ? ` (line ${d.line}:${d.column})` : ""}: ${d.message}`);
        }
        return p;
    }

    adapterInfo() {
        return this.r.adapter_info();
    }

    /** The `GPUDevice` this backend draws with (the page's shared one). */
    gpuDevice(): unknown {
        return this.r.gpu_device();
    }

    setOptions(linear: boolean, dither: boolean) {
        this.r.set_options(linear, dither);
    }

    resize(width: number, height: number) {
        this.r.resize(width, height);
        this.viewport = { w: width, h: height };
        this.synced = false;
    }

    private paint(p: Paint | undefined): number {
        if (!p) return NONE;
        const known = this.paintIds.get(p);
        if (known?.live) {
            known.used = this.generation;
            return known.id;
        }
        // Image paints key on the asset id, not its bytes or source.
        const key = p.kind === "image" ? `image:${p.image.id}:${p.fit ?? "fill"}:${p.box.join(",")}:${p.matrix?.join(",") ?? ""}:${p.tile ?? ""}`
            : p.kind === "shader" ? `shader:${this.userProgram("fill", p.source).id}:${p.box.join(",")}:${p.time}:${p.texture?.id ?? ""}:${JSON.stringify(p.uniforms)}`
            : JSON.stringify(p);
        let entry = this.paintByKey.get(key);
        if (entry) entry.used = this.generation;
        else {
            entry = { id: this.freePaints.pop() ?? this.nextPaint++, used: this.generation, live: true };
            this.paintByKey.set(key, entry);
            const id = entry.id;
            const w = this.w;
            if (p.kind === "procedural") {
                this.procedural(id, p);
                this.paintIds.set(p, entry);
                return id;
            }
            if (p.kind === "shader") {
                this.shaderPaint(id, p);
                this.paintIds.set(p, entry);
                return id;
            }
            const stops = p.kind === "solid" || p.kind === "image" ? [] : p.stops;
            w.begin(12 + stops.length * 5);
            w.u(OP.DEF_PAINT);
            w.u(id);
            if (p.kind === "solid") {
                w.u(0);
                for (let i = 0; i < 4; i++) w.f(0);
                for (const c of p.color) w.f(c);
            } else if (p.kind === "image") {
                // Local → normalized uv (the inverse of image px → local, over
                // the image size): geom = a b c d, color = e f id 0.
                const { m, tile } = imageMatrix(p);
                const det = m[0] * m[3] - m[1] * m[2] || 1;
                const W = p.image.width, H = p.image.height;
                const ia = m[3] / det, ib = -m[1] / det, ic = -m[2] / det, id = m[0] / det;
                const ie = (m[2] * m[5] - m[3] * m[4]) / det, iff = (m[1] * m[4] - m[0] * m[5]) / det;
                w.u(4 | (TILE[tile] << 8));
                w.f(ia / W); w.f(ib / H); w.f(ic / W); w.f(id / H);
                w.f(ie / W); w.f(iff / H); w.f(p.image.id); w.f(0);
            } else {
                const kind = p.kind === "linear" ? 1 : p.kind === "radial" ? 2 : 3;
                w.u(kind | (TILE[p.tile ?? "clamp"] << 8));
                if (p.kind === "linear") {
                    w.f(p.from[0]); w.f(p.from[1]); w.f(p.to[0]); w.f(p.to[1]);
                } else if (p.kind === "radial") {
                    w.f(p.center[0]); w.f(p.center[1]); w.f(p.radius); w.f(0);
                } else {
                    w.f(p.center[0]); w.f(p.center[1]); w.f(p.startAngle); w.f(p.endAngle);
                }
                for (const c of stops[0].color) w.f(c);
            }
            w.u(stops.length);
            for (const s of stops) {
                w.f(s.offset);
                for (const c of s.color) w.f(c);
            }
        }
        this.paintIds.set(p, entry);
        return entry.id;
    }

    /** The engine's procedural fills as paint kinds 5–9: geom/color plus raw
     *  vec4 parameter slots carried as stops (see prim.wgsl). */
    /** Paint kind 10: geom = box, color = time, texture image (−1 = none), program; stops = `Params` words. */
    private shaderPaint(id: number, p: Extract<Paint, { kind: "shader" }>) {
        const prog = this.userProgram("fill", p.source);
        const words = prog.report.ok ? packParams(prog.report.fields, prog.report.size, p.uniforms) : new Uint32Array(0);
        const stops = Math.ceil(words.length / 4);
        const w = this.w;
        w.begin(12 + stops * 5);
        w.u(OP.DEF_PAINT); w.u(id); w.u(10);
        for (const v of p.box) w.f(v);
        w.f(p.time); w.f(p.texture ? p.texture.id : -1); w.f(prog.id); w.f(0);
        w.u(stops);
        for (let s = 0; s < stops; s++) {
            w.f(0);
            for (let k = 0; k < 4; k++) w.u(words[s * 4 + k] ?? 0);
        }
    }

    private procedural(id: number, p: Extract<Paint, { kind: "procedural" }>) {
        const f = p.fill;
        const [bx, by, bw, bh] = p.box;
        let kind: number, geom: number[], color: number[];
        const slots: number[][] = [];
        const ramp: { offset: number; color: number[] }[] = [];
        const q8 = (c: readonly number[]) => [Math.round(c[0] * 255) / 255, Math.round(c[1] * 255) / 255, Math.round(c[2] * 255) / 255, c[3]];
        if (f.type === "dotGrid") {
            kind = 5;
            geom = [bx + f.offset.x, by + f.offset.y, Math.max(0.01, f.spacing), Math.max(0, f.radius)];
            color = [...f.color];
        } else if (f.type === "grid") {
            kind = 6;
            geom = [bx + f.offset.x, by + f.offset.y, bw, bh];
            color = [...f.color];
            slots.push([Math.max(0.0001, f.divisions), Math.max(1, Math.round(f.subdivisions)), Math.max(0, f.strokeWidth) * 0.5, Math.max(0, f.subdivisionWidth) * 0.5]);
        } else if (f.type === "stripe") {
            kind = 7;
            const rad = ((f.angle ?? -45) * Math.PI) / 180;
            geom = [bx, by, Math.max(1, Math.round(f.gap ?? 8)), f.strokeWidth ?? 1];
            color = q8(f.color ?? [0, 0, 0, 1]);
            slots.push([Math.cos(rad), Math.sin(rad), bx, 0]);
        } else if (f.type === "noise") {
            kind = 8;
            geom = [bx, by, Math.ceil(bw), Math.ceil(bh)];
            const c = q8(f.color);
            color = [c[0], c[1], c[2], Math.round(f.color[3] * 255) / 255];
            slots.push([Math.max(1, Math.round(f.size.x)), Math.max(1, Math.round(f.size.y)), Math.min(1, Math.max(0, f.density)), Math.round(f.seed)]);
        } else {
            kind = 9;
            geom = [bx, by, bw, bh];
            const rad = (f.angle * Math.PI) / 180;
            const basis = { value: 0, simplex: 1, ridged: 2, worley: 3 }[f.basis] ?? 1;
            slots.push([f.frequency.x, f.frequency.y, f.offset.x, f.offset.y]);
            slots.push([f.lacunarity, f.gain, f.seed, f.contrast]);
            slots.push([Math.cos(rad), Math.sin(rad), basis, f.octaves]);
            const n = Math.max(2, Math.min(8, f.colors.length));
            for (let i = 0; i < n; i++) {
                ramp.push({ offset: f.stops[Math.min(i, f.stops.length - 1)] ?? i / (n - 1), color: [...f.colors[Math.min(i, f.colors.length - 1)]] });
            }
            color = ramp[0].color;
        }
        const n = slots.length + ramp.length;
        const w = this.w;
        w.begin(12 + n * 5);
        w.u(OP.DEF_PAINT);
        w.u(id);
        w.u(kind);
        for (const v of geom) w.f(v);
        for (const v of color) w.f(v);
        w.u(n);
        for (const s of slots) { w.f(0); for (const v of s) w.f(v); }
        for (const s of ramp) { w.f(s.offset); for (const v of s.color) w.f(v); }
    }

    private pathId(d: PathData): number {
        const known = this.pathIds.get(d);
        if (known?.live) {
            known.used = this.generation;
            return known.id;
        }
        // By content, so a shape rebuilt unchanged keeps its id, and with it
        // every cache keyed on the path (outline, bands, distance field).
        const key = pathKey(d);
        const same = this.pathByKey.get(key);
        if (same) {
            same.used = this.generation;
            this.pathIds.set(d, same);
            return same.id;
        }
        const entry: Interned = { id: this.freePaths.pop() ?? this.nextPath++, used: this.generation, live: true };
        this.pathByKey.set(key, entry);
        const id = entry.id;
        const w = this.w;
        const vw = Math.ceil(d.verbs.length / 4);
        w.begin(4 + vw + d.points.length);
        w.u(OP.DEF_PATH);
        w.u(id);
        w.u(d.verbs.length);
        w.u(d.points.length / 2);
        for (let i = 0; i < vw; i++) {
            const v = d.verbs;
            const b = i * 4;
            w.u((v[b] ?? 0) | ((v[b + 1] ?? 0) << 8) | ((v[b + 2] ?? 0) << 16) | ((v[b + 3] ?? 0) << 24));
        }
        for (let i = 0; i < d.points.length; i++) w.f(d.points[i]);
        this.pathIds.set(d, entry);
        return id;
    }

    /** Frees the paths and paint ids `collectUnused` says nothing uses any more. */
    private sweep() {
        const before = this.generation - KEEP_UNUSED;
        for (const [key, e] of this.pathByKey) {
            if (e.used >= before) continue;
            e.live = false;
            this.pathByKey.delete(key);
            this.w.begin(2);
            this.w.u(OP.FREE_PATH); this.w.u(e.id);
            this.freePaths.push(e.id);
        }
        for (const [key, e] of this.paintByKey) {
            if (e.used >= before) continue;
            e.live = false;
            this.paintByKey.delete(key);
            this.freePaints.push(e.id);
        }
    }

    private dash(intervals: number[] | undefined, phase = 0): number {
        if (!intervals || intervals.length === 0) return NONE;
        const key = intervals.join(",") + "@" + phase;
        let id = this.dashIds.get(key);
        if (id === undefined) {
            id = this.nextDash++;
            this.dashIds.set(key, id);
            const w = this.w;
            w.begin(4 + intervals.length);
            w.u(OP.DEF_DASH);
            w.u(id);
            w.u(intervals.length);
            w.f(phase);
            for (const v of intervals) w.f(v);
        }
        return id;
    }

    private writeNode(n: Node, bits: number) {
        const w = this.w;
        const id = n.id;
        if (bits & D.CREATE) {
            w.begin(3);
            w.u(OP.CREATE); w.u(id); w.u(KIND_CODE[n.kind]);
        }
        if (bits & D.TRANSFORM) {
            const t = n.transform;
            if (isProjective(t)) {
                w.begin(11);
                w.u(OP.TRANSFORM3); w.u(id);
                for (const v of t) w.f(v);
            } else {
                // Affine (or a 3×3 with a trivial last row): six numbers.
                w.begin(8);
                w.u(OP.TRANSFORM); w.u(id);
                for (let k = 0; k < 6; k++) w.f(t[k]);
            }
        }
        if (bits & D.EFFECTS && (n.effects?.length || !(bits & D.CREATE))) this.writeEffects(n);
        if (bits & D.OPACITY && (n.opacity !== 1 || !(bits & D.CREATE))) {
            w.begin(3);
            w.u(OP.OPACITY); w.u(id); w.f(n.opacity);
        }
        if (bits & D.BLEND && (n.blend !== "normal" || !(bits & D.CREATE))) {
            w.begin(3);
            w.u(OP.BLEND); w.u(id); w.u(BLEND_MODES.indexOf(n.blend));
        }
        if (n.kind === "group") {
            if (bits & D.CLIP && (n.clip || !(bits & D.CREATE))) {
                const c = n.clip;
                const pid = c?.path ? this.pathId(c.path) : NONE;
                const r = c?.path ? pathBounds(c.path) : [c?.x ?? 0, c?.y ?? 0, (c?.x ?? 0) + (c?.w ?? 0), (c?.y ?? 0) + (c?.h ?? 0)];
                w.begin(10);
                w.u(OP.CLIP); w.u(id); w.u(c ? 1 : 0);
                for (const v of r) w.f(v);
                w.f(c?.r ?? 0); w.u(pid); w.u(c?.evenOdd ? 1 : 0);
            }
            if (bits & D.MASK && (n.mask || !(bits & D.CREATE))) {
                w.begin(3);
                w.u(OP.MASK); w.u(id); w.u(n.mask ? MASK_CODE[n.mask] : 0);
            }
            if (bits & D.FILTER && (n.filter || !(bits & D.CREATE))) {
                const f = n.filter;
                w.begin(10);
                w.u(OP.FILTER); w.u(id);
                if (!f) {
                    w.u(0); for (let i = 0; i < 7; i++) w.f(0);
                } else if (f.kind === "blur") {
                    w.u(1); w.f(f.sigma); for (let i = 0; i < 6; i++) w.f(0);
                } else {
                    w.u(2); w.f(f.sigma); w.f(f.dx); w.f(f.dy); for (const c of f.color) w.f(c);
                }
            }
            if (bits & D.CHILDREN) {
                w.begin(3 + n.children.length);
                w.u(OP.CHILDREN); w.u(id); w.u(n.children.length);
                for (const c of n.children) w.u(c.id);
            }
            return;
        }
        if (bits & D.SIZE) {
            w.begin(4);
            w.u(OP.SIZE); w.u(id); w.f(n.w); w.f(n.h);
        }
        if (bits & D.RADII && n.kind === "rect") {
            w.begin(6);
            w.u(OP.RADII); w.u(id);
            for (const v of n.radii) w.f(v);
        }
        if (bits & D.MEMBERS && n.members) {
            const ms = n.members;
            const pids = ms.map((m) => (m.kind === "path" && m.path ? this.pathId(m.path) : NONE));
            w.begin(3 + ms.length * 16);
            w.u(OP.MEMBERS); w.u(id); w.u(ms.length);
            ms.forEach((m, k) => {
                w.u(MEMBER_KIND[m.kind]); w.u(MEMBER_OP[memberOp(m)]);
                for (const v of m.transform ?? [1, 0, 0, 1, 0, 0]) w.f(v);
                w.f(m.w ?? 0); w.f(m.h ?? 0);
                for (const v of m.radii ?? [0, 0, 0, 0]) w.f(v);
                w.u(pids[k]); w.u(m.evenOdd ? 1 : 0);
            });
        }
        if (bits & D.TEXT && n.text) {
            const t = n.text;
            const strings = t.runs.map((r) => [utf8.encode(r.family), utf8.encode(r.text)] as const);
            const words = strings.reduce((a, [f, s]) => a + 2 + Math.ceil(f.length / 4) + Math.ceil(s.length / 4) + 6, 0);
            const pathId = t.path ? this.pathId(t.path) : NONE;
            const runPaints = t.runs.map((r) => this.paint(r.paint));
            w.begin(12 + words);
            w.u(OP.TEXT); w.u(id);
            w.u(ALIGN[t.align ?? "center"]); w.u(VALIGN[t.verticalAlign ?? "center"]); w.u(t.wrap ? 1 : 0);
            w.f(t.fontSize === "autofit" ? 0 : t.runs.length === 1 ? t.runs[0].size : 0); w.f(t.minFontSize ?? 0);
            w.f(t.lineHeight ?? 0); w.f(t.width ?? 0); w.f(t.height ?? 0);
            w.u(t.runs.length);
            t.runs.forEach((r, k) => {
                w.u(r.decoration === "underline" ? 1 : r.decoration === "lineThrough" ? 2 : 0);
                w.u(runPaints[k]);
                w.f(r.size); w.f(r.weight ?? 400); w.u(r.italic ? 1 : 0); w.f(r.letterSpacing ?? 0);
                for (const bytes of strings[k]) {
                    w.u(bytes.length);
                    for (let i = 0; i < bytes.length; i += 4) {
                        w.u((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16) | ((bytes[i + 3] ?? 0) << 24));
                    }
                }
            });
            w.u(pathId);
        }
        if (bits & D.PATH && n.path) {
            const pid = this.pathId(n.path);
            w.begin(4);
            w.u(OP.PATH); w.u(id); w.u(pid); w.u(n.evenOdd ? 1 : 0);
        }
        if (bits & D.FILL) {
            const p = this.paint(n.fill);
            w.begin(3);
            w.u(OP.FILL); w.u(id); w.u(p);
        }
        if (bits & D.STROKE && (n.stroke || !(bits & D.CREATE))) {
            const s = n.stroke;
            const p = this.paint(s?.paint);
            const dash = this.dash(s?.dash, s?.dashPhase);
            w.begin(8);
            w.u(OP.STROKE); w.u(id); w.u(p);
            w.f(s?.width ?? 0); w.u(JOIN[s?.join ?? "miter"]); w.u(CAP[s?.cap ?? "butt"]); w.f(s?.miter ?? 4); w.u(dash);
        }
        if (bits & D.SHADOWS && (n.shadows.length || !(bits & D.CREATE))) {
            w.begin(3 + n.shadows.length * 8);
            w.u(OP.SHADOWS); w.u(id); w.u(n.shadows.length);
            for (const s of n.shadows) {
                w.f(s.dx); w.f(s.dy); w.f(s.sigma); w.f(s.spread);
                for (const c of s.color) w.f(c);
            }
        }
    }

    private uploaded = new Map<number, number>();
    /** What 3D scenes recorded that the encoder doesn't carry yet. */
    readonly missing3d = new Set<string>();
    /** Per 3D scene asset, its texture ids (stable across versions). */
    private textures3d = new Map<number, TextureTable>();
    /** Per 3D scene asset, the geometry its renderer keeps. */
    private geometries3d = new Map<number, GeometryTable>();

    /** Uploads a scene's new data textures, and binds its images and surfaces
     *  from the image store (converted on the GPU). Image ids restart with
     *  every frame's doc, so a bind made on an earlier frame can name another
     *  asset now, the scene's own target included: every image and surface the
     *  scene has asked for is bound again, to this frame's id, on every sync. */
    private bindTextures3d(img: ImageAsset, table: TextureTable) {
        const fresh = new Set(table.pending.splice(0));
        for (const req of fresh) {
            const t = req.texture;
            if ("data" in t) this.r.scene3d_pixels(img.id, req.id, Uint8Array.from(t.data as ArrayLike<number>), t.width, t.height, req.srgb);
        }
        for (const req of table.all.values()) {
            const t = req.texture;
            if ("data" in t) continue;
            const source = "src" in t ? img.links3d?.images?.[t.src] : img.links3d?.surfaces?.get(t);
            if (source) this.r.scene3d_bind(img.id, req.id, source.id, req.srgb);
            else if (fresh.has(req)) this.missing3d.add("src" in t ? `image:${t.src}` : "surface");
        }
    }
    private scene3dSigs = new Map<number, string>();
    /** Ids are positional per frame, so a scene's id can turn into a surface or
     *  an image; the renderer drops that scene, and so must what is kept for it. */
    private forgetScene3d(id: number) {
        this.textures3d.delete(id);
        this.geometries3d.delete(id);
        this.scene3dSigs.delete(id);
    }
    /** The last sync's 3D encode (and signature) time and words. */
    private encode3dMs = 0;
    private words3d = 0;
    private effectIndex = new Map<string, number>();
    private auxIds = new Map<string, number>();
    /** Effect types with no WGSL port, as met. */
    readonly missing = new Set<string>();

    /** Effect `type`s this renderer has a WGSL port for. */
    effectTypes(): string[] {
        return [...this.effectIndex.keys()].filter((t) => PORTS.has(t));
    }

    private auxId(aux: AuxTexture | undefined): number {
        if (!aux) return NONE;
        let id = this.auxIds.get(aux.key);
        if (id === undefined) {
            id = 1_000_000 + this.auxIds.size;
            const c = new OffscreenCanvas(aux.width, aux.height);
            c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(aux.pixels), aux.width, aux.height), 0, 0);
            this.r.upload_image(id, c, false);
            this.auxIds.set(aux.key, id);
        }
        return id;
    }

    /** OP_EFFECTS: shader-surface effects first, then filter-surface ones (the engine's order). */
    private writeEffects(n: Node) {
        type E = { type: string; clip?: boolean; mode?: string };
        const list = (n.effects ?? []) as E[];
        const packed: { index: number; flags: number; aux: number; p: Packed; words?: Uint32Array }[] = [];
        // Foreground: shader effects, then filters (the engine's order). Backdrop
        // (flag bit 1): the composed filter layer first, then shader effects.
        const passes = [["shader", false], ["filter", false], ["filter", true], ["shader", true]] as const;
        for (const [surface, backdrop] of passes) {
            for (const e of list) {
                if (e.type === "shader") {
                    // Core's surface: a backdrop shader is a shader-surface effect, a foreground one a filter.
                    if ((e.mode === "backdrop") !== backdrop || (backdrop ? "shader" : "filter") !== surface) continue;
                    const fx = this.userEffect(e as unknown as UserEffect);
                    if (fx) packed.push({ ...fx, flags: (e.clip ? 1 : 0) | (backdrop ? 2 : 0) });
                    continue;
                }
                const port = PORTS.get(e.type);
                const index = this.effectIndex.get(e.type);
                if (!port || index === undefined) {
                    if (!this.missing.has(e.type)) console.info(`effect "${e.type}" has no WGSL port yet; skipped`);
                    this.missing.add(e.type);
                    continue;
                }
                if (port.surface !== surface || (e.mode === "backdrop") !== backdrop) continue;
                if (port.backdropOnly && !backdrop) continue;
                const p = port.pack(e);
                if (!p) continue;
                packed.push({ index, flags: (e.clip ? 1 : 0) | (backdrop ? 2 : 0) | (backdrop && surface === "filter" ? 4 : 0) | (p.field ? 8 : 0), aux: this.auxId(p.aux), p });
            }
        }
        const w = this.w;
        const box = n.effectBox ?? [0, 0, 0, 0];
        w.begin(8 + packed.reduce((a, x) => a + 8 + x.p.params.length + (x.words?.length ?? 0), 0));
        w.u(OP.EFFECTS); w.u(n.id);
        for (const v of box) w.f(v);
        w.f(n.effectTime ?? 0);
        w.u(packed.length);
        for (const x of packed) {
            w.u(x.index); w.u(x.flags); w.u(x.aux); w.f(x.p.reach ?? 0);
            const b = x.p.blur ?? [0, 0, 0];
            w.f(b[0]); w.f(b[1]); w.f(b[2]);
            w.u(x.p.params.length + (x.words?.length ?? 0));
            for (const v of x.p.params) w.f(v);
            if (x.words) for (const v of x.words) w.u(v);
        }
    }

    /** A user WGSL effect: params = [blend + 1 (0 = replace)], then its `Params` words. */
    private userEffect(e: UserEffect): { index: number; aux: number; p: Packed; words: Uint32Array } | null {
        if (!e.source?.trim()) return null;
        if (!isWgslShader(e)) {
            this.shaderIssues.add(SKSL_EFFECT);
            return null;
        }
        const prog = this.userProgram("effect", e.source);
        if (!prog.report.ok) return null;
        const uniforms = normalizeUniforms(e.uniforms as Parameters<typeof normalizeUniforms>[0]);
        const blend = e.mode !== "backdrop" && e.blendMode ? (EFFECT_BLEND[e.blendMode] ?? -1) + 1 : 0;
        return { index: USER_EFFECT + prog.id, aux: NONE, p: { params: [blend], reach: Math.max(0, e.reach ?? 0) }, words: packParams(prog.report.fields, prog.report.size, uniforms) };
    }
    private frameCanvases = new Map<number, OffscreenCanvas>();

    /**
     * Video frames go through a (GPU-backed) 2D canvas first. Chrome's WebGPU
     * external-image copy also converts the BT.709 transfer curve to sRGB,
     * lifting darks and mids by up to 10/255; canvas 2D, players and the
     * engine's current video path apply the YUV matrix only. Still a GPU path,
     * no readback.
     */
    private colorCorrect(img: Doc["images"][number]): Doc["images"][number]["source"] {
        if (typeof VideoFrame === "undefined" || !(img.source instanceof VideoFrame)) return img.source;
        let c = this.frameCanvases.get(img.id);
        if (!c || c.width !== img.width || c.height !== img.height) {
            c = new OffscreenCanvas(img.width, img.height);
            this.frameCanvases.set(img.id, c);
        }
        c.getContext("2d")!.drawImage(img.source, 0, 0);
        return c;
    }

    sync(doc: Doc) {
        this.generation++;
        this.encode3dMs = 0;
        this.words3d = 0;
        // Images first: a GPU copy per new asset or video frame version.
        for (const img of doc.images) {
            if (this.uploaded.get(img.id) === img.version) continue;
            if (img.surface) {
                this.forgetScene3d(img.id);
                this.r.set_surface(img.id, img.surface.id, img.width, img.height);
            } else if (img.scene3d) {
                const k = this.viewport.w / doc.width;
                const report = { unsupported: new Set<string>() };
                let table = this.textures3d.get(img.id);
                if (!table) this.textures3d.set(img.id, (table = new TextureTable()));
                const [pw, ph] = img.scale3d ? [Math.ceil(img.width * img.scale3d), Math.ceil(img.height * img.scale3d)] : [Math.round(img.width * k), Math.round(img.height * k)];
                const t0 = performance.now();
                let geometries = this.geometries3d.get(img.id);
                if (!geometries) this.geometries3d.set(img.id, (geometries = new GeometryTable()));
                const words = encodeScene3D(img.scene3d, report, table, geometries);
                // A scene handed over again unchanged (every frame, when the
                // caller rebuilds its document) keeps what is already drawn.
                const sig = `${pw}x${ph}:${words.length}:${hashWords(words)}`;
                this.encode3dMs += performance.now() - t0;
                this.words3d += words.length;
                if (this.scene3dSigs.get(img.id) !== sig) {
                    try {
                        this.r.set_scene3d(img.id, pw, ph, words);
                    } catch (e) {
                        // The renderer didn't take this frame's defs: start over.
                        this.geometries3d.delete(img.id);
                        this.scene3dSigs.delete(img.id);
                        throw e;
                    }
                    this.scene3dSigs.set(img.id, sig);
                }
                for (const u of report.unsupported) this.missing3d.add(u);
                this.bindTextures3d(img, table);
            } else {
                this.forgetScene3d(img.id);
                this.r.upload_image(img.id, this.colorCorrect(img), img.mipmaps);
            }
            this.uploaded.set(img.id, img.version);
        }
        const w = this.w;
        if (!this.synced) {
            // Full upload: create every node first so CHILDREN can refer to them.
            for (const n of doc.nodes) this.writeNode(n, D.ALL);
            w.begin(2);
            w.u(OP.ROOT); w.u(doc.root.id);
            w.begin(8);
            w.u(OP.VIEWPORT); w.u(this.viewport.w); w.u(this.viewport.h); w.f(this.viewport.w / doc.width);
            for (const c of doc.background) w.f(c);
            this.synced = true;
        } else {
            for (const n of doc.dirty) this.writeNode(n, n.dirty);
        }
        for (const n of doc.dirty) n.dirty = 0;
        doc.dirty.clear();
        if (this.collectUnused && this.generation % 30 === 0) this.sweep();
        w.flush();
        this.lastDeltaWords = w.takeCount();
    }

    render() {
        this.r.render();
    }

    invalidate() {
        this.r.invalidate();
    }

    waitGpu(): Promise<void> {
        return this.r.wait_gpu();
    }

    async readPixels(): Promise<Uint8Array> {
        return (await this.r.read_pixels()) as Uint8Array;
    }

    stats(): Record<string, number> {
        const s = this.r.stats();
        return {
            buildMs: s[0], encodeMs: s[1], applyMs: s[2], prims: s[3], ops: s[4], layers: s[5],
            passes: s[6], draws: s[7], culled: s[8], tessellated: s[9], poolTextures: s[10],
            poolMiB: s[11], geomVertices: s[12], reusedPrims: s[13], cleanPrims: s[14], deltaWords: this.lastDeltaWords,
            scene3dEncodeMs: this.encode3dMs, scene3dWords: this.words3d, scene3dSetMs: s[15], scene3dDrawMs: s[16], scene3dMapsMs: s[17], surfacesDrawn: s[18], surfaces: s[19],
        };
    }

    registerFont(bytes: Uint8Array, family: string) {
        this.r.register_font(bytes, family);
    }

    destroy() {
        this.r.free();
    }
}
