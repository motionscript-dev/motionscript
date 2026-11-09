import { describe, expect, it } from "vitest";

import { AUDIO_ROOT_ID } from "../audio";
import { indexDocument } from "../doc-index";
import type { AudioDocument, CommandSpec, CompositionDocument, StillDocument, TimedNodeSpec, VariableSpec } from "../types";

const node = (id: string, props: Record<string, unknown> = {}, extra: Partial<TimedNodeSpec> = {}): TimedNodeSpec =>
    ({ id, type: "rect", parentId: null, layerOrder: 0, props, ...extra });

const cmd = (id: string, targetId: string | null, at: number, args: Record<string, unknown> = {}, type = "to"): CommandSpec =>
    ({ id, type, targetId, at, args });

const comp = (nodes: TimedNodeSpec[], commands: CommandSpec[] = [], variables?: VariableSpec[]): CompositionDocument =>
    ({ kind: "composition", nodes, commands, ...(variables && { variables }) });

describe("indexDocument", () => {
    it("indexes rows, synthesizing the root", () => {
        const index = indexDocument(comp([node("a", {}, { key: "card" }), node("b")], [], [{ id: "g", value: 0 }]));
        expect(index.nodes.get("")?.type).toBe("canvas2d");
        expect(index.nodeCount).toBe(2);
        expect(index.keyed.get("card")).toBe("a");
        expect(index.variables.has("g")).toBe(true);
        expect(Object.values(index.issues).some(Boolean)).toBe(false);
    });

    it("orders children by layerOrder, ties by array index, and walks descendants", () => {
        const index = indexDocument(comp([
            node("p"),
            node("c2", {}, { parentId: "p", layerOrder: 1 }),
            node("c1b", {}, { parentId: "p" }),
            node("c1a", {}, { parentId: "p" }),
            node("g", {}, { parentId: "c1b" }),
        ]));
        expect(index.children("p")).toEqual(["c1b", "c1a", "c2"]);
        expect(index.children("")).toEqual(["p"]);
        expect(index.descendants("p")).toEqual(["c1b", "g", "c1a", "c2"]);
        expect(index.descendants("g")).toEqual([]);
    });

    it("intersects spans with every ancestor's", () => {
        const index = indexDocument(comp([
            node("p", {}, { startAt: 1, endAt: 5 }),
            node("c", {}, { parentId: "p", endAt: 3 }),
            node("g", {}, { parentId: "c", startAt: 2 }),
        ]));
        expect(index.ownSpan("c")).toEqual({ start: 0, end: 3 });
        expect(index.effSpan("c")).toEqual({ start: 1, end: 3 });
        expect(index.effSpan("g")).toEqual({ start: 2, end: 3 });
        expect(index.effSpan("")).toEqual({ start: 0, end: Infinity });
        expect(index.effSpan("missing")).toBeUndefined();
    });

    it("keys the t=0 state", () => {
        const index = indexDocument(comp([
            node("here"),
            node("late-parent", {}, { startAt: 1 }),
            node("orphaned", {}, { parentId: "late-parent" }),
            node("later", {}, { startAt: 2 }),
        ]));
        expect(index.initialKey("here")).toBe("mounted");
        expect(index.initialKey("orphaned")).toBe("unmounted");
        expect(index.initialKey("later")).toBe("absent");
        expect(index.initialKey("")).toBe("mounted");
    });

    it("keys arrival captures off the first command time inside the node's own span", () => {
        const index = indexDocument(comp([
            node("a", {}, { startAt: 2, endAt: 4 }),
            node("parent", {}, { startAt: 3 }),
            node("child", {}, { parentId: "parent", startAt: 1 }),
            node("unseen", {}, { startAt: 5, endAt: 6 }),
            node("edge", {}, { startAt: 1, endAt: 1.5 }),
            node("now"),
            node("other"),
        ], [
            cmd("c1", "other", 1.5),
            cmd("c2", "other", 2.5),
            cmd("c3", "a", 3),
            cmd("c4", "other", 7),
        ]));
        expect(index.captureKey("a")).toBe("arrival-mounted");
        expect(index.captureTime("a")).toBe(2.5);
        expect(index.captureKey("child")).toBe("arrival-unmounted");
        expect(index.captureTime("child")).toBe(1.5);
        expect(index.captureKey("unseen")).toBe("none");
        expect(index.captureKey("edge")).toBe("none");
        expect(index.captureKey("now")).toBe("none");
    });

    it("orders commands like the timeline and groups them by target", () => {
        const index = indexDocument(comp([node("a")], [
            cmd("late", "a", 2),
            cmd("root", null, 1),
            cmd("tie1", "a", 1),
            cmd("tie2", "a", 1),
        ]));
        expect(index.ordered.map((c) => c.id)).toEqual(["root", "tie1", "tie2", "late"]);
        expect(index.byTarget.get("a")).toEqual(["tie1", "tie2", "late"]);
        expect(index.byTarget.get("")).toEqual(["root"]);
        expect(index.commandsAt(1).map((c) => c.id)).toEqual(["root", "tie1", "tie2"]);
        expect(index.duration).toBe(2);
    });

    it("collects references from props and set args, per prop", () => {
        const index = indexDocument(comp([
            node("a", { x: "=[g]+[card.width]", fill: ["red", { type: "solid", color: "=[tint]" }] }),
            node("b", {}, { key: "card" }),
            node("plain", { x: 1 }),
        ], [
            cmd("s", "a", 1, { y: "=[h]*2", x: "=[g]" }, "set"),
            cmd("t", "plain", 1, { x: 5 }),
            cmd("rootSet", null, 1, { zoom: "=[g]" }, "set"),
        ], [
            { id: "g", value: 0 }, { id: "h", value: 0 }, { id: "tint", value: "red" },
        ]));

        const refs = index.refs("a");
        expect(refs.vars.sort()).toEqual(["g", "h", "tint"]);
        expect(refs.keys).toEqual([["card", "width"]]);
        expect([...index.bindings("a").keys()].sort()).toEqual(["fill", "x", "y"]);
        expect(index.bindings("a").get("x")?.vars).toEqual(["g"]);
        expect(index.refs("plain").vars).toEqual([]);
        expect(index.refs("").vars).toEqual(["g"]);

        expect([...index.dependents.byVar.get("g")!].sort()).toEqual(["", "a"]);
        expect([...index.dependents.byVar.get("h")!]).toEqual(["a"]);
        expect([...index.dependents.byKey.get("card")!]).toEqual(["a"]);
        expect(index.issues.unresolvedRefs).toBe(false);
    });

    it("flags what an incremental update cannot reason about", () => {
        expect(indexDocument(comp([node("a"), node("a")])).issues.duplicateIds).toBe(true);
        expect(indexDocument(comp([node("a")], [], [{ id: "a", value: 0 }])).issues.duplicateIds).toBe(true);
        expect(indexDocument(comp([node("a")], [cmd("c", "a", 0), cmd("c", "a", 1)])).issues.duplicateIds).toBe(true);
        expect(indexDocument(comp([node("a", {}, { key: "k" }), node("b", {}, { key: "k" })])).issues.duplicateKeys).toBe(true);
        expect(indexDocument(comp([node("a", {}, { parentId: "nope" })])).issues.unresolvedParent).toBe(true);
        expect(indexDocument(comp([node("a", {}, { parentId: "b" }), node("b", {}, { parentId: "a" })])).issues.cycle).toBe(true);
        expect(indexDocument(comp([node("", {})])).issues.invalidRoot).toBe(true);
        expect(indexDocument(comp([node("a", { x: "=[g" })])).issues.unparsable).toBe(true);
        expect(indexDocument(comp([node("a")], [cmd("c", "a", 0, { x: "=1+" })])).issues.unparsable).toBe(true);
        expect(indexDocument(comp([node("a", { x: "=[nope]" })])).issues.unresolvedRefs).toBe(true);
        expect(indexDocument(comp([node("a", { x: "=[k.x]" })])).issues.unresolvedRefs).toBe(true);
    });

    it("indexes an audio document as its lowered composition", () => {
        const doc: AudioDocument = {
            kind: "audio",
            nodes: [{ id: "s", type: "sound", parentId: null, layerOrder: 0, props: {}, startAt: 1 }],
            commands: [cmd("c", null, 1)],
        };
        const index = indexDocument(doc);
        expect(index.nodes.get(AUDIO_ROOT_ID)?.type).toBe("audioBus");
        expect(index.children(AUDIO_ROOT_ID)).toEqual(["s"]);
        expect(index.byTarget.get(AUDIO_ROOT_ID)).toEqual(["c"]);
    });
});

describe("indexDocument on a still", () => {
    const still: StillDocument = {
        kind: "still",
        variables: [{ id: "unit", value: 8 }],
        nodes: [
            { id: "p", type: "rect", parentId: null, layerOrder: 1, props: { x: "=[unit]*2" }, key: "panel" },
            { id: "c", type: "rect", parentId: "p", layerOrder: 0, props: { y: "=[panel.x]" } },
            { id: "d", type: "rect", parentId: null, layerOrder: 0, props: {} },
        ],
    };
    const index = indexDocument(still);

    it("indexes its rows and synthesizes the root, like any other clip", () => {
        expect(index.doc).toBe(still);
        expect(index.nodeCount).toBe(3);
        expect(index.nodes.get("")?.type).toBe("canvas2d");
        expect(index.keyed.get("panel")).toBe("p");
        expect(index.children("")).toEqual(["d", "p"]);
        expect(index.descendants("")).toEqual(["d", "p", "c"]);
        expect(Object.values(index.issues).some(Boolean)).toBe(false);
    });

    it("has no commands, so no targets, no order and no length", () => {
        expect(index.ordered).toEqual([]);
        expect(index.commands.size).toBe(0);
        expect(index.byTarget.size).toBe(0);
        expect(index.commandsAt(0)).toEqual([]);
        expect(index.duration).toBe(0);
    });

    it("has every row present for good, with nothing to capture", () => {
        for (const id of ["p", "c", "d", ""]) {
            expect(index.effSpan(id)).toEqual({ start: 0, end: Infinity });
            expect(index.initialKey(id)).toBe("mounted");
            expect(index.captureKey(id)).toBe("none");
            expect(index.captureTime(id)).toBeUndefined();
        }
    });

    it("still reads the references in its props", () => {
        expect(index.refs("p").vars).toEqual(["unit"]);
        expect(index.refs("c").keys).toEqual([["panel", "x"]]);
        expect([...index.dependents.byVar.get("unit")!]).toEqual(["p"]);
        expect([...index.dependents.byKey.get("panel")!]).toEqual(["c"]);
        expect(index.issues.unresolvedRefs).toBe(false);
    });
});

describe("indexDocument on a document with a parent cycle", () => {
    const cyclic = comp([
        node("a", {}, { parentId: "b", startAt: 1 }),
        node("b", {}, { parentId: "a", endAt: 5 }),
        node("solo", {}, { startAt: 2 }),
    ]);
    const index = indexDocument(cyclic);

    it("flags it, and does not raise it for a row outside the loop", () => {
        expect(index.issues.cycle).toBe(true);
        expect(index.issues.unresolvedParent).toBe(false);
    });

    it("terminates every walk that follows parents", () => {
        expect(index.descendants("a")).toEqual(["b"]);
        expect(index.descendants("b")).toEqual(["a"]);
        // What the answer is for a row in a loop depends on which was asked first; that it comes is the point.
        expect(index.effSpan("a")).toBeDefined();
        expect(index.effSpan("b")).toBeDefined();
        expect(index.initialKey("a")).toBe("absent");
        expect(index.captureTime("a")).toBeUndefined();
    });

    it("keeps an unrelated row's span", () => {
        expect(index.effSpan("solo")).toEqual({ start: 2, end: Infinity });
    });

    it("cycles through itself too", () => {
        const self = indexDocument(comp([node("a", {}, { parentId: "a", startAt: 3 })]));
        expect(self.issues.cycle).toBe(true);
        expect(self.descendants("a")).toEqual([]);
        expect(self.effSpan("a")).toEqual({ start: 3, end: Infinity });
    });
});

describe("indexDocument and an id no row declares", () => {
    const index = indexDocument(comp([node("a")], [cmd("c", "a", 1)]));

    it("has no span for it, and no children", () => {
        expect(index.ownSpan("ghost")).toBeUndefined();
        expect(index.effSpan("ghost")).toBeUndefined();
        expect(index.children("ghost")).toEqual([]);
        expect(index.descendants("ghost")).toEqual([]);
    });

    it("has no references, bindings or readers either", () => {
        expect(index.refs("ghost")).toEqual({ vars: [], keys: [], unparsable: 0 });
        expect(index.bindings("ghost").size).toBe(0);
        expect(index.dependents.byVar.get("ghost")).toBeUndefined();
    });

    it("is absent at the start rather than mounted", () => {
        expect(index.initialKey("ghost")).toBe("absent");
        expect(index.captureKey("ghost")).toBe("none");
        expect(index.captureTime("ghost")).toBeUndefined();
    });

    it("answers commandsAt for a time nothing starts at with an empty list", () => {
        expect(index.commandsAt(0.5)).toEqual([]);
    });
});

describe("indexDocument and what references resolve to", () => {
    it("treats a node reached by id but never given a key as unresolved", () => {
        // `[card.x]` names a key; the node's id is not a handle.
        const index = indexDocument(comp([node("card"), node("reader", { x: "=[card.x]" })]));
        expect(index.issues.unresolvedRefs).toBe(true);
        expect(index.keyed.has("card")).toBe(false);
        expect([...index.dependents.byKey.get("card")!]).toEqual(["reader"]);
    });

    it("lists a reader under every variable and key it names, once", () => {
        const index = indexDocument(comp(
            [
                node("k1", {}, { key: "first" }),
                node("k2", {}, { key: "second" }),
                node("reader", { x: "=[g]+[h]", y: "=[g]*[first.x]", z: "=[second.y]+[first.x]" }),
            ],
            [],
            [{ id: "g", value: 0 }, { id: "h", value: 0 }],
        ));
        expect([...index.dependents.byVar.get("g")!]).toEqual(["reader"]);
        expect([...index.dependents.byVar.get("h")!]).toEqual(["reader"]);
        expect([...index.dependents.byKey.get("first")!]).toEqual(["reader"]);
        expect([...index.dependents.byKey.get("second")!]).toEqual(["reader"]);
        expect(index.refs("reader").vars).toEqual(["g", "h"]);
        expect(index.refs("reader").keys).toEqual([["first", "x"], ["second", "y"]]);
    });

    it("counts an unparsable formula without losing the references of the parsable ones", () => {
        const index = indexDocument(comp([node("a", { x: "=[g", y: "=[h]" })], [], [{ id: "h", value: 0 }]));
        expect(index.issues.unparsable).toBe(true);
        expect(index.refs("a").vars).toEqual(["h"]);
        expect(index.issues.unresolvedRefs).toBe(false);
    });
});
