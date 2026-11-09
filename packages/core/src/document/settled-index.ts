import { clamp01 } from "@/util/clamp";
import { observeSlots } from "@/props/observer";
import type { PropSlot, PropSnapshot } from "@/props/slot";
import { settles, type Command } from "@/tween/command";

/** What the index reads of a placed command. */
export interface SettlePlaced {
    readonly start: number;
    /** When it starts writing, if earlier than `start`: an entrance holds `at(0)` from here. */
    readonly holdFrom?: number;
    readonly duration: number;
    readonly command: Command<Record<string, unknown>>;
    readonly writes: ReadonlySet<PropSlot<unknown>>;
}

/**
 * Evaluation that holds finished commands instead of running them.
 *
 * A timeline evaluates `t` by restoring baselines and running every command
 * started by `t` in placement order, so the later one wins a slot both write.
 * That costs every command placed so far, finished or not. A command marked
 * {@link settling} leaves fixed end values, so once finished it is a stored
 * write per slot: for each slot, only the latest-placed finished writer counts.
 * A frame then costs a lookup per written slot plus the commands still running,
 * and the length of the timeline drops out.
 *
 * Unmarked commands, and marked ones still running, are run as before, in
 * placement order. After each, a slot it writes whose held writer was placed
 * later gets that writer's value back: placement order still decides. This
 * relies on what the timeline's restore already does, that a command writes
 * nothing while running that it did not write while being built.
 */
export class SettledIndex {
    /** `null` when nothing is marked: the timeline runs everything, as before. */
    static build(placed: readonly SettlePlaced[]): SettledIndex | null {
        const finish = new Float64Array(placed.length).fill(NaN);
        const writers = new Map<PropSlot<unknown>, Writer[]>();
        const replayed: number[] = [];
        const running: number[] = [];
        for (let i = 0; i < placed.length; i++) {
            const p = placed[i];
            const end = settles(p.command) ? finishTime(p.start, p.duration) : NaN;
            if (Number.isNaN(end)) {
                replayed.push(i);
                continue;
            }
            finish[i] = end;
            if (end > (p.holdFrom ?? p.start)) running.push(i);
            // Only what `at(1)` writes is an end value; a slot written only while
            // building is not held.
            const written = new Set<PropSlot<unknown>>();
            observeSlots({ read: () => { }, write: (slot) => written.add(slot) }, () => p.command.at(1));
            for (const slot of written) {
                const list = writers.get(slot);
                const writer = { order: i, finish: end, end: slot.snapshot() };
                if (list) list.push(writer);
                else writers.set(slot, [writer]);
            }
        }
        if (replayed.length === placed.length) return null;
        return new SettledIndex(placed, finish, [...writers].map(([slot, list]) => new Track(slot, list)), replayed, running);
    }

    /** Whether the command at `index` is held once finished, rather than run on every evaluation. */
    holds(index: number): boolean {
        return !Number.isNaN(this._finish[index]);
    }

    /** Bring what the placed commands write to `seconds`. Baselines must be restored first. */
    evaluate(placed: readonly SettlePlaced[], seconds: number): void {
        const tracks = this._tracks;
        const held = this._held;
        for (let k = 0; k < tracks.length; k++) {
            const w = (held[k] = tracks[k].at(seconds));
            if (w >= 0) tracks[k].slot.restoreFrom(tracks[k].ends[w]);
        }

        // Three lists, each in placement order, merged.
        const replayed = this._replayed;
        const long = this._long;
        const bin = this._binOf(seconds);
        const binEnd = this._binStart[bin + 1];
        let a = 0;
        let b = this._binStart[bin];
        let c = 0;
        for (; ;) {
            const ia = a < replayed.length ? replayed[a] : NONE;
            const ib = b < binEnd ? this._binItems[b] : NONE;
            const ic = c < long.length ? long[c] : NONE;
            let i: number;
            if (ia < ib && ia < ic) {
                i = ia;
                a++;
            } else if (ib < ic) {
                i = ib;
                b++;
            } else if (ic !== NONE) {
                i = ic;
                c++;
            } else {
                break;
            }

            const p = placed[i];
            // An unmarked finish is NaN, which no time reaches.
            if (seconds < (p.holdFrom ?? p.start) || this._finish[i] <= seconds) continue;
            p.command.at(seconds < p.start ? 0 : clamp01(p.duration > 0 ? (seconds - p.start) / p.duration : 1));
            for (let f = this._fixStart[i]; f < this._fixStart[i + 1]; f++) {
                const k = this._fixTracks[f];
                const w = held[k];
                if (w >= 0 && tracks[k].order[w] > i) tracks[k].slot.restoreFrom(tracks[k].ends[w]);
            }
        }
    }

    private constructor(
        placed: readonly SettlePlaced[],
        private readonly _finish: Float64Array,
        private readonly _tracks: readonly Track[],
        private readonly _replayed: readonly number[],
        running: readonly number[],
    ) {
        this._held = new Int32Array(_tracks.length);

        // Marked commands that can be running, by the time bins their run overlaps.
        // One spanning many bins is checked on every evaluation instead.
        let from = Infinity;
        let to = -Infinity;
        for (const i of running) {
            from = Math.min(from, placed[i].holdFrom ?? placed[i].start);
            to = Math.max(to, _finish[i]);
        }
        const bins = Math.max(1, Math.min(MAX_BINS, running.length));
        this._from = Number.isFinite(from) ? from : 0;
        this._width = to > from ? (to - from) / bins : 1;
        this._bins = bins;
        const items: number[][] = Array.from({ length: bins }, () => []);
        const long: number[] = [];
        for (const i of running) {
            const first = this._binOf(placed[i].holdFrom ?? placed[i].start);
            const last = this._binOf(_finish[i]);
            if (last - first > MAX_SPAN) long.push(i);
            else for (let bin = first; bin <= last; bin++) items[bin].push(i);
        }
        this._long = long;
        this._binStart = new Int32Array(bins + 1);
        for (let bin = 0; bin < bins; bin++) this._binStart[bin + 1] = this._binStart[bin] + items[bin].length;
        this._binItems = Int32Array.from(items.flat());

        // For every command, the tracks of the slots it writes.
        const trackOf = new Map<PropSlot<unknown>, number>(_tracks.map((track, k) => [track.slot, k]));
        const fixes: number[] = [];
        this._fixStart = new Int32Array(placed.length + 1);
        for (let i = 0; i < placed.length; i++) {
            for (const slot of placed[i].writes) {
                const k = trackOf.get(slot);
                if (k !== undefined) fixes.push(k);
            }
            this._fixStart[i + 1] = fixes.length;
        }
        this._fixTracks = Int32Array.from(fixes);
    }

    private readonly _held: Int32Array;
    private readonly _from: number;
    private readonly _width: number;
    private readonly _bins: number;
    private readonly _binStart: Int32Array;
    private readonly _binItems: Int32Array;
    private readonly _long: readonly number[];
    private readonly _fixStart: Int32Array;
    private readonly _fixTracks: Int32Array;

    private _binOf(seconds: number): number {
        const bin = Math.floor((seconds - this._from) / this._width);
        return bin < 0 ? 0 : bin >= this._bins ? this._bins - 1 : bin;
    }
}

const NONE = 0x7fffffff;
const MAX_BINS = 1024;
const MAX_SPAN = 32;

interface Writer {
    order: number;
    finish: number;
    end: PropSnapshot<unknown>;
}

/** One written slot: its marked writers by finish time, and the latest-placed one finished by each. */
class Track {
    readonly finish: Float64Array;
    readonly order: Int32Array;
    readonly ends: PropSnapshot<unknown>[];
    private readonly _best: Int32Array;

    constructor(readonly slot: PropSlot<unknown>, writers: Writer[]) {
        writers.sort((x, y) => x.finish - y.finish || x.order - y.order);
        this.finish = Float64Array.from(writers, (w) => w.finish);
        this.order = Int32Array.from(writers, (w) => w.order);
        this.ends = writers.map((w) => w.end);
        this._best = new Int32Array(writers.length);
        let best = 0;
        for (let i = 0; i < writers.length; i++) {
            if (this.order[i] > this.order[best]) best = i;
            this._best[i] = best;
        }
    }

    /** The writer whose end value the slot holds at `seconds`, or -1 when none has finished. */
    at(seconds: number): number {
        let lo = 0;
        let hi = this.finish.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.finish[mid] <= seconds) lo = mid + 1;
            else hi = mid;
        }
        return lo === 0 ? -1 : this._best[lo - 1];
    }
}

/**
 * The first time a command placed at `start` for `duration` runs at its end, by
 * the timeline's own arithmetic, `(t - start) / duration >= 1`. `start + duration`
 * can miss it by a rounding step either way. NaN when it can't be pinned down,
 * which leaves the command to run every evaluation.
 */
function finishTime(start: number, duration: number): number {
    if (!(duration > 0)) return start;
    const done = (t: number) => (t - start) / duration >= 1;
    let t = start + duration;
    if (!Number.isFinite(t)) return NaN;
    for (let i = 0; !done(t); i++) {
        if (i === 8) return NaN;
        t = step(t, true);
    }
    for (let i = 0; i < 8; i++) {
        const down = step(t, false);
        if (!done(down)) return t;
        t = down;
    }
    return NaN;
}

const BITS = new Float64Array(1);
const INTS = new BigInt64Array(BITS.buffer);

/** The adjacent double above or below `x`. */
function step(x: number, up: boolean): number {
    if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
    BITS[0] = x;
    INTS[0] += (x > 0) === up ? 1n : -1n;
    return BITS[0];
}
