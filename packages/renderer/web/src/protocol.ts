// Writer for the delta protocol (crates/renderer/src/protocol.rs). Words go
// straight into the renderer's buffer inside WASM linear memory: no
// intermediate JS array, one `apply` call per flush.

export const OP = {
    CREATE: 1,
    DESTROY: 2,
    CHILDREN: 3,
    TRANSFORM: 4,
    SIZE: 5,
    RADII: 6,
    FILL: 7,
    STROKE: 8,
    SHADOWS: 9,
    OPACITY: 10,
    BLEND: 11,
    CLIP: 12,
    FILTER: 13,
    PATH: 14,
    MEMBERS: 15,
    MASK: 16,
    TEXT: 17,
    EFFECTS: 18,
    TRANSFORM3: 19,
    DEF_PAINT: 20,
    DEF_PATH: 21,
    DEF_DASH: 22,
    FREE_PATH: 24,
    ROOT: 30,
    VIEWPORT: 31,
} as const;

export const NONE = 0xffffffff;

interface DeltaSink {
    delta_buffer(minWords: number): number;
    delta_capacity(): number;
    apply(words: number): void;
}

export class DeltaWriter {
    private u32!: Uint32Array;
    private f32!: Float32Array;
    private pos = 0;
    private cap = 0;
    /** Words written since the last `takeCount`. */
    written = 0;

    constructor(private readonly sink: DeltaSink, private readonly memory: WebAssembly.Memory) {
        this.refresh(0);
    }

    private refresh(minWords: number) {
        const ptr = this.sink.delta_buffer(minWords);
        this.cap = this.sink.delta_capacity();
        this.u32 = new Uint32Array(this.memory.buffer, ptr, this.cap);
        this.f32 = new Float32Array(this.memory.buffer, ptr, this.cap);
    }

    /** Reserve room for a record of `n` words. */
    begin(n: number) {
        if (this.u32.buffer !== this.memory.buffer) this.refresh(0);
        if (this.pos + n > this.cap) {
            this.flush();
            if (n > this.cap) this.refresh(n);
        }
    }

    u(v: number) {
        this.u32[this.pos++] = v >>> 0;
    }

    f(v: number) {
        this.f32[this.pos++] = v;
    }

    flush() {
        if (this.pos > 0) {
            this.written += this.pos;
            this.sink.apply(this.pos);
            this.pos = 0;
        }
        // `apply` may grow WASM memory, which detaches our views.
        if (this.u32.buffer !== this.memory.buffer) this.refresh(0);
    }

    takeCount() {
        const n = this.written;
        this.written = 0;
        return n;
    }
}
