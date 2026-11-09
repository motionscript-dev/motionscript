// User shaders: WGSL fills and effects written against the contract in
// DESIGN.md §6.3. naga (in the WASM) validates and reflects a source at once;
// the browser then compiles its pipelines asynchronously, and only when they
// are ready does the renderer draw with them. A frame never waits: until then
// the fill draws nothing and the effect passes its input through.

import { validate_shader } from "../pkg/ms_renderer.js";
import type { Renderer } from "../pkg/ms_renderer.js";

export type ShaderScope = "fill" | "effect";

/** One problem in an author's source. `line`/`column` are 1-based; 0 = not in the source. */
export interface ShaderDiagnostic {
    line: number;
    column: number;
    length: number;
    message: string;
    /** `naga`: the renderer's validation; `browser`: the GPU's own compile. */
    source: "naga" | "browser";
}

/** One member of the source's `struct Params`, as WGSL's uniform layout places it. */
export interface ShaderField {
    name: string;
    /** Byte offset in `Params`. */
    offset: number;
    /** 0 f32, 1 i32, 2 u32. */
    scalar: number;
    /** Components per element (1–4). */
    components: number;
    /** Elements (array length or matrix columns), `stride` bytes apart. */
    elements: number;
    stride: number;
    /** The WGSL type (`vec3<f32>`, `array<vec4<f32>, 4>`). */
    type: string;
}

export interface ShaderReport {
    ok: boolean;
    diagnostics: ShaderDiagnostic[];
    fields: ShaderField[];
    /** Size of `Params` in bytes. */
    size: number;
    /** The assembled module (header, renderer code, the author's). */
    wgsl?: string;
}

const KIND = { fill: 0, effect: 1 } as const;

function parse(json: string): ShaderReport {
    const r = JSON.parse(json) as ShaderReport;
    for (const d of r.diagnostics) d.source = "naga";
    return r;
}

/** Validates a source with naga; needs the renderer's WASM loaded (`loadRendererWasm`). */
export function validateShader(scope: ShaderScope, source: string): ShaderReport {
    return parse(validate_shader(KIND[scope], source));
}

type Values = Record<string, number | readonly number[]>;

/**
 * Named values as `Params` bytes (as u32 words, so integer bit patterns cross
 * intact). A field without a value reads as 0; a value with no field is ignored.
 */
export function packParams(fields: readonly ShaderField[], size: number, values: Values): Uint32Array {
    const words = new Uint32Array(Math.ceil(size / 4));
    const f32 = new Float32Array(words.buffer);
    const i32 = new Int32Array(words.buffer);
    for (const f of fields) {
        const v = values[f.name];
        if (v === undefined) continue;
        const flat = typeof v === "number" ? [v] : v.flat(Infinity as 1) as number[];
        for (let e = 0; e < f.elements; e++) {
            for (let c = 0; c < f.components; c++) {
                const x = flat[e * f.components + c];
                if (x === undefined) continue;
                const at = (f.offset + e * f.stride + c * 4) >> 2;
                if (at >= words.length) continue;
                if (f.scalar === 0) f32[at] = x;
                else if (f.scalar === 1) i32[at] = Math.round(x);
                else words[at] = Math.max(0, Math.round(x));
            }
        }
    }
    return words;
}

export type ProgramState = "compiling" | "ready" | "failed";

export interface UserProgram {
    id: number;
    scope: ShaderScope;
    report: ShaderReport;
    state: ProgramState;
    /** The browser's own messages (`getCompilationInfo`), once compiled. */
    browser: ShaderDiagnostic[];
    /** Settles when the program is ready or has failed. */
    settled: Promise<void>;
}

/** Max programs kept per device before the least recently used go. */
const MAX_PROGRAMS = 64;

/**
 * How long the browser may take to compile a program and its pipelines. A
 * compile that never settles would hold an export waiting on it forever.
 */
export const COMPILE_TIMEOUT_MS = 10_000;

function withinTimeout<T>(work: Promise<T>, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the browser took over ${COMPILE_TIMEOUT_MS / 1000} s to ${what}`)), COMPILE_TIMEOUT_MS);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** One device's user programs, by scope and source. */
export class UserShaders {
    private programs = new Map<string, UserProgram>();
    private nextId = 0;
    private pending = new Set<Promise<void>>();

    /** `onReady` runs when a program becomes drawable, so its host can draw again. */
    constructor(private readonly r: Renderer, private readonly onReady: () => void) {}

    /** The program for `source`, added (and compiling) on first use. */
    program(scope: ShaderScope, source: string): UserProgram {
        const key = `${scope}\n${source}`;
        const known = this.programs.get(key);
        if (known) {
            // Most recently used last.
            this.programs.delete(key);
            this.programs.set(key, known);
            return known;
        }
        if (this.programs.size >= MAX_PROGRAMS) {
            const [oldKey, old] = this.programs.entries().next().value!;
            this.programs.delete(oldKey);
            if (old.state !== "compiling") this.r.shader_remove(old.id);
        }
        const id = this.nextId++;
        const report = parse(this.r.shader_add(id, KIND[scope], source));
        const p: UserProgram = { id, scope, report, state: report.ok ? "compiling" : "failed", browser: [], settled: Promise.resolve() };
        if (report.ok) {
            const settled = this.compile(p).finally(() => this.pending.delete(settled));
            this.pending.add(settled);
            p.settled = settled;
        }
        this.programs.set(key, p);
        return p;
    }

    /** Whether a program is still compiling. */
    hasPending(): boolean {
        return this.pending.size > 0;
    }

    /** Settles once every program added so far is ready or has failed (export waits on this). */
    async whenReady(): Promise<void> {
        while (this.pending.size) await Promise.all([...this.pending]);
    }

    /**
     * The browser's compile of the module, then its pipelines, asynchronously
     * (`createRenderPipelineAsync`, descriptors mirroring gpu.rs). The
     * renderer's own pipelines are created after, from the same descriptors,
     * which the browser serves from its cache.
     */
    private async compile(p: UserProgram): Promise<void> {
        const device = this.r.gpu_device() as any;
        const wgsl = p.report.wgsl!;
        try {
            if (device) {
                const module = device.createShaderModule({ code: wgsl });
                const info = await withinTimeout<{ messages: any[] }>(module.getCompilationInfo(), "compile it");
                p.browser = browserDiagnostics(info.messages, wgsl);
                if (info.messages.some((m: { type: string }) => m.type === "error")) {
                    p.state = "failed";
                    this.r.shader_remove(p.id);
                    return;
                }
                const formats = this.r.shader_formats(KIND[p.scope]);
                const warm = await withinTimeout(Promise.all(formats.map((f) => device.createRenderPipelineAsync(pipelineDesc(device, module, p.scope, f)).catch(() => null))), "build its pipelines");
                this.r.shader_build(p.id);
                void warm;
            } else {
                this.r.shader_build(p.id);
            }
            p.state = "ready";
            this.onReady();
        } catch (e) {
            p.state = "failed";
            p.browser.push({ line: 0, column: 0, length: 0, message: `error: ${String((e as Error)?.message ?? e)}`, source: "browser" });
        }
    }
}

/** `GPUCompilationMessage`s located in the author's code (after the marker line). */
function browserDiagnostics(messages: readonly any[], wgsl: string): ShaderDiagnostic[] {
    const marker = wgsl.indexOf("// ── the author's code ──\n");
    const userLine = marker < 0 ? 0 : wgsl.slice(0, marker).split("\n").length + 1;
    return messages.map((m) => {
        const line = m.lineNum >= userLine && userLine > 0 ? m.lineNum - userLine + 1 : 0;
        return { line, column: line ? m.linePos : 0, length: m.length ?? 0, message: `${m.type}: ${m.message}`, source: "browser" as const };
    });
}

const VIS = 3; // VERTEX | FRAGMENT

/**
 * gpu.rs's bind group layouts for user pipelines, by group, one entry per
 * binding from 0. `layout_parity_test.rs` holds them equal to gpu.rs's.
 */
export const USER_LAYOUTS = {
    fill: [
        ["uniform", "storage", "storage", "storage", "storage", "storage", "unfilterable-2d-array", "storage"],
        ["texture", "sampler"],
        ["uniform"],
    ],
    effect: [
        ["texture", "texture", "texture", "sampler", "sampler", "uniform", "texture"],
        ["uniform"],
    ],
} as const;

const ENTRY: Record<string, object> = {
    uniform: { buffer: { type: "uniform", hasDynamicOffset: true } },
    storage: { buffer: { type: "read-only-storage" } },
    texture: { texture: { sampleType: "float", viewDimension: "2d" } },
    sampler: { sampler: { type: "filtering" } },
    "unfilterable-2d-array": { texture: { sampleType: "unfilterable-float", viewDimension: "2d-array" } },
};

function layouts(device: any, scope: ShaderScope): any[] {
    return USER_LAYOUTS[scope].map((group) => device.createBindGroupLayout({ entries: group.map((kind, binding) => ({ binding, visibility: VIS, ...ENTRY[kind] })) }));
}

function pipelineDesc(device: any, module: any, scope: ShaderScope, format: string): object {
    const over = { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" };
    const fill = scope === "fill";
    return {
        layout: device.createPipelineLayout({ bindGroupLayouts: layouts(device, scope) }),
        vertex: { module, entryPoint: fill ? "ms_vs_quad" : "ms_vs_effect", buffers: [] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        multisample: { count: 1 },
        fragment: {
            module,
            entryPoint: fill ? "ms_fs_prim" : "ms_fs_effect",
            targets: [{ format, ...(fill ? { blend: { color: over, alpha: over } } : {}), writeMask: 0xf }],
        },
    };
}

/** Core's blend names → the effect header's `blend_mode` index (+1 on the wire; 0 = replace). */
export const EFFECT_BLEND: Record<string, number> = {
    normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, "color-dodge": 6, "color-burn": 7,
    "hard-light": 8, "soft-light": 9, difference: 10, exclusion: 11, hue: 12, saturation: 13, color: 14, luminosity: 15,
};

/** What a host is told about a shader stored with `language: "sksl"` from before Motion Script ran only WGSL. */
export const SKSL_FILL = "A shader fill is written in SkSL, which Motion Script no longer runs, so it draws nothing. Port it to WGSL (fn fill(in: FillIn) -> vec4f).";
export const SKSL_EFFECT = "A shader effect is written in SkSL, which Motion Script no longer runs, so it is skipped. Port it to WGSL (fn effect(in: EffectIn) -> vec4f).";
