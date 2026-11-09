import { describe, expect, it } from "vitest";
import { clamp01 } from "@/util/clamp";
import { PropSlot } from "@/props/slot";
import { driveCommand, settling, type Command } from "@/tween/command";
import { SettledIndex, type SettlePlaced } from "@/document/settled-index";

const commandOf = (duration: number, apply: (t: number) => void) =>
    driveCommand(duration, apply) as unknown as Command<Record<string, unknown>>;

/** Deterministic, so a failure reproduces from its seed. */
function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A timeline over a few slots: commands at awkward times, overlapping, some
 * stamps, some marked, each writing a few slots from its own `t` alone. A slot
 * may start being written partway through, as a sequence's later piece does.
 */
function timelineOf(seed: number) {
    const rand = random(seed);
    const slots = Array.from({ length: 4 }, (_, i) => new PropSlot<number>(0, null, `s${i}`));
    const placed: SettlePlaced[] = [];
    let at = 0;
    const count = 3 + Math.floor(rand() * 30);
    for (let c = 0; c < count; c++) {
        at += rand() < 0.3 ? 0 : rand() * 0.7;
        const start = Math.round(at * 30) / 30 + (rand() < 0.2 ? 0.1 : 0);
        const duration = rand() < 0.15 ? 0 : rand() < 0.5 ? 1 / 3 : rand() * 2;
        const writes = slots.filter(() => rand() < 0.5);
        if (writes.length === 0) writes.push(slots[Math.floor(rand() * slots.length)]);
        const from = writes.map(() => rand() < 0.4 ? rand() * 0.9 : 0);
        const base = c * 10;
        const command = commandOf(duration, (t) => writes.forEach((slot, k) => {
            if (t >= from[k]) slot.set(base + k + t);
        }));
        placed.push({ start, duration, command: rand() < 0.7 ? settling(command) : command, writes: new Set(writes) });
    }
    placed.sort((a, b) => a.start - b.start);
    return { slots, placed };
}

/** What the timeline does without an index: restore, then run everything started, in order. */
function replay(slots: readonly PropSlot<number>[], placed: readonly SettlePlaced[], seconds: number): number[] {
    for (const slot of slots) slot.set(0);
    for (const p of placed) {
        if (seconds < p.start) continue;
        p.command.at(clamp01(p.duration > 0 ? (seconds - p.start) / p.duration : 1));
    }
    return slots.map((slot) => slot.get());
}

function held(index: SettledIndex, slots: readonly PropSlot<number>[], placed: readonly SettlePlaced[], seconds: number): number[] {
    for (const slot of slots) slot.set(0);
    index.evaluate(placed, seconds);
    return slots.map((slot) => slot.get());
}

/** Every boundary, the doubles either side of it, and times between. */
function timesOf(placed: readonly SettlePlaced[], rand: () => number): number[] {
    const times = new Set<number>([0, -1]);
    for (const p of placed) {
        for (const edge of [p.start, p.start + p.duration]) {
            times.add(edge);
            times.add(edge - 1e-12);
            times.add(edge + 1e-12);
        }
    }
    const last = Math.max(...placed.map((p) => p.start + p.duration));
    for (let i = 0; i < 40; i++) times.add(rand() * (last + 1));
    return [...times].sort(() => rand() - 0.5);
}

describe("SettledIndex", () => {
    it("is null when nothing is marked", () => {
        const slot = new PropSlot(0);
        const command = commandOf(1, (t) => slot.set(t));
        expect(SettledIndex.build([{ start: 0, duration: 1, command, writes: new Set([slot]) }])).toBeNull();
    });

    it("evaluates every time exactly as running everything does", () => {
        for (let seed = 1; seed <= 300; seed++) {
            const { slots, placed } = timelineOf(seed);
            const index = SettledIndex.build(placed);
            if (!index) continue;
            const rand = random(seed * 7919);
            for (const t of timesOf(placed, rand)) {
                const expected = replay(slots, placed, t);
                expect(held(index, slots, placed, t), `seed ${seed} at ${t}`).toEqual(expected);
            }
        }
    });

    it("keeps placement order when an earlier command is still running", () => {
        const slot = new PropSlot(0);
        const long = settling(commandOf(10, (t) => slot.set(100 + t)));
        const short = settling(commandOf(1, (t) => slot.set(t)));
        const placed = [
            { start: 0, duration: 10, command: long, writes: new Set([slot]) },
            { start: 2, duration: 1, command: short, writes: new Set([slot]) },
        ];
        const index = SettledIndex.build(placed)!;
        slot.set(0);
        index.evaluate(placed, 5);
        // The short one is finished but placed later, so it beats the long one still running.
        expect(slot.get()).toBe(1);
    });

    it("holds the end value of a command that writes a slot only from partway through", () => {
        const a = new PropSlot(0);
        const b = new PropSlot(0);
        const before = settling(commandOf(1, (t) => b.set(7 + t)));
        const sequence = settling(commandOf(2, (t) => {
            a.set(t);
            if (t >= 0.5) b.set(t);
        }));
        const placed = [
            { start: 0, duration: 1, command: before, writes: new Set([b]) },
            { start: 1, duration: 2, command: sequence, writes: new Set([a, b]) },
        ];
        const index = SettledIndex.build(placed)!;
        for (const [t, expected] of [[1.5, [0.25, 8]], [2.5, [0.75, 0.75]], [3, [1, 1]]] as const) {
            a.set(0);
            b.set(0);
            index.evaluate(placed, t);
            expect([a.get(), b.get()]).toEqual(expected);
        }
    });
});
