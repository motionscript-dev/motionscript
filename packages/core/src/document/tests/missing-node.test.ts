import { describe, expect, it } from "vitest";

import { Rect } from "@/components/builtins/geometry/geometry";
import { Box3D } from "@/components/builtins/three/three";
import type { Node } from "@/components/trees/node/node";
import { TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { comp, node, precompFor, project, runtimeScope, track } from "@/runtime/document.fixtures";

import { missingNodeOf } from "../missing-node";
import { Registry } from "../registry";
import type { CompositionDocument, NodeSpec } from "../types";

const registry = new Registry();
const row = (id: string, type: string, props: Record<string, unknown> = {}, parentId: string | null = null): NodeSpec =>
    ({ ...node(id, type, props, parentId), parentId });

function built(doc: CompositionDocument, reg: Registry = registry): TimelineClip {
    const clip = new TimelineClip(doc, runtimeScope({ registry: reg }));
    clip.build();
    return clip;
}

const doc: CompositionDocument = comp(
    [
        row("ghost", "sparkleBurst", { x: 40, y: 10, width: 50, height: 20, fill: "red", sparkles: 12 }),
        row("kid", "rect", { width: 10, height: 10, fill: "blue" }, "ghost"),
        row("box", "rect", { width: 10, height: 10 }),
    ],
    [
        [
            { target: "box", type: "moveTo", args: { x: 30 }, duration: 1 },
            { target: "ghost", type: "burst", args: {}, duration: 1 },
            { target: "kid", type: "to", args: { x: 5 }, duration: 1 },
            { target: "box", type: "explode", args: {}, duration: 1 },
            { target: "ghost", type: "to", args: { x: 99 }, duration: 1 },
        ],
    ],
);

describe("a row of a type the registry lacks", () => {
    it("builds as a placeholder that keeps its id, placement and children, and remembers what it was", () => {
        const clip = built(doc);
        const ghost = clip.timeline.liveNode("ghost")!;
        expect(ghost.id).toBe("ghost");
        expect(missingNodeOf(ghost)).toEqual({ type: "sparkleBurst", props: doc.nodes[0].props });
        expect([(ghost as unknown as { x: number }).x, (ghost as unknown as { width: number }).width]).toEqual([40, 50]);
        expect((ghost as unknown as Record<string, unknown>).fill).toBeUndefined();
        expect(ghost.children.map((c) => c.id)).toEqual(["kid"]);
        expect(ghost.children[0]).toBeInstanceOf(Rect);
        expect(missingNodeOf(clip.timeline.liveNode("box")!)).toBeUndefined();
    });

    it("lets the rest of the clip build and play", () => {
        const clip = built(doc);
        clip.seek(1);
        expect((clip.timeline.liveNode("box") as unknown as { x: number }).x).toBe(30);
        expect((clip.timeline.liveNode("kid") as unknown as { x: number }).x).toBe(5);
        expect(clip.timeline.placedCommands().map((p) => p.spec.type)).toEqual(["moveTo", "to"]);
    });

    it("skips every command aimed at a placeholder, and any no type publishes, recording each", () => {
        const issues = built(doc).timeline.issues();
        expect(issues.map((i) => [i.code, i.type, i.nodeId, i.commandId])).toEqual([
            ["unknown-node-type", "sparkleBurst", "ghost", undefined],
            ["unknown-command", "burst", "ghost", "c1"],
            ["unknown-command", "explode", "box", "c3"],
            ["unknown-command", "to", "ghost", "c4"],
        ]);
        expect(issues[2].message).toMatch(/Node type "rect" has no command "explode".*It is skipped\./);
    });

    it("lands in buildErrors, coded, and the track does not fail", () => {
        const result = precompFor(project([track("t", doc)]), { registry }).run();
        expect(result.buildErrors.map((e) => [e.trackId, e.code, e.commandId ?? e.nodeId])).toEqual([
            ["t", "unknown-node-type", "ghost"],
            ["t", "unknown-command", "c1"],
            ["t", "unknown-command", "c3"],
            ["t", "unknown-command", "c4"],
        ]);
    });

    it("joins its children's tree, or the one its parent adds", () => {
        const three = built(comp([
            row("view", "canvas3d", { width: 100, height: 100 }),
            row("orbit", "orbitRig", {}, "view"),
            row("cube", "box3d", {}, "orbit"),
            row("lone", "glowField3d", { x: 2, z: 3 }, "view"),
        ]));
        const orbit = three.timeline.liveNode("orbit")!;
        const lone = three.timeline.liveNode("lone")!;
        expect([orbit.dimension, lone.dimension]).toEqual(["3d", "3d"]);
        expect(orbit.children[0]).toBeInstanceOf(Box3D.node);
        expect((lone as unknown as { z: number }).z).toBe(3);

        const sound = built(comp([row("bus", "audioBus"), row("fx", "reverbBus", {}, "bus")]));
        expect(sound.timeline.liveNode("fx")!.dimension).toBe("audio");
        expect(built(comp([row("top", "ghost")])).timeline.liveNode("top")!.dimension).toBe("2d");
    });

    it("throws instead when the registry is strict", () => {
        expect(() => built(doc, new Registry({ strict: true }))).toThrow(/Unknown node type "sparkleBurst" \(node ghost\)/);
        const unknownCommand = comp([row("box", "rect")], [{ target: "box", type: "explode", args: {} }]);
        expect(() => built(unknownCommand, new Registry({ strict: true }))).toThrow(/has no command "explode"/);
    });

    it("stays a placeholder across an edit, and its issues follow the document", () => {
        const clip = built(doc);
        const before = clip.timeline.liveNode("ghost");
        const edited: CompositionDocument = { ...doc, nodes: doc.nodes.map((n) => (n.id === "box" ? { ...n, props: { ...n.props, height: 12 } } : n)) };
        expect(clip.update(edited)).not.toBeNull();
        expect(clip.timeline.liveNode("ghost")).toBe(before);

        const fewer: CompositionDocument = { ...edited, commands: edited.commands.filter((c) => c.id !== "c3") };
        expect(clip.update(fewer)).not.toBeNull();
        expect(clip.timeline.issues().map((i) => i.commandId ?? i.nodeId)).toEqual(["ghost", "c1", "c4"]);
    });

    it("builds the real type once it is registered", () => {
        const late = new Registry();
        const clip = built(doc, late);
        late.addNode("sparkleBurst", Rect.node as never);
        const next = { ...doc, nodes: doc.nodes.map((n) => (n.id === "ghost" ? { ...n, props: { ...n.props, x: 41 } } : n)) };
        clip.update(next);
        const ghost = clip.timeline.liveNode("ghost") as Node;
        expect(missingNodeOf(ghost)).toBeUndefined();
        expect(ghost).toBeInstanceOf(Rect);
    });
});
