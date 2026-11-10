import { describe, expect, it } from "vitest";
import { component2d } from "@/components/factory/component2d";
import type { Node2D, Node2DProps } from "@/components/trees/2d/node2d";
import type { Command, CommandArgs } from "@/tween/command";
import { TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { runtimeScope } from "@/runtime/document.fixtures";
import { Registry } from "../registry";
import type { CommandSpec, CompositionDocument, TimedNodeSpec } from "../types";

// Every built-in command the timeline holds once finished (`HELD` in
// command-traits.ts), each shown held and shown to match running everything.

const NODES: TimedNodeSpec[] = [
    { id: "row", type: "rect", parentId: null, layerOrder: 0, props: { flow: "horizontal", gap: 4, width: "hug", height: 40 } },
    { id: "a", type: "rect", parentId: "row", layerOrder: 0, props: { width: 20, height: 20, fill: "white" } },
    { id: "b", type: "rect", parentId: "row", layerOrder: 1, props: { width: 20, height: 20, x: "=[g]*10" } },
    { id: "space", type: "canvas3d", parentId: null, layerOrder: 1, props: { width: 200, height: 200 } },
    { id: "box", type: "box3d", parentId: "space", layerOrder: 0, props: {} },
];

const HELD_CASES: [string, string | null, Record<string, unknown>][] = [
    ["to", "a", { x: 40, opacity: 0.5 }],
    ["set", "a", { rotation: 30 }],
    ["moveTo", "a", { x: 30, y: 10 }],
    ["moveTo", "a", { path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 50, y: 20 }] }],
    ["fadeTo", "a", { opacity: 0.3 }],
    ["rotateTo", "a", { rotation: 90 }],
    ["scaleTo", "a", { scale: 1.5 }],
    ["layoutTo", "a", { width: 50 }],
    ["effectTo", "a", { effects: [{ type: "blur", radius: 4 }] }],
    ["pulse", "a", { factor: 1.4 }],
    ["wiggle", "a", { angle: 12, turns: 2 }],
    ["fillTo", "a", "red" as never],
    ["strokeTo", "a", { color: "red", width: 2 } as never],
    ["shadowTo", "a", { color: "black", blur: 4 } as never],
    ["overlayTo", "a", "rgba(255, 0, 0, 0.5)" as never],
    ["progressTo", "a", { end: 0.5 }],
    ["zoomTo", null, { zoom: 1.2 }],
    ["panTo", null, { lookAt: { x: 10, y: 5 } }],
    ["headingTo", null, { heading: 15 }],
    ["fillTo", null, "#123" as never],
    ["moveTo", "box", { x: 1, z: 2 }],
    ["rotateTo", "box", { rotationY: 45 }],
    ["scaleTo", "box", { scale: 2 }],
    ["variableTo", "g", { value: 3 }],
    ["variableSet", "g", { value: 2 }],
];

function docOf(commands: CommandSpec[]): CompositionDocument {
    return { kind: "composition", nodes: NODES, commands, variables: [{ id: "g", value: 1 }] } as CompositionDocument;
}

function built(doc: CompositionDocument, registry = new Registry()): TimelineClip {
    const clip = new TimelineClip(doc, runtimeScope({ registry }));
    clip.build();
    return clip;
}

function holds(clip: TimelineClip): boolean[] {
    const index = (clip.timeline as unknown as { _settled: { holds(i: number): boolean } | null })._settled;
    return clip.timeline.placedCommands().map((_, i) => index?.holds(i) ?? false);
}

/** Every node's props and box, and the variable, at `t`. */
function stateAt(clip: TimelineClip, t: number, reference: boolean): unknown {
    clip.attach(t);
    clip.timeline.syncPresence(t);
    if (reference) clip.timeline.evaluateAt(t, () => { });
    else clip.timeline.evaluateAt(t);
    clip.layout();
    const out: Record<string, unknown> = { g: clip.timeline.variableValue("g") };
    const walk = (node: { id: string; properties: object; children: readonly unknown[]; layoutBounds?: unknown }) => {
        out[node.id] = { ...node.properties, box: node.layoutBounds };
        for (const child of node.children) walk(child as never);
    };
    walk(clip.canvas as never);
    return out;
}

/** Around every edge (to a double either side), between them, forwards, backwards and shuffled. */
const TIMES = [0, 0.5, 1 - 1e-12, 1, 1 + 1e-12, 1.5, 2 - 1e-12, 2, 2 + 1e-12, 2.4, 3, 4];
const ORDERS = [TIMES, [...TIMES].reverse(), [2, 0, 4, 1, 1.5, 0.5, 3, 2 + 1e-12, 1 - 1e-12]];

describe("held built-in commands", () => {
    for (const [type, targetId, args] of HELD_CASES) {
        it(`${type} on ${targetId ?? "the root"} is held, and evaluates as running every command does`, () => {
            const doc = docOf([
                { id: "c", type, targetId, at: 1, duration: 1, args, easing: { kind: "inOut", args: "cubic" } },
                // A later held command on another slot, and a stamp after both.
                { id: "d", type: "fadeTo", targetId: "b", at: 1.5, duration: 0.5, args: { opacity: 0.2 } },
            ]);
            const held = built(doc);
            const reference = built(doc);
            expect(holds(held)).toEqual([true, true]);
            for (const order of ORDERS) {
                for (const t of order) expect(stateAt(held, t, false), `${type} at ${t}`).toEqual(stateAt(reference, t, true));
            }
        });
    }

    it("runs one whose args bind an expression, or that loops", () => {
        const clip = built(docOf([
            { id: "e", type: "set", targetId: "a", at: 0, duration: 0, args: { x: "=[g]*2" } },
            { id: "l", type: "fadeTo", targetId: "a", at: 0, duration: 1, args: { opacity: 0 }, loop: { count: 2 } },
            { id: "s", type: "save", targetId: "b", at: 0, duration: 0, args: {} },
        ]));
        expect(holds(clip)).toEqual([false, false, false]);
    });

    it("runs one writing what an earlier unheld command read, as `save` reads its node", () => {
        const doc = docOf([
            { id: "s", type: "save", targetId: "a", at: 0, duration: 0, args: {} },
            { id: "m", type: "to", targetId: "a", at: 0.5, duration: 0.5, args: { x: 100 } },
            { id: "o", type: "fadeTo", targetId: "b", at: 0.5, duration: 0.5, args: { opacity: 0 } },
            { id: "r", type: "restore", targetId: "a", at: 2, duration: 0, args: {} },
        ]);
        const clip = built(doc);
        expect(holds(clip)).toEqual([false, false, true, false]);
        const reference = built(doc);
        for (const t of [3, 0.75, 1.5, 2, 0]) expect(stateAt(clip, t, false), `at ${t}`).toEqual(stateAt(reference, t, true));
    });

    it("runs one on a type that reroutes `to`", () => {
        const Bent = component2d({ key: "bent", state: { x: 0 } });
        class Rerouted extends (Bent.node as unknown as typeof Node2D) {
            override to<D extends Partial<Node2DProps> = Partial<Node2DProps>>(args: CommandArgs<D, D> & { duration: number }): Command<Node2DProps> {
                return super.to(args);
            }
        }
        const registry = new Registry({ nodes: { bent: Rerouted } as never });
        const clip = built({
            kind: "composition",
            nodes: [{ id: "n", type: "bent", parentId: null, layerOrder: 0, props: {} }],
            commands: [{ id: "c", type: "to", targetId: "n", at: 0, duration: 1, args: { x: 5 } }],
        } as CompositionDocument, registry);
        expect(holds(clip)).toEqual([false]);
    });
});
