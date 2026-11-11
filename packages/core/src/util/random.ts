/** Deterministic mulberry32 PRNG: the same seed gives the same sequence. Scene authors use the {@link Random} facade from `stage.random(seed)`, which wraps this. */
export class SeedGenerator {
    private state: number = 0;

    constructor(seed: string | number) {
        this.setSeed(seed);
    }

    /** String seeds are hashed via djb2 into a 32-bit integer. */
    setSeed(seed: string | number) {
        this.state = typeof seed === 'string'
            ? seed.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0)
            : seed;
    }

    next() {
        this.state |= 0; this.state = this.state + 0x6D2B79F5 | 0;
        var t = Math.imul(this.state ^ this.state >>> 15, 1 | this.state);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

/** Upper bound of {@link Random.nextInt} / {@link Random.intArray} (2^32). */
const UINT32_RANGE = 4294967296;

/**
 * A seeded random source handed out by `stage.random(seed)`; wraps a {@link SeedGenerator} (mulberry32). Determinism
 * is scoped per source: scenes each get their own reproducible stream without a shared stage-level seed.
 *
 * Two families that are NOT interchangeable: **independent draws** (`nextFloat`/`nextInt`/`gauss` and array forms,
 * uncorrelated; `gauss` changes only the distribution) and the **correlated field** `noise(t)`, where nearby inputs
 * give nearby values, the right tool for smooth motion (drift, shake, waves).
 */
export class Random {
    /** The seed this source rewinds to; set by {@link adopt}. */
    private _seed!: string | number;

    /** Numeric form of {@link _seed}, used to mix `noise`'s lattice; kept in lockstep through {@link adopt}. */
    private numericSeed!: number;

    private readonly gen: SeedGenerator;

    /** A spare gaussian sample from the last Box–Muller pair (see {@link gauss}). */
    private spareGauss: number | null = null;

    constructor(seed: string | number) {
        this.gen = new SeedGenerator(seed);
        this.adopt(seed);
    }

    /** The seed this source rewinds to. Assigning re-anchors the source (as `reset(seed)`): draws reproduce that seed's sequence and `noise`'s lattice shifts to match. */
    get seed(): string | number {
        return this._seed;
    }
    set seed(seed: string | number) {
        this.adopt(seed);
    }

    /** Numeric form of a seed (strings hashed djb2-style), shared so the constructor, setter and {@link reset} derive `numericSeed` identically. */
    private static toNumeric(seed: string | number): number {
        return typeof seed === 'string'
            ? seed.split('').reduce((a, b) => (a << 5) - a + b.charCodeAt(0), 0)
            : seed;
    }

    /** Takes `seed` as the new origin and rewinds to it; the single seed-adoption path behind the constructor, {@link seed} and a seeded {@link reset}. */
    private adopt(seed: string | number): void {
        this._seed = seed;
        this.numericSeed = Random.toNumeric(seed);
        this.gen.setSeed(seed);
        this.spareGauss = null;
    }

    /** The next float in `[from, to)`, default `[0, 1)`. */
    nextFloat(from: number = 0, to: number = 1): number {
        return this.gen.next() * (to - from) + from;
    }

    /** The next integer in `[from, to)`, default the full unsigned 32-bit range. */
    nextInt(from: number = 0, to: number = UINT32_RANGE): number {
        return Math.floor(this.gen.next() * (to - from)) + from;
    }

    /** `size` independent floats in `[from, to)`. */
    floatArray(size: number, from: number = 0, to: number = 1): number[] {
        const out = new Array<number>(size);
        for (let i = 0; i < size; i++) out[i] = this.nextFloat(from, to);
        return out;
    }

    /** `size` independent integers in `[from, to)`. */
    intArray(size: number, from: number = 0, to: number = UINT32_RANGE): number[] {
        const out = new Array<number>(size);
        for (let i = 0; i < size; i++) out[i] = this.nextInt(from, to);
        return out;
    }

    /** A normal sample (default standard). Uses the polar Box–Muller transform, which yields two normals per pair of uniforms; the spare is cached for the next call. */
    gauss(mean: number = 0, stdev: number = 1): number {
        if (this.spareGauss !== null) {
            const z = this.spareGauss;
            this.spareGauss = null;
            return mean + stdev * z;
        }
        // Rejection-sample a point in the unit circle, then map to two normals.
        let u: number, v: number, s: number;
        do {
            u = this.gen.next() * 2 - 1;
            v = this.gen.next() * 2 - 1;
            s = u * u + v * v;
        } while (s >= 1 || s === 0);
        const mul = Math.sqrt(-2 * Math.log(s) / s);
        this.spareGauss = v * mul;
        return mean + stdev * (u * mul);
    }

    /**
     * Smooth 1-D value noise in `[0, 1]`: lattice points around `time * frequency` interpolated with a smoothstep.
     * Unlike {@link nextFloat}/{@link gauss}, nearby `time` inputs give nearby values (camera shake, drift, waves).
     * Higher `frequency` means more crests across the same span.
     */
    noise(time: number, frequency: number = 1): number {
        const t = time * frequency;
        const i = Math.floor(t);
        const f = t - i;
        // Smoothstep: maps f through 3f²-2f³ to ease in/out between lattice points.
        const curve = f * f * (3 - 2 * f);
        const r1 = this.latticeValue(i);
        const r2 = this.latticeValue(i + 1);
        return r1 + (r2 - r1) * curve;
    }

    /** Rewinds so the next draws reproduce a sequence from the start. With a `seed`, adopts it as the new origin first (equivalent to assigning {@link seed}), e.g. in a node's constructor for a distinct stream. */
    reset(seed: string | number = this._seed): void {
        this.adopt(seed);
    }

    /** Deterministic value in `[0, 1)` for lattice point `x`, mixed with the seed via `sin`. Pure in `x`, so {@link noise} is stable regardless of preceding draws. */
    private latticeValue(x: number): number {
        const h = Math.sin(x + this.numericSeed) * 10000;
        return h - Math.floor(h);
    }
}
