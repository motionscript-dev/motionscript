import { describe, expect, it } from "vitest";

import type { Node } from "@/components/trees/node/node";
import { getPropSlot } from "@/props/host";
import { observeSlots } from "@/props/observer";
import type { PropSlot } from "@/props/slot";
import { TimelineClip } from "@/runtime/clip-snapshot.fixtures";

import type { CommandSpec, CompositionDocument, TimedNodeSpec, VariableSpec } from "../types";

const box = (id: string, props: Record<string, unknown> = {}): TimedNodeSpec =>
    ({ id, type: "rect", parentId: null, layerOrder: 0, props: { width: 20, height: 20, ...props } });

const cmd = (id: string, type: string, targetId: string | null, at: number, args: Record<string, unknown>, duration = 1): CommandSpec =>
    ({ id, type, targetId, at, duration, args });

function built(nodes: TimedNodeSpec[], commands: CommandSpec[], variables?: VariableSpec[]): TimelineClip {
    const doc: CompositionDocument = { kind: "composition", nodes, commands, ...(variables && { variables }) };
    const clip = new TimelineClip(doc);
    clip.build();
    return clip;
}

const slotOf = (node: Node | undefined, prop: string) => getPropSlot(node as never, prop) as PropSlot<unknown>;

const writesOf = (clip: TimelineClip, id: string) => clip.timeline.placedCommands().find((p) => p.spec.id === id)!;

describe("compile write recording", () => {
    it("records exactly the slot a `to` writes", () => {
        const clip = built([box("a")], [cmd("slide", "to", "a", 0, { x: 50 })]);
        const placed = writesOf(clip, "slide");
        expect([...placed.writes]).toEqual([slotOf(clip.timeline.liveNode("a"), "x")]);
        expect(placed.readsLayout).toBe(false);
    });

    it("records a fill tween's write to fill", () => {
        const clip = built([box("a", { fill: "red" })], [cmd("paint", "fillTo", "a", 0, { fill: "blue" })]);
        expect(writesOf(clip, "paint").writes).toContain(slotOf(clip.timeline.liveNode("a"), "fill"));
    });

    it("records a variable command's write to the variable's cell", () => {
        const clip = built(
            [box("a", { x: "=[g]" })],
            [cmd("drive", "variableTo", "g", 0, { value: 10 })],
            [{ id: "g", value: 0 }],
        );
        expect([...writesOf(clip, "drive").writes]).toEqual([clip.timeline.variableSlot("g")]);
    });

    it("records what an instant restore writes while it is built", () => {
        const clip = built([box("a", { x: 5 })], [
            cmd("keep", "save", "a", 0, {}, 0),
            cmd("move", "to", "a", 0.5, { x: 80 }, 0.5),
            cmd("back", "restore", "a", 2, {}, 0),
        ]);
        expect(writesOf(clip, "keep").writes.size).toBe(0);
        expect(writesOf(clip, "back").writes).toContain(slotOf(clip.timeline.liveNode("a"), "x"));

        const a = clip.timeline.liveNode("a") as unknown as { x: number };
        clip.seek(1.5);
        expect(a.x).toBe(80);
        clip.seek(2.5);
        expect(a.x).toBe(5);
        clip.seek(1);
        expect(a.x).toBe(80);
    });

    it("marks a tween to an alignment point as reading layout", () => {
        const clip = built([box("a")], [
            cmd("align", "to", "a", 0, { center: { x: 10, y: 10 } }),
            cmd("plain", "to", "a", 1, { y: 3 }),
        ]);
        expect(writesOf(clip, "align").readsLayout).toBe(true);
        expect(writesOf(clip, "plain").readsLayout).toBe(false);
    });

    it("reports each write during evaluation under its command's index", () => {
        const clip = built(
            [box("a"), box("b")],
            [cmd("second", "to", "b", 1, { y: 7 }), cmd("first", "to", "a", 0, { x: 50 }), cmd("later", "to", "a", 5, { x: 0 })],
        );
        const placed = clip.timeline.placedCommands();
        expect(placed.map((p) => p.spec.id)).toEqual(["first", "second", "later"]);

        const seen: Array<[number, PropSlot<unknown>]> = [];
        clip.timeline.evaluateAt(1.5, (index, slot) => seen.push([index, slot]));
        expect(seen).toEqual([
            [0, slotOf(clip.timeline.liveNode("a"), "x")],
            [1, slotOf(clip.timeline.liveNode("b"), "y")],
        ]);
    });

    it("shows an observer around an observed evaluation no baseline restore, only what the commands write", () => {
        const clip = built([box("a", { fill: "red" })], [cmd("paint", "fillTo", "a", 0, { fill: "blue" }), cmd("slide", "to", "a", 1, { x: 50 })]);
        const outer: PropSlot<unknown>[] = [];
        const reported: PropSlot<unknown>[] = [];
        observeSlots({ read: () => { }, write: (slot) => outer.push(slot) }, () => {
            clip.timeline.evaluateAt(1.5, (_index, slot) => reported.push(slot));
        });
        const a = clip.timeline.liveNode("a");
        expect(outer).toEqual([]);
        expect(reported).toEqual([slotOf(a, "fill"), slotOf(a, "x")]);
    });
});
