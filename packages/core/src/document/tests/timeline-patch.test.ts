import { describe, expect, it } from "vitest";

import type { CommandTraits } from "../command-traits";
import { diffClip } from "../diff";
import { indexDocument } from "../doc-index";
import { planTimelinePatch, type PatchEnvironment, type PatchOptions } from "../timeline-patch";
import type { CommandSpec, CompositionDocument, TimedNodeSpec, VariableSpec } from "../types";

const node = (id: string, props: Record<string, unknown> = {}, extra: Partial<TimedNodeSpec> = {}): TimedNodeSpec =>
    ({ id, type: "rect", parentId: null, layerOrder: 0, props, ...extra });

const cmd = (id: string, targetId: string | null, at: number, args: Record<string, unknown> = {}, type = "to"): CommandSpec =>
    ({ id, type, targetId, at, args });

const comp = (nodes: TimedNodeSpec[], commands: CommandSpec[] = [], variables?: VariableSpec[]): CompositionDocument =>
    ({ kind: "composition", nodes, commands, ...(variables && { variables }) });

const LAYOUT_NEUTRAL = new Set(["fill", "opacity", "x", "y", "rotation", "volume"]);

function fakeTraits(spec: CommandSpec): CommandTraits | null {
    const base = { scope: "node" as const, known: true, lifecycle: false, readsLayout: false, writesLayout: false };
    switch (spec.type) {
        case "to":
        case "set":
            return { ...base, writesLayout: Object.keys(spec.args).some((k) => !LAYOUT_NEUTRAL.has(k)) };
        case "align": return { ...base, readsLayout: true };
        case "play": return base;
        case "wobble": return { ...base, known: false };
        case "addChildAt": return { ...base, lifecycle: true, writesLayout: true };
        case "variableTo": return { ...base, scope: "variable" };
        default: return null;
    }
}

function env(overrides: Partial<PatchEnvironment> = {}): PatchEnvironment {
    return {
        traits: (spec) => fakeTraits(spec),
        isContextProvider: (type) => type === "default-text-style",
        isLayoutNeutralProp: (_type, key) => LAYOUT_NEUTRAL.has(key),
        ctorOf: () => undefined,
        registeredCtor: () => undefined,
        dimensionOf: (type) => (type === "sound" ? "audio" : "2d"),
        ...overrides,
    };
}

function plan(prev: CompositionDocument, next: CompositionDocument, e = env(), options?: PatchOptions) {
    return planTimelinePatch(indexDocument(prev), indexDocument(next), diffClip(prev, next), e, options);
}

const sorted = (set: ReadonlySet<string>) => [...set].sort();

describe("planTimelinePatch", () => {
    it("re-instantiates a node whose fill changed without touching layout", () => {
        const doc = (fill: string) => comp(
            [node("a", { fill }), node("b"), node("c")],
            [cmd("move", "a", 0, { x: 10 }), cmd("snap", "b", 1, {}, "align")],
        );
        const patch = plan(doc("red"), doc("blue"))!;
        expect(patch).not.toBeNull();
        expect(sorted(patch.reinstantiate)).toEqual(["a"]);
        expect(sorted(patch.dirtyNodes)).toEqual(["a"]);
        expect(patch.layoutChanged).toBe(false);
        expect(patch.replay).toEqual(new Set());
        expect(sorted(patch.detach)).toEqual(["a"]);
        expect(patch.captures).toEqual([]);
    });

    it("dirties a layout reader elsewhere when a width changes", () => {
        const doc = (width: number) => comp(
            [node("a", { width }), node("b"), node("c")],
            [cmd("snap", "b", 1, {}, "align"), cmd("move", "c", 0, { x: 1 })],
        );
        const patch = plan(doc(100), doc(200))!;
        expect(sorted(patch.reinstantiate)).toEqual(["a"]);
        expect(patch.layoutChanged).toBe(true);
        expect(sorted(patch.dirtyNodes)).toEqual(["b"]);
        expect(patch.replay).toBe("all");
    });

    it("dirties only the targeted nodes bound to a variable whose value changed", () => {
        const doc = (value: number) => comp(
            [
                node("bound", { x: "=[g]" }),
                node("boundIdle", { x: "=[g]" }),
                node("other"),
                node("plain"),
            ],
            [cmd("t1", "bound", 0, { y: 1 }), cmd("t2", "other", 0, { y: 2 })],
            [{ id: "g", value }],
        );
        const patch = plan(doc(0), doc(5))!;
        expect(sorted(patch.dirtyVariables)).toEqual(["g"]);
        expect(sorted(patch.dirtyNodes)).toEqual(["bound"]);
        expect(patch.reinstantiate.size).toBe(0);
        expect(patch.layoutChanged).toBe(false);
        expect(patch.replay).toEqual(new Set());
    });

    it("treats a variable bound into a layout prop as a layout change", () => {
        const doc = (value: number) => comp(
            [node("a", { width: "=[g]" }), node("b")],
            [cmd("snap", "b", 1, {}, "align")],
            [{ id: "g", value }],
        );
        const patch = plan(doc(10), doc(20))!;
        expect(patch.layoutChanged).toBe(true);
        expect(sorted(patch.dirtyNodes)).toEqual(["b"]);
    });

    it("propagates through an untargeted keyed reader to its own readers", () => {
        const doc = (value: number) => comp(
            [
                node("mid", { x: "=[g]" }, { key: "mid" }),
                node("reader", { x: "=[mid.x]" }),
                node("filler"),
            ],
            [cmd("t", "reader", 0, { y: 1 })],
            [{ id: "g", value }],
        );
        const patch = plan(doc(1), doc(2))!;
        expect(sorted(patch.dirtyNodes)).toEqual(["reader"]);
    });

    it("dirties readers of a keyed node that changed", () => {
        const doc = (fill: string) => comp(
            [node("card", { fill }, { key: "card" }), node("reader", { opacity: "=[card.opacity]" }), node("filler")],
            [cmd("t", "reader", 0, { y: 1 })],
        );
        const patch = plan(doc("red"), doc("blue"))!;
        expect(sorted(patch.reinstantiate)).toEqual(["card"]);
        expect(sorted(patch.dirtyNodes)).toEqual(["reader"]);
    });

    it("re-instantiates a context provider's whole subtree", () => {
        const doc = (fontSize: number) => comp([
            { ...node("p", { fontSize }), type: "default-text-style" },
            { ...node("t1", {}, { parentId: "p" }), type: "text" },
            { ...node("t2", {}, { parentId: "t1" }), type: "text" },
            node("f1"), node("f2"), node("f3"),
        ], [cmd("t", "t2", 0, { y: 1 })]);
        const patch = plan(doc(10), doc(20))!;
        expect(sorted(patch.reinstantiate)).toEqual(["p", "t1", "t2"]);
        expect(sorted(patch.dirtyNodes)).toEqual(["t2"]);
        expect(sorted(patch.detach)).toEqual(["p", "t1", "t2"]);
    });

    it("re-instantiates the subtree of a node moved out from under a provider", () => {
        const prev = comp([
            { ...node("p"), type: "default-text-style" },
            node("box", {}, { parentId: "p" }),
            { ...node("label", {}, { parentId: "box" }), type: "text" },
            node("f1"), node("f2"), node("f3"),
        ]);
        const next = comp([
            { ...node("p"), type: "default-text-style" },
            node("box"),
            { ...node("label", {}, { parentId: "box" }), type: "text" },
            node("f1"), node("f2"), node("f3"),
        ]);
        const patch = plan(prev, next)!;
        expect(sorted(patch.reinstantiate)).toEqual(["box", "label"]);
        expect(patch.layoutChanged).toBe(true);
    });

    it("rebuilds when a lifecycle command is on either side", () => {
        const plain = comp([node("a"), node("b")], [cmd("t", "a", 0, { x: 1 })]);
        const structural = comp([node("a"), node("b")], [cmd("t", "a", 0, { x: 1 }), cmd("s", "a", 1, {}, "addChildAt")]);
        expect(plan(plain, structural)).toBeNull();
        expect(plan(structural, plain)).toBeNull();
    });

    it("rebuilds when a command does not resolve, or its target is the wrong kind", () => {
        const base = comp([node("a"), node("b")], [], [{ id: "g", value: 0 }]);
        expect(plan(base, { ...base, commands: [cmd("x", "a", 0, {}, "mystery")] })).toBeNull();
        expect(plan(base, { ...base, commands: [cmd("x", "a", 0, { value: 1 }, "variableTo")] })).toBeNull();
        expect(plan(base, { ...base, commands: [cmd("x", "g", 0, { x: 1 })] })).toBeNull();
    });

    it("patches the root row's props in place, dirtying its chain and whoever reads it", () => {
        const doc = (root: Record<string, unknown>) => comp(
            [
                { id: "", type: "canvas2d", parentId: null, layerOrder: 0, key: "stage", props: root },
                node("reader", { opacity: "=[stage.zoom]" }),
                node("idle"),
                node("snap"),
            ],
            [cmd("z", null, 0, { opacity: 0.5 }), cmd("r", "reader", 1, { x: 1 }), cmd("s", "snap", 1, {}, "align")],
        );
        const paint = plan(doc({ fill: "red" }), doc({ fill: "blue" }))!;
        expect(paint.reinstantiate.size).toBe(0);
        expect(sorted(paint.dirtyNodes)).toEqual(["", "reader"]);
        expect(paint.layoutChanged).toBe(false);

        const layout = plan(doc({ gap: 4 }), doc({ gap: 8 }))!;
        expect(layout.layoutChanged).toBe(true);
        expect(sorted(layout.dirtyNodes)).toEqual(["", "reader", "snap"]);
    });

    it("rebuilds when the root row changes anything but its props", () => {
        const doc = (root: Partial<TimedNodeSpec>) => comp([
            { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {}, ...root },
            node("a"), node("b"),
        ]);
        expect(plan(doc({}), doc({ key: "stage" }))).toBeNull();
        expect(plan(doc({}), doc({ endAt: 2 }))).toBeNull();
        expect(plan(doc({}), doc({ layerOrder: 1 }))).toBeNull();
    });

    it("rebuilds when a key moves to another node", () => {
        const prev = comp([node("a", {}, { key: "card" }), node("b"), node("r", { x: "=[card.x]" })]);
        const next = comp([node("a"), node("b", {}, { key: "card" }), node("r", { x: "=[card.x]" })]);
        expect(plan(prev, next)).toBeNull();
    });

    it("rebuilds on an unparsable or unresolved expression in the next document", () => {
        const prev = comp([node("a"), node("b"), node("c")]);
        expect(plan(prev, comp([node("a", { x: "=[g" }), node("b"), node("c")]))).toBeNull();
        expect(plan(prev, comp([node("a", { x: "=[g]" }), node("b"), node("c")]))).toBeNull();
    });

    it("dirties every target of a reordered same-at group, and nothing else", () => {
        const nodes = [node("a"), node("b"), node("c")];
        const prev = comp(nodes, [cmd("c1", "a", 1, { x: 1 }), cmd("c2", "b", 1, { x: 2 }), cmd("c3", "c", 2, { x: 3 })]);
        const next = comp(nodes, [cmd("c2", "b", 1, { x: 2 }), cmd("c1", "a", 1, { x: 1 }), cmd("c3", "c", 2, { x: 3 })]);
        const patch = plan(prev, next)!;
        expect(sorted(patch.dirtyNodes)).toEqual(["a", "b"]);
        expect(patch.reinstantiate.size).toBe(0);
        expect(patch.detach.size).toBe(0);
    });

    it("dirties a chain whose order on its target changed", () => {
        const nodes = [node("a"), node("b")];
        const prev = comp(nodes, [cmd("c1", "a", 1, { x: 1 }), cmd("c2", "a", 2, { x: 2 }), cmd("c3", "b", 1, { x: 3 })]);
        const next = comp(nodes, [cmd("c1", "a", 3, { x: 1 }), cmd("c2", "a", 2, { x: 2 }), cmd("c3", "b", 1, { x: 3 })]);
        expect(sorted(plan(prev, next)!.dirtyNodes)).toEqual(["a"]);
    });

    it("dirties the node, its children and layout readers when a span changes", () => {
        const doc = (startAt: number) => comp(
            [node("a", {}, { startAt }), node("c", {}, { parentId: "a" }), node("b"), node("idle")],
            [cmd("ta", "a", 2, { x: 1 }), cmd("tc", "c", 2, { y: 1 }), cmd("snap", "b", 3, {}, "align")],
        );
        const patch = plan(doc(1), doc(1.5))!;
        expect(sorted(patch.dirtyNodes)).toEqual(["a", "b", "c"]);
        expect(patch.reinstantiate.size).toBe(0);
        expect(patch.layoutChanged).toBe(true);
        expect(patch.captures).toEqual([{ at: 2, id: "a" }]);
    });

    it("dirties a targeted node whose arrival capture moved", () => {
        const nodes = [node("a", {}, { startAt: 1 }), node("b")];
        const prev = comp(nodes, [cmd("early", "b", 1.5, { x: 1 }), cmd("ta", "a", 2, { x: 1 })]);
        const next = comp(nodes, [cmd("early", "b", 0.5, { x: 1 }), cmd("ta", "a", 2, { x: 1 })]);
        const patch = plan(prev, next)!;
        expect(sorted(patch.dirtyNodes)).toEqual(["a", "b"]);
        expect(patch.captures).toEqual([{ at: 2, id: "a" }]);
    });

    it("re-instantiates a targeted node whose t=0 state changed", () => {
        const doc = (startAt: number) => comp([node("a", {}, { startAt }), node("b")], [cmd("ta", "a", 1, { x: 1 })]);
        const patch = plan(doc(0), doc(1))!;
        expect(sorted(patch.reinstantiate)).toEqual(["a"]);
        expect(sorted(patch.dirtyNodes)).toEqual(["a"]);
        expect(patch.captures).toEqual([{ at: 1, id: "a" }]);
    });

    it("re-instantiates a dirty node carrying an unknown command", () => {
        const doc = (x: number) => comp([node("a"), node("b"), node("c")], [cmd("t", "a", 0, { x }), cmd("w", "a", 1, {}, "wobble")]);
        const patch = plan(doc(1), doc(2))!;
        expect(sorted(patch.reinstantiate)).toEqual(["a"]);
        expect(sorted(patch.dirtyNodes)).toEqual(["a"]);
        expect(patch.replay).toBe("all");
    });

    it("leaves a clean node's unknown command alone", () => {
        const doc = (x: number) => comp([node("a"), node("b")], [cmd("t", "a", 0, { x }), cmd("w", "b", 1, {}, "wobble")]);
        const patch = plan(doc(1), doc(2))!;
        expect(patch.reinstantiate.size).toBe(0);
        expect(patch.replay).toEqual(new Set());
    });

    it("rebuilds when the dirty root carries an unknown command", () => {
        const doc = (x: number) => comp([node("a")], [cmd("t", null, 0, { x }), cmd("w", null, 1, {}, "wobble")]);
        expect(plan(doc(1), doc(2))).toBeNull();
    });

    it("re-instantiates a node whose registered class changed", () => {
        const Old = class {};
        const New = class {};
        const doc = comp([node("a"), node("b"), node("c")]);
        const patch = plan(doc, structuredClone(doc), env({
            ctorOf: (id) => (id === "a" ? Old : New),
            registeredCtor: () => New,
        }))!;
        expect(sorted(patch.reinstantiate)).toEqual(["a"]);
        expect(patch.layoutChanged).toBe(true);
    });

    it("rebuilds past the re-instantiation fraction", () => {
        const doc = (fill: string) => comp(Array.from({ length: 40 }, (_, i) => node(`n${i}`, i < 21 ? { fill } : {})));
        expect(plan(doc("red"), doc("blue"))).toBeNull();
        expect(plan(doc("red"), doc("blue"), env(), { rebuildFraction: 1 })).not.toBeNull();
    });

    it("patches a small clip however much of it an edit re-instantiates", () => {
        const one = (x: number) => comp([node("a", { x })], [cmd("t", "a", 0, { y: 1 })]);
        expect(sorted(plan(one(1), one(2))!.reinstantiate)).toEqual(["a"]);

        const doc = (fill: string) => comp(Array.from({ length: 16 }, (_, i) => node(`n${i}`, { fill })));
        expect(plan(doc("red"), doc("blue"))!.reinstantiate.size).toBe(16);
        expect(plan(doc("red"), doc("blue"), env(), { minRebuildNodes: 0 })).toBeNull();
    });

    it("replays the variables and keyed nodes a dirty chain's bindings read", () => {
        const doc = (y: number) => comp(
            [
                node("a", { x: "=[card.x]" }),
                node("cardNode", { x: "=[h]" }, { key: "card" }),
                node("f1"), node("f2"),
            ],
            [
                cmd("ta", "a", 0, { y }),
                cmd("tc", "cardNode", 0, { rotation: 1 }),
                cmd("vh", "h", 0, { value: 3 }, "variableTo"),
            ],
            [{ id: "h", value: 0 }],
        );
        const patch = plan(doc(1), doc(2))!;
        expect(sorted(patch.dirtyNodes)).toEqual(["a"]);
        expect(sorted(patch.replay as Set<string>)).toEqual(["cardNode", "h"]);
    });

    it("detaches kept children of a reordered parent and reports layout", () => {
        const doc = (order: [number, number]) => comp([
            node("p"),
            node("a", {}, { parentId: "p", layerOrder: order[0] }),
            node("b", {}, { parentId: "p", layerOrder: order[1] }),
        ]);
        const patch = plan(doc([0, 1]), doc([1, 0]))!;
        expect(sorted(patch.detach)).toEqual(["a", "b"]);
        expect(patch.layoutChanged).toBe(true);
    });

    it("detaches a moved node's children with it", () => {
        const doc = (parentId: string) => comp([
            node("p1"), node("p2"),
            node("a", {}, { parentId }),
            node("a1", {}, { parentId: "a" }),
        ]);
        const patch = plan(doc("p1"), doc("p2"))!;
        expect(sorted(patch.reinstantiate)).toEqual(["a"]);
        expect(sorted(patch.detach)).toEqual(["a", "a1"]);
    });

    it("plans an added node's chain and arrival capture", () => {
        const prev = comp([node("a"), node("b")]);
        const next = comp([node("a"), node("b"), node("late", {}, { startAt: 2 })], [cmd("t", "late", 2, { x: 1 })]);
        const patch = plan(prev, next)!;
        expect(sorted(patch.added)).toEqual(["late"]);
        expect(sorted(patch.dirtyNodes)).toEqual(["late"]);
        expect(patch.captures).toEqual([{ at: 2, id: "late" }]);
        expect(patch.layoutChanged).toBe(true);
    });

    it("leaves layout alone when only audio structure changes", () => {
        const prev = comp([node("a"), node("b")], [cmd("snap", "b", 1, {}, "align")]);
        const next = comp([node("a"), node("b"), { ...node("s"), type: "sound" }], [cmd("snap", "b", 1, {}, "align")]);
        const patch = plan(prev, next)!;
        expect(patch.layoutChanged).toBe(false);
        // Only the sound's own `play`, which it gets over its span, is built.
        expect(sorted(patch.dirtyNodes)).toEqual(["s"]);
    });

    it("plans nothing for a semantically identical document", () => {
        const doc = comp([node("a", { x: "=[g]" }), node("b")], [cmd("t", "a", 0, { y: 1 })], [{ id: "g", value: 0, name: "G" }]);
        const patch = plan(doc, { ...structuredClone(doc), variables: [{ id: "g", value: 0 }] })!;
        expect(patch.dirtyNodes.size + patch.dirtyVariables.size + patch.reinstantiate.size + patch.detach.size).toBe(0);
        expect(patch.layoutChanged).toBe(false);
    });
});

describe("planTimelinePatch refuses what it cannot reason about", () => {
    const base = () => comp(
        [node("a"), node("b"), node("c")],
        [cmd("t", "a", 0, { x: 1 })],
    );

    it("plans a patch for the unfaulted base, so each refusal below is the fault's", () => {
        expect(plan(base(), { ...base(), nodes: [node("a", { x: 5 }), node("b"), node("c")] })).not.toBeNull();
    });

    it("rebuilds when the kind of clip changed", () => {
        const still = { kind: "still" as const, nodes: [node("a"), node("b"), node("c")] };
        const prev = indexDocument(base());
        const next = indexDocument(still);
        expect(planTimelinePatch(prev, next, diffClip(base(), still), env())).toBeNull();
        expect(planTimelinePatch(next, prev, diffClip(still, base()), env())).toBeNull();
    });

    it("rebuilds when the clip's theme changed, because colours resolved against it as props were written", () => {
        const themed = (primary: string): CompositionDocument => ({ ...base(), theme: { colors: { primary } } });
        expect(plan(themed("#f00"), themed("#00f"))).toBeNull();
        expect(plan(base(), themed("#f00"))).toBeNull();
        expect(plan(themed("#f00"), base())).toBeNull();
        expect(plan(themed("#f00"), themed("#f00"))).not.toBeNull();
    });

    describe("a structural fault in either document", () => {
        const faults: Array<[string, (doc: CompositionDocument) => CompositionDocument]> = [
            ["a duplicate node id", (d) => ({ ...d, nodes: [...d.nodes, node("a")] })],
            ["a duplicate command id", (d) => ({ ...d, commands: [...d.commands, cmd("t", "b", 1, { x: 2 })] })],
            ["a node id a variable also claims", (d) => ({ ...d, variables: [{ id: "a", value: 0 }] })],
            ["a duplicate key", (d) => ({ ...d, nodes: [node("a", {}, { key: "k" }), node("b", {}, { key: "k" }), node("c")] })],
            ["a parent no row declares", (d) => ({ ...d, nodes: [node("a", {}, { parentId: "ghost" }), node("b"), node("c")] })],
            ["a parent cycle", (d) => ({ ...d, nodes: [node("a", {}, { parentId: "b" }), node("b", {}, { parentId: "a" }), node("c")] })],
            ["a root that is not an unparented canvas", (d) => ({ ...d, nodes: [{ ...node(""), type: "rect" }, ...d.nodes] })],
            ["a root with a parent", (d) => ({ ...d, nodes: [{ ...node("", {}, { parentId: "a" }), type: "canvas2d" }, ...d.nodes] })],
        ];

        it.each(faults)("rebuilds on %s in the next document", (_, fault) => {
            expect(plan(base(), fault(base()))).toBeNull();
        });

        it.each(faults)("rebuilds on %s in the previous document", (_, fault) => {
            expect(plan(fault(base()), base())).toBeNull();
        });

        it.each(faults)("rebuilds on %s when both documents carry it", (_, fault) => {
            expect(plan(fault(base()), fault(base()))).toBeNull();
        });
    });

    it("rebuilds when an expression in the next document names a variable or a key nothing declares", () => {
        const withX = (x: unknown) => comp([node("a", { x }), node("b"), node("c")]);
        expect(plan(withX(1), withX("=[ghost]"))).toBeNull();
        expect(plan(withX(1), withX("=[ghost.x]"))).toBeNull();
        expect(plan(withX(1), withX("=[1+"))).toBeNull();
    });

    it("rebuilds when a command carries an expression it cannot parse", () => {
        const prev = comp([node("a"), node("b"), node("c")], [cmd("s", "a", 0, { x: 1 }, "set")]);
        const next = comp([node("a"), node("b"), node("c")], [cmd("s", "a", 0, { x: "=1+" }, "set")]);
        expect(plan(prev, next)).toBeNull();
    });

    it("lets an unresolved expression in the previous document alone, since only the next one is built", () => {
        const broken = comp([node("a", { x: "=[ghost]" }), node("b"), node("c")]);
        const fixed = comp([node("a", { x: 1 }), node("b"), node("c")]);
        expect(plan(broken, fixed)).not.toBeNull();
    });
});

describe("planTimelinePatch and an unlimited loop", () => {
    const spinner = (duration: number): CompositionDocument => ({
        kind: "composition",
        duration,
        nodes: [node("a"), node("b"), node("c")],
        commands: [
            { id: "spin", type: "to", targetId: "a", at: 0, duration: 1, args: { rotation: 90 }, loop: { count: null } },
            cmd("other", "b", 0, { x: 4 }),
        ],
    });

    it("dirties the node whose loop fills the clip when the clip's duration changes", () => {
        const patch = plan(spinner(4), spinner(6))!;
        expect(sorted(patch.dirtyNodes)).toEqual(["a"]);
        expect(patch.reinstantiate.size).toBe(0);
    });

    it("leaves a counted loop and an unlooped chain alone", () => {
        const counted = (duration: number): CompositionDocument => ({
            ...spinner(duration),
            commands: [{ id: "spin", type: "to", targetId: "a", at: 0, duration: 1, args: { rotation: 90 }, loop: { count: 3 } }],
        });
        expect(plan(counted(4), counted(6))!.dirtyNodes.size).toBe(0);
        expect(plan(spinner(4), spinner(4))!.dirtyNodes.size).toBe(0);
    });

    it("dirties it again when a length the commands imply changes, with no declared duration", () => {
        const implied = (lastAt: number): CompositionDocument => ({
            ...spinner(4),
            duration: undefined,
            commands: [
                { id: "spin", type: "to", targetId: "a", at: 0, duration: 1, args: { rotation: 90 }, loop: { count: null } },
                cmd("tail", "b", lastAt, { x: 4 }),
            ],
        });
        expect(sorted(plan(implied(3), implied(5))!.dirtyNodes)).toEqual(expect.arrayContaining(["a"]));
    });
});
