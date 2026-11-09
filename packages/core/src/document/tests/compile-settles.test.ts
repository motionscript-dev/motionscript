import { describe, expect, it, vi } from "vitest";

import type { Node } from "@/components/trees/node/node";
import type { Rect } from "@/components/builtins/geometry/geometry";
import { ClipInstance } from "@/runtime/clip-instance";
import { runtimeScope } from "@/runtime/document.fixtures";

import { documentDuration, type CommandSpec, type CompositionDocument, type TimedNodeSpec } from "../types";

function box(id: string, props: Record<string, unknown> = {}, span: Partial<TimedNodeSpec> = {}): TimedNodeSpec {
    return { id, type: "rect", parentId: null, layerOrder: 0, props: { width: 10, height: 10, ...props }, ...span };
}

function command(id: string, type: string, targetId: string, at: number, args: Record<string, unknown>, duration = 0.5): CommandSpec {
    return { id, type, targetId, at, duration, args };
}

function built(doc: CompositionDocument): { instance: ClipInstance; layouts: number } {
    const instance = new ClipInstance(doc, documentDuration(doc), runtimeScope());
    const layout = vi.spyOn(instance.canvas, "layout");
    instance.build();
    return { instance, layouts: layout.mock.calls.length };
}

/** Fifty nodes entering one a second, each fading in as it arrives. */
function staggered(extra: CommandSpec[] = [], nodes: TimedNodeSpec[] = []): CompositionDocument {
    const rows = Array.from({ length: 50 }, (_, i) => box(`n${i}`, { opacity: 0 }, { startAt: i }));
    const fades = rows.map((row, i) => command(`f${i}`, "fadeTo", row.id, i, { opacity: 1 }));
    return { kind: "composition", nodes: [...rows, ...nodes], commands: [...fades, ...extra] };
}

describe("compile's settles", () => {
    // Build lays out once before compile and once after; compile settles once more
    // on the way back to t=0. Anything above that is a settle inside the walk.
    const OUTSIDE_THE_WALK = 3;

    it("skips every presence change nothing reads layout across", () => {
        expect(built(staggered()).layouts).toBe(OUTSIDE_THE_WALK);
    });

    it("settles once for a window holding a layout reader", () => {
        const anchor = box("anchor", { topLeft: { x: 0, y: 0 } });
        const doc = staggered([command("read", "to", "anchor", 20.5, { x: 40 })], [anchor]);
        expect(built(doc).layouts).toBe(OUTSIDE_THE_WALK + 1);
    });

    it("settles at the window's start, before a same-window size tween has run", () => {
        // `a`'s x is bound over its box, so the x tween's `from` reads the box: 10
        // wide as built, 30 once the window at 1s opens on `widen`'s end, and 50 if
        // `grow` — built just before the reader in that window — leaked into it.
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [box("a", { topLeft: { x: 0, y: 0 } }), box("b", {}, { startAt: 1 })],
            commands: [
                command("widen", "to", "a", 0, { width: 30 }),
                command("grow", "to", "a", 1, { width: 50 }, 1),
                command("slide", "to", "a", 1, { x: 100 }, 1),
            ],
        };
        const { instance } = built(doc);
        instance.evaluateAt(1);
        const a = instance.canvas.children.find((c) => c.id === "a") as Rect;
        // topLeft at 0 puts the centre half a width right.
        expect(a.x).toBe(15);
    });
});

/** A small deterministic generator, so a failure names a reproducible document. */
function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

/** Each parent's document children at `t`, the way the rows say they should stand. */
function expectedTree(nodes: TimedNodeSpec[], t: number): Map<string, string[]> {
    const present = (n: TimedNodeSpec) => t >= (n.startAt ?? 0) && t < (n.endAt ?? Infinity);
    const tree = new Map<string, string[]>();
    const walk = (parentId: string, parentKey: string | null) => {
        const children = nodes
            .map((node, order) => ({ node, order }))
            .filter(({ node }) => node.parentId === parentKey && present(node))
            .sort((a, b) => (a.node.layerOrder - b.node.layerOrder) || (a.order - b.order))
            .map(({ node }) => node.id);
        tree.set(parentId, children);
        for (const id of children) walk(id, id);
    };
    walk("", null);
    return tree;
}

function actualTree(canvas: Node): Map<string, string[]> {
    const tree = new Map<string, string[]>();
    const walk = (node: Node) => {
        tree.set(node.id, node._allChildren.map((c) => c.id));
        for (const child of node._allChildren) walk(child);
    };
    walk(canvas);
    return tree;
}

describe("syncPresence", () => {
    it("matches the rows at every time, reached in any order", () => {
        const rand = random(7);
        const nodes: TimedNodeSpec[] = [];
        for (let i = 0; i < 40; i++) {
            const parents = nodes.filter((n) => n.id.startsWith("g"));
            const parentId = i > 4 && rand() < 0.5 ? parents[Math.floor(rand() * parents.length)]?.id ?? null : null;
            const startAt = Math.floor(rand() * 8);
            const endAt = rand() < 0.5 ? startAt + 1 + Math.floor(rand() * 4) : undefined;
            nodes.push({
                ...box(`${i % 3 === 0 ? "g" : "n"}${i}`, {}, { startAt, ...(endAt !== undefined && { endAt }) }),
                parentId,
                layerOrder: Math.floor(rand() * 3),
            });
        }
        const doc: CompositionDocument = { kind: "composition", nodes, commands: [], duration: 12 };
        const { instance } = built(doc);

        const times = [0, 3, 3, 7.5, 1, 11, 0.5, 4, 4.999, 5, 12, 2, 0, 9, 6];
        for (const t of times) {
            instance.evaluateAt(t);
            const expected = expectedTree(nodes, t);
            const actual = actualTree(instance.canvas);
            for (const [id, children] of expected) expect(actual.get(id), `children of "${id}" at ${t}s`).toEqual(children);
        }
    });

    it("reports a change only when the tree moved", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [box("a", {}, { startAt: 1, endAt: 2 }), box("b", {}, { startAt: 1.5, endAt: 1.75 })],
            commands: [],
            duration: 3,
        };
        const instance = new ClipInstance(doc, 3, runtimeScope());
        instance.build();
        const timeline = (instance as unknown as { _timeline: { syncPresence(t: number): boolean } })._timeline;

        expect(timeline.syncPresence(0.5)).toBe(false);
        expect(timeline.syncPresence(1)).toBe(true);
        expect(timeline.syncPresence(1.2)).toBe(false);
        // `b` enters and leaves between the two: crossed, but nothing moved.
        expect(timeline.syncPresence(1.9)).toBe(false);
        expect(timeline.syncPresence(2.5)).toBe(true);
        expect(timeline.syncPresence(1.6)).toBe(true);
        expect(instance.canvas.children.map((c) => c.id)).toEqual(["a", "b"]);
    });
});
