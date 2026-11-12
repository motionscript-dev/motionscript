// The renderer's calls, recorded as an export stream for a native host process
// to replay on the GPU and encode. The backend drives a RecordingRenderer
// exactly as it drives the WASM Renderer; crates/renderer/src/replay.rs reads
// the stream, and its tests hold REC and STREAM_VERSION to its own.

import { validate_shader } from "../../pkg/ms_renderer.js";

export const STREAM_MAGIC = 0x3158_534d; // "MSX1"
export const STREAM_VERSION = 1;

export const REC = {
    BEGIN: 1, APPLY: 2, FONT: 3, IMAGE: 4, SURFACE: 5, SCENE3D: 6, SCENE3D_BIND: 7, SCENE3D_PIXELS: 8,
    FREE_IMAGE: 9, SHADER_ADD: 10, SHADER_BUILD: 11, SHADER_REMOVE: 12, OPTIONS: 13, RESIZE: 14,
    FRAME: 15, AUDIO: 16, END: 17, INVALIDATE: 18, CREATE: 19,
} as const;
export const NATIVE_RECORD = REC;

const utf8 = new TextEncoder();

/** A growable little-endian byte buffer of whole records. */
export class StreamWriter {
    private buf = new Uint8Array(1 << 20);
    private view = new DataView(this.buf.buffer);
    private pos = 0;
    /** Bytes handed out by `take` so far. */
    taken = 0;

    constructor() {
        this.u32(STREAM_MAGIC);
        this.u32(STREAM_VERSION);
    }

    get size(): number {
        return this.pos;
    }

    private reserve(n: number) {
        if (this.pos + n <= this.buf.length) return;
        let cap = this.buf.length * 2;
        while (cap < this.pos + n) cap *= 2;
        const next = new Uint8Array(cap);
        next.set(this.buf.subarray(0, this.pos));
        this.buf = next;
        this.view = new DataView(next.buffer);
    }

    private u32(v: number) {
        this.reserve(4);
        this.view.setUint32(this.pos, v >>> 0, true);
        this.pos += 4;
    }

    /**
     * One record: `words` (u32s, numbers or a typed array viewed as words),
     * then `tail` bytes; padded to 4 bytes.
     */
    record(op: number, words: ArrayLike<number>, tail?: Uint8Array) {
        const len = words.length * 4 + (tail?.length ?? 0);
        const padded = (len + 3) & ~3;
        this.reserve(8 + padded);
        this.view.setUint32(this.pos, op, true);
        this.view.setUint32(this.pos + 4, len, true);
        this.pos += 8;
        for (let i = 0; i < words.length; i++) {
            this.view.setUint32(this.pos, words[i] >>> 0, true);
            this.pos += 4;
        }
        if (tail) {
            this.buf.set(tail, this.pos);
            this.pos += tail.length;
        }
        this.buf.fill(0, this.pos, this.pos + padded - len);
        this.pos += padded - len;
    }

    /** A record whose payload is raw words straight from a Uint32Array (APPLY, SCENE3D). */
    recordWords(op: number, head: ArrayLike<number>, words: Uint32Array) {
        const bytes = new Uint8Array(words.buffer, words.byteOffset, words.length * 4);
        this.record(op, head, bytes);
    }

    /** Everything written since the last call (a copy the caller owns). */
    take(): Uint8Array {
        const out = this.buf.slice(0, this.pos);
        this.taken += this.pos;
        this.pos = 0;
        return out;
    }
}

/** RGBA8 rows of an image source (straight alpha), read through a 2D canvas. */
function pixelsOf(source: CanvasImageSource & { width?: number; height?: number }, scratch: { c?: OffscreenCanvas }): { w: number; h: number; rgba: Uint8Array } {
    const s = source as { displayWidth?: number; displayHeight?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
    const w = s.displayWidth ?? s.naturalWidth ?? s.videoWidth ?? s.width ?? 0;
    const h = s.displayHeight ?? s.naturalHeight ?? s.videoHeight ?? s.height ?? 0;
    if (!w || !h) throw new Error("upload_image: empty source");
    let c = scratch.c;
    if (!c || c.width !== w || c.height !== h) c = scratch.c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    return { w, h, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

/**
 * Stands in for the WASM `Renderer` (`pkg/ms_renderer.d.ts`): every call that
 * changes what is drawn is appended to `out`. Text, shader validation and the
 * delta encoding still run here, in JS and the renderer's WASM, exactly as for
 * a canvas; nothing touches a GPU.
 */
export class RecordingRenderer {
    readonly memory = new WebAssembly.Memory({ initial: 4 });
    private scratch: { c?: OffscreenCanvas } = {};
    /** Images uploaded, and how long reading their pixels took (ms). */
    imageUploads = 0;
    imageMs = 0;

    constructor(readonly out: StreamWriter, private readonly effects: readonly string[], width: number, height: number) {
        out.record(REC.CREATE, [width, height]);
    }

    delta_buffer(minWords: number): number {
        const need = minWords * 4;
        if (this.memory.buffer.byteLength < need) this.memory.grow(Math.ceil((need - this.memory.buffer.byteLength) / 65536));
        return 0;
    }

    delta_capacity(): number {
        return this.memory.buffer.byteLength / 4;
    }

    apply(words: number) {
        if (words > 0) this.out.recordWords(REC.APPLY, [], new Uint32Array(this.memory.buffer, 0, words));
    }

    effect_names(): string[] {
        return [...this.effects];
    }

    adapter_info(): string {
        return "native export host";
    }

    gpu_device(): null {
        return null;
    }

    set_options(linear: boolean, dither: boolean) {
        this.out.record(REC.OPTIONS, [+linear, +dither]);
    }

    resize(width: number, height: number) {
        this.out.record(REC.RESIZE, [width, height]);
    }

    register_font(bytes: Uint8Array, family: string): number {
        const name = utf8.encode(family);
        const padded = new Uint8Array(((name.length + 3) & ~3) + bytes.length);
        padded.set(name);
        padded.set(bytes, (name.length + 3) & ~3);
        this.out.record(REC.FONT, [name.length], padded);
        return 0;
    }

    upload_image(id: number, source: CanvasImageSource, mipmaps: boolean) {
        const t0 = performance.now();
        const { w, h, rgba } = pixelsOf(source as never, this.scratch);
        this.out.record(REC.IMAGE, [id, w, h, mipmaps ? 1 : 0], rgba);
        this.imageUploads++;
        this.imageMs += performance.now() - t0;
    }

    set_scene3d(id: number, width: number, height: number, words: Uint32Array | number[]) {
        this.out.recordWords(REC.SCENE3D, [id, width, height], words instanceof Uint32Array ? words : Uint32Array.from(words));
    }

    set_surface(id: number, root: number, width: number, height: number) {
        this.out.record(REC.SURFACE, [id, root, width, height]);
    }

    scene3d_bind(scene: number, tex: number, image: number, srgb: boolean) {
        this.out.record(REC.SCENE3D_BIND, [scene, tex, image, +srgb]);
    }

    scene3d_pixels(scene: number, tex: number, rgba: Uint8Array, width: number, height: number, srgb: boolean) {
        this.out.record(REC.SCENE3D_PIXELS, [scene, tex, width, height, +srgb], rgba);
    }

    scene3d_skipped(_id: number): string[] {
        return [];
    }

    free_image(id: number) {
        this.out.record(REC.FREE_IMAGE, [id]);
    }

    /** Validated here (the same naga build the host runs), recorded for the host to compile. */
    shader_add(id: number, kind: number, source: string): string {
        const report = validate_shader(kind, source);
        if (JSON.parse(report).ok) this.out.record(REC.SHADER_ADD, [id, kind], utf8.encode(source));
        return report;
    }

    shader_build(id: number) {
        this.out.record(REC.SHADER_BUILD, [id]);
    }

    shader_remove(id: number) {
        this.out.record(REC.SHADER_REMOVE, [id]);
    }

    shader_formats(_kind: number): string[] {
        return [];
    }

    /** A frame is encoded when the export's sink says so (`REC.FRAME`), not per render. */
    render() {}

    invalidate() {
        this.out.record(REC.INVALIDATE, []);
    }

    wait_gpu(): Promise<void> {
        return Promise.resolve();
    }

    read_pixels(): Promise<Uint8Array> {
        return Promise.reject(new Error("A native export surface cannot be read back."));
    }

    stats(): Float64Array {
        return new Float64Array(20);
    }

    free() {}
}
