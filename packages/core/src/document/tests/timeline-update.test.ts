import { describe, expect, it } from "vitest";

import { Rect } from "@/components/builtins/geometry/geometry";
import {
    countingRegistry,
    documentKeyTimes,
    expectIncrementalMatchesFresh,
    sampleTimes,
    snapshotClip,
    TimelineClip,
} from "@/runtime/clip-snapshot.fixtures";
import { runtimeScope } from "@/runtime/document.fixtures";

import { Registry, type NodeConstructor } from "../registry";
import { documentDuration, type CommandSpec, type CompositionDocument, type StillDocument, type TimedNodeSpec, type VariableSpec } from "../types";
import { validateDocument } from "../validate";
import { generated } from "@/components/factory/tests/generated.fixtures";
import { component2d } from "@/components/factory/component2d";
import * as Paint from "@/components/modules/paint";
import type { Node2D } from "@/components/trees/2d/node2d";
import { Graphics2D } from "@/render/graphics2d";

const box = (id: string, props: Record<string, unknown> = {}, extra: Partial<TimedNodeSpec> = {}): TimedNodeSpec =>
    ({ id, type: "rect", parentId: null, layerOrder: 0, props: { width: 20, height: 20, ...props }, ...extra });

const cmd = (id: string, type: string, targetId: string | null, at: number, args: Record<string, unknown>, duration = 1): CommandSpec =>
    ({ id, type, targetId, at, duration, args });

const comp = (nodes: TimedNodeSpec[], commands: CommandSpec[] = [], variables?: VariableSpec[], duration = 4): CompositionDocument =>
    ({ kind: "composition", nodes, commands, duration, ...(variables && { variables }) });

/** Untouched rows beside the edited ones. */
const fillers = (): TimedNodeSpec[] => [
    box("f1", { x: -60 }, { layerOrder: 5 }),
    box("f2", { x: 60 }, { layerOrder: 6 }),
    box("f3", { y: 40 }, { layerOrder: 7 }),
];

const edit = <T extends { id: string }>(rows: T[], id: string, change: (row: T) => T): T[] =>
    rows.map((row) => (row.id === id ? change(row) : row));

describe("ClipTimeline.applyUpdate matches a fresh build", () => {
    describe("node props", () => {
        const doc = (x: number, fill = "red") => comp(
            [box("a", { x, fill }), ...fillers()],
            [cmd("s1", "to", "a", 0, { x: 40 }), cmd("s2", "to", "a", 1, { x: 10 }), cmd("fade", "fadeTo", "a", 2, { opacity: 0.5 }, 0.5)],
        );

        it("writes a leaf's moved x in place, under its `to` chain", () => {
            const { patch } = expectIncrementalMatchesFresh(doc(0), doc(25));
            expect([...patch!.reinstantiate]).toEqual([]);
            expect([...patch!.inPlace]).toEqual(["a"]);
            expect(patch!.layoutChanged).toBe(false);
        });

        it("re-instantiates a leaf whose moved x it turns into an anchor", () => {
            const anchored = (x: number) => comp([box("a", { x, topLeft: { x: 5, y: 5 } }), ...fillers()], [cmd("s1", "to", "a", 0, { y: 40 })]);
            const { patch } = expectIncrementalMatchesFresh(anchored(0), anchored(25));
            expect([...patch!.reinstantiate]).toEqual(["a"]);
        });

        it("re-instantiates a leaf whose paint changed", () => {
            expectIncrementalMatchesFresh(doc(0, "red"), doc(0, "blue"));
        });

        it("rebuilds a flow group's box around its document children", () => {
            const group = (gap: number) => comp([
                box("g", { flow: "horizontal", gap, width: 200, height: 60 }),
                box("a", { width: 30, height: 30 }, { parentId: "g" }),
                { id: "t", type: "text", parentId: "g", layerOrder: 1, props: { text: "hi", fontSize: 12 } },
                box("b", { width: "fill", height: 20 }, { parentId: "g", layerOrder: 2 }),
                ...fillers(),
            ], [
                cmd("ga", "to", "a", 0, { y: 5 }),
                cmd("gg", "to", "g", 0.5, { opacity: 0.5 }),
                cmd("gt", "to", "t", 1, { rotation: 10 }),
                cmd("gb", "to", "b", 1.5, { height: 40 }),
            ]);
            const { patch } = expectIncrementalMatchesFresh(group(10), group(24));
            expect([...patch!.reinstantiate]).toEqual(["g"]);
            expect([...patch!.detach].sort()).toEqual(["a", "b", "g", "t"]);
        });
    });

    describe("added and removed nodes", () => {
        const base = [box("a"), ...fillers()];
        const baseCommands = [cmd("sa", "to", "a", 0, { x: 30 })];

        it("adds a node present from the start", () => {
            expectIncrementalMatchesFresh(
                comp(base, baseCommands),
                comp([...base, box("n", { x: 30 }, { layerOrder: 1 })], [...baseCommands, cmd("sn", "to", "n", 0.5, { x: 60 })]),
            );
        });

        it("adds a node entering later with a fade on arrival", () => {
            const { patch } = expectIncrementalMatchesFresh(
                comp(base, baseCommands),
                comp(
                    [...base, box("n", { opacity: 0 }, { startAt: 1.5, layerOrder: 1 })],
                    [...baseCommands, cmd("fn", "fadeTo", "n", 1.5, { opacity: 1 }, 0.5)],
                ),
            );
            expect(patch!.captures).toEqual([{ at: 1.5, id: "n" }]);
        });

        it("removes a node and its commands", () => {
            expectIncrementalMatchesFresh(
                comp([...base, box("n", {}, { layerOrder: 1 })], [...baseCommands, cmd("sn", "to", "n", 0.5, { x: 60 })]),
                comp(base, baseCommands),
            );
        });

        it("removes a parent whose children move up to the root", () => {
            expectIncrementalMatchesFresh(
                comp([
                    ...base,
                    box("p", { flow: "vertical", width: 100, height: 100 }, { layerOrder: 1 }),
                    box("c1", {}, { parentId: "p" }),
                    box("c2", {}, { parentId: "p", layerOrder: 1 }),
                    box("f4"), box("f5"), box("f6"),
                ], [...baseCommands, cmd("sc", "to", "c1", 1, { x: 20 })]),
                comp([
                    ...base,
                    box("c1", {}, { layerOrder: 2 }),
                    box("c2", {}, { layerOrder: 3 }),
                    box("f4"), box("f5"), box("f6"),
                ], [...baseCommands, cmd("sc", "to", "c1", 1, { x: 20 })]),
            );
        });
    });

    describe("spans", () => {
        const doc = (span: Partial<TimedNodeSpec>, idle: Partial<TimedNodeSpec> = {}) => comp(
            [box("a", {}, span), box("idle", { x: 10 }, { layerOrder: 1, ...idle }), ...fillers()],
            [cmd("early", "to", "f1", 0.5, { y: 5 }), cmd("sa", "to", "a", 2.5, { x: 40 })],
        );

        it("moves a start from 0 to later, targeted and not", () => {
            expectIncrementalMatchesFresh(doc({}), doc({ startAt: 2 }, { startAt: 2 }));
        });

        it("moves a start from later to 0", () => {
            expectIncrementalMatchesFresh(doc({ startAt: 1 }, { startAt: 1 }), doc({}, {}));
        });

        it("ends a parent whose children are animated", () => {
            const parent = (endAt?: number) => comp([
                box("p", { width: 100, height: 100 }, endAt === undefined ? {} : { endAt }),
                box("c", {}, { parentId: "p" }),
                ...fillers(),
            ], [cmd("c1", "to", "c", 0.5, { x: 20 }), cmd("c2", "to", "c", 2.5, { x: 0 })]);
            expectIncrementalMatchesFresh(parent(), parent(2));
        });
    });

    describe("tree order", () => {
        it("moves a node to another parent", () => {
            const doc = (parentId: string) => comp([
                box("p1", { x: -40, width: 60, height: 60 }),
                box("p2", { x: 40, width: 60, height: 60 }, { layerOrder: 1 }),
                box("a", { width: 10, height: 10 }, { parentId }),
                ...fillers(),
            ], [cmd("sa", "to", "a", 0.5, { y: 12 })]);
            const { patch } = expectIncrementalMatchesFresh(doc("p1"), doc("p2"));
            expect([...patch!.reinstantiate]).toEqual(["a"]);
        });

        it("swaps two siblings' layerOrder", () => {
            const doc = (first: number, second: number) => comp([
                box("row", { flow: "horizontal", width: 200, height: 50 }),
                box("a", { width: 30 }, { parentId: "row", layerOrder: first }),
                box("b", { width: 50 }, { parentId: "row", layerOrder: second }),
                ...fillers(),
            ], [cmd("sa", "to", "a", 0.5, { y: 5 }), cmd("sb", "to", "b", 1, { opacity: 0.2 })]);
            expectIncrementalMatchesFresh(doc(0, 1), doc(1, 0));
        });

        it("reorders a layerOrder tie by array position", () => {
            const a = box("a", { width: 30 }, { parentId: "row" });
            const b = box("b", { width: 50 }, { parentId: "row" });
            const row = box("row", { flow: "horizontal", width: 200, height: 50 });
            const commands = [cmd("sa", "to", "a", 0.5, { y: 5 })];
            expectIncrementalMatchesFresh(comp([row, a, b, ...fillers()], commands), comp([row, b, a, ...fillers()], commands));
        });
    });

    describe("commands", () => {
        const nodes = [box("a"), box("b", { y: 10 }), ...fillers()];
        const commands = [
            cmd("a1", "to", "a", 0, { x: 40 }),
            cmd("a2", "to", "a", 1, { x: 0, y: 20 }),
            cmd("b1", "to", "b", 0.5, { rotation: 45 }),
        ];

        it("re-times, re-lengthens and re-targets a tween's destination", () => {
            expectIncrementalMatchesFresh(comp(nodes, commands), comp(nodes, edit(commands, "a1", (c) => ({ ...c, at: 0.25 }))));
            expectIncrementalMatchesFresh(comp(nodes, commands), comp(nodes, edit(commands, "a1", (c) => ({ ...c, duration: 2 }))));
            expectIncrementalMatchesFresh(comp(nodes, commands), comp(nodes, edit(commands, "a1", (c) => ({ ...c, args: { x: 90 } }))));
        });

        it("moves a tween past the next one on its target", () => {
            expectIncrementalMatchesFresh(comp(nodes, commands), comp(nodes, edit(commands, "a1", (c) => ({ ...c, at: 1.5 }))));
        });

        it("adds and removes a command", () => {
            const added = [...commands, cmd("a3", "to", "a", 0.5, { opacity: 0.3 })];
            const { constructed } = expectIncrementalMatchesFresh(comp(nodes, commands), comp(nodes, added));
            expect(constructed).toEqual([]);
            expectIncrementalMatchesFresh(comp(nodes, added), comp(nodes, commands));
        });

        it("reorders two same-`at` commands writing one prop", () => {
            const pair = [cmd("p1", "to", "a", 1, { x: 10 }), cmd("p2", "to", "a", 1, { x: 30 }), cmd("p3", "to", "a", 2, { x: 5 })];
            expectIncrementalMatchesFresh(comp(nodes, pair), comp(nodes, [pair[1], pair[0], pair[2]]));
        });

        it("edits a save/restore chain, animated and instant", () => {
            const chain = (x: number, restoreFor: number) => comp(nodes, [
                cmd("keep", "save", "a", 0, {}, 0),
                cmd("move", "to", "a", 0.5, { x, opacity: 0.4 }, 0.5),
                cmd("back", "restore", "a", 1.5, {}, restoreFor),
                cmd("after", "to", "a", 2.5, { y: 30 }),
            ]);
            expectIncrementalMatchesFresh(chain(60, 0.5), chain(90, 0.5));
            expectIncrementalMatchesFresh(chain(60, 0), chain(90, 0));
            expectIncrementalMatchesFresh(chain(60, 0.5), chain(60, 0));
        });

        it("edits a zoom on the root", () => {
            const zoom = (to: number) => comp(nodes, [...commands, cmd("z", "zoomTo", null, 0.5, { zoom: to })]);
            expectIncrementalMatchesFresh(zoom(2), zoom(3));
        });
    });

    describe("variables", () => {
        const nodes = [
            box("a", { x: "=[g]*2" }),
            box("b", { fill: "=[c]" }, { layerOrder: 1 }),
            ...fillers(),
        ];
        const commands = [
            cmd("vg", "variableTo", "g", 0.5, { value: 40 }),
            cmd("vc", "variableTo", "c", 1, { value: "blue" }),
            cmd("ta", "to", "a", 2, { x: 100 }),
        ];
        const vars = (g: number, lerp = "color"): VariableSpec[] => [{ id: "g", value: g }, { id: "c", value: "red", lerp }];

        it("changes a variable's value under a bound prop's `to`", () => {
            const { constructed } = expectIncrementalMatchesFresh(comp(nodes, commands, vars(0)), comp(nodes, commands, vars(15)));
            expect(constructed).toEqual([]);
        });

        it("changes a variable's lerp", () => {
            expectIncrementalMatchesFresh(comp(nodes, commands, vars(0, "color")), comp(nodes, commands, vars(0, "step")));
        });

        it("edits a variableTo chain", () => {
            const chained = (value: number) => comp(nodes, [...commands, cmd("vg2", "variableTo", "g", 1.5, { value })], vars(0));
            expectIncrementalMatchesFresh(chained(10), chained(70));
        });

        it("adds and removes a variable along with what reads it", () => {
            const without = comp(nodes, commands, vars(0));
            const withH = comp(
                [...nodes, box("hn", { y: "=[h]" }, { layerOrder: 2 })],
                [...commands, cmd("vh", "variableTo", "h", 1, { value: 30 })],
                [...vars(0), { id: "h", value: 5 }],
            );
            expectIncrementalMatchesFresh(without, withH);
            expectIncrementalMatchesFresh(withH, without);
        });
    });

    describe("references and layout", () => {
        it("follows a keyed node whose chain changed", () => {
            const doc = (width: number) => comp([
                box("card", { width: 40 }, { key: "card" }),
                box("r", { width: "=[card.width]", y: 30 }, { layerOrder: 1 }),
                ...fillers(),
            ], [cmd("grow", "to", "card", 0, { width }), cmd("tr", "to", "r", 0.5, { height: 35 })]);
            const { patch } = expectIncrementalMatchesFresh(doc(80), doc(120));
            expect(patch!.dirtyNodes.has("r")).toBe(true);
        });

        it("rebuilds an alignment reader whose sibling's width changed", () => {
            const doc = (width: number) => comp([
                box("row", { flow: "horizontal", width: 300, height: 100 }),
                box("s", { width }, { parentId: "row" }),
                box("a", { width: "fill", topLeft: { x: 0, y: 0 } }, { parentId: "row", layerOrder: 1 }),
                box("f4"), box("f5"), box("f6"),
            ], [cmd("slide", "to", "a", 1, { x: 50 })]);
            const { patch } = expectIncrementalMatchesFresh(doc(40), doc(80));
            expect(patch!.replay).toBe("all");
        });

        describe("a move aimed at another node", () => {
            const doc = (cardX: number, groupY = 0, extra: CommandSpec[] = []) => comp([
                box("group", { y: groupY, width: 200, height: 200 }),
                box("card", { x: cardX, width: 40, height: 20 }, { parentId: "group" }),
                box("m", { width: 10, height: 10 }, { layerOrder: 1 }),
                ...fillers(),
            ], [
                cmd("aim", "moveTo", "m", 1, { target: "card", targetAnchor: "topRight" }),
                cmd("hop", "to", "m", 2.5, { y: 5 }, 0.5),
                ...extra,
            ]);

            it("rebuilds the move when the target's own prop changes", () => {
                const { patch } = expectIncrementalMatchesFresh(doc(60), doc(-30));
                expect(patch!.dirtyNodes.has("m")).toBe(true);
            });

            it("rebuilds it when an ancestor of the target moves", () => {
                const { patch } = expectIncrementalMatchesFresh(doc(60, 0), doc(60, 45));
                expect(patch!.dirtyNodes.has("m")).toBe(true);
            });

            it("rebuilds it when the target gains a command before it", () => {
                expectIncrementalMatchesFresh(doc(60), doc(60, 0, [cmd("slide", "to", "card", 0, { x: -50 })]));
            });

            it("re-aims it at another anchor, or another node", () => {
                const aimed = (args: Record<string, unknown>) => comp(
                    doc(60).nodes,
                    [cmd("aim", "moveTo", "m", 1, args)],
                );
                expectIncrementalMatchesFresh(aimed({ target: "card" }), aimed({ target: "card", targetAnchor: { x: -0.5, y: 1 } }));
                expectIncrementalMatchesFresh(aimed({ target: "card" }), aimed({ target: "f2" }));
            });
        });

        it("rebuilds a tween to an alignment point just after its node enters", () => {
            const doc = (width: number, x: number) => comp([
                box("n", { width }, { startAt: 1 }),
                box("grow", { width: 10 }, { layerOrder: 1 }),
                ...fillers(),
            ], [
                cmd("g", "to", "grow", 1, { width: 60 }),
                cmd("c", "to", "n", 1, { center: { x, y: 0 } }),
            ]);
            expectIncrementalMatchesFresh(doc(30, 10), doc(30, 40));
            expectIncrementalMatchesFresh(doc(30, 10), doc(50, 10));
        });

        it("re-instantiates a text style's descendants when it changes", () => {
            const doc = (fontSize: number) => comp([
                { id: "style", type: "default-text-style", parentId: null, layerOrder: 0, props: { fontSize } },
                { id: "t", type: "text", parentId: "style", layerOrder: 0, props: { text: "hello" } },
                box("f4"), box("f5"), box("f6"), ...fillers(),
            ], [cmd("tt", "to", "t", 0.5, { x: 10 })]);
            const { patch } = expectIncrementalMatchesFresh(doc(20), doc(30));
            expect([...patch!.reinstantiate].sort()).toEqual(["style", "t"]);
        });
    });

    describe("a composite with children of its own", () => {
        class Badge extends generated(Rect) {
            constructor(props?: Record<string, unknown>) {
                super(props as never);
                this.add([new Rect({ width: 5, height: 5 }), new Rect({ width: 8, height: 8, fill: "red" })]);
            }
        }
        const registry = () => new Registry({ nodes: { badge: Badge as unknown as NodeConstructor } });
        const doc = (gap: number, children: TimedNodeSpec[]) => comp([
            { id: "badge", type: "badge", parentId: null, layerOrder: 0, props: { flow: "horizontal", gap, width: 120, height: 40 } },
            ...children,
            box("f4"), box("f5"), box("f6"), ...fillers(),
        ], [cmd("tb", "to", "badge", 0.5, { y: 10 }), cmd("ta", "to", "a", 1, { height: 30 })]);
        const a = box("a", { width: 10 }, { parentId: "badge" });
        const b = box("b", { width: 15 }, { parentId: "badge", layerOrder: 2 });

        it("re-instantiates it with its document children after its own", () => {
            expectIncrementalMatchesFresh(doc(4, [a, b]), doc(12, [a, b]), { registry: registry() });
        });

        it("adds and removes a document child among them", () => {
            const c = box("c", { width: 25 }, { parentId: "badge", layerOrder: 1, startAt: 0.75 });
            expectIncrementalMatchesFresh(doc(4, [a, b]), doc(4, [a, b, c]), { registry: registry() });
            expectIncrementalMatchesFresh(doc(4, [a, b, c]), doc(4, [a, c]), { registry: registry() });
        });
    });

    it("updates a still document's prop", () => {
        const still = (fill: string): StillDocument => ({ kind: "still", nodes: [box("a", { fill }), ...fillers()] });
        expectIncrementalMatchesFresh(still("red"), still("green"));
    });

    describe("the scene root's props", () => {
        const root = (props: Record<string, unknown>, extra: Partial<TimedNodeSpec> = {}): TimedNodeSpec =>
            ({ id: "", type: "canvas2d", parentId: null, layerOrder: 0, props, ...extra });

        it("re-sets a background under the root's own fill tween and zoom", () => {
            const doc = (fill: string) => comp([root({ fill, zoom: 1.5 }), box("a"), ...fillers()], [
                cmd("bg", "fillTo", null, 0, { fill: "#335577" }, 3),
                cmd("z", "zoomTo", null, 0.5, { zoom: 2 }),
                cmd("ta", "to", "a", 1, { x: 30 }),
            ]);
            const { patch, constructed } = expectIncrementalMatchesFresh(doc("#101010"), doc("#e0e0e0"), { registry: countingRegistry().registry });
            expect(patch!.reinstantiate.size).toBe(0);
            expect([...patch!.dirtyNodes]).toEqual([""]);
            expect(constructed).toEqual([]);
        });

        it("resets a prop the row no longer names, and takes one it now does", () => {
            const nodes = [box("a", { width: 30 }), box("b", { width: 50 }, { layerOrder: 1 }), ...fillers()];
            const commands = [cmd("z", "zoomTo", null, 1, { zoom: 3 })];
            expectIncrementalMatchesFresh(
                comp([root({ fill: "red", flow: "horizontal", gap: 12, lookAt: { x: 20, y: 10 } }), ...nodes], commands),
                comp([root({ fill: "red" }), ...nodes], commands),
            );
            expectIncrementalMatchesFresh(comp(nodes, commands), comp([root({ heading: 30, overlay: "#00000040" }), ...nodes], commands));
            expectIncrementalMatchesFresh(comp([root({ zoom: 2 }), ...nodes], commands), comp(nodes, commands));
        });

        it("rebuilds the layout readers of a root whose flow changed", () => {
            const doc = (gap: number) => comp([
                root({ flow: "horizontal", gap }),
                box("s", { width: 40 }),
                box("a", { width: 30 }, { layerOrder: 1 }),
                ...fillers(),
            ], [cmd("slide", "to", "a", 1, { center: { x: 10, y: 0 } }), cmd("ts", "to", "s", 0.5, { y: 10 })]);
            const { patch } = expectIncrementalMatchesFresh(doc(8), doc(40));
            expect(patch!.layoutChanged).toBe(true);
            expect(patch!.dirtyNodes.has("a")).toBe(true);
        });

        it("rebinds a root expression and follows whoever reads the root", () => {
            const doc = (zoom: string) => comp(
                [
                    root({ zoom }, { key: "stage" }),
                    box("r", { x: "=[stage.zoom]*10" }),
                    ...fillers(),
                ],
                [cmd("vg", "variableTo", "g", 0.5, { value: 3 }), cmd("tr", "to", "r", 1, { y: 20 })],
                [{ id: "g", value: 1 }],
            );
            const { patch } = expectIncrementalMatchesFresh(doc("=[g]"), doc("=[g]*2"));
            expect([...patch!.dirtyNodes]).toEqual(["r"]);
        });

        it("on a still", () => {
            const still = (fill: string): StillDocument => ({ kind: "still", nodes: [root({ fill }), box("a"), ...fillers()] });
            expectIncrementalMatchesFresh(still("red"), still("green"));
        });
    });

    describe("rebuilds rather than patching", () => {
        it("when the root row changes more than its props", () => {
            const doc = (key?: string) => comp([
                { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: { fill: "red" }, ...(key && { key }) },
                box("a"), ...fillers(),
            ]);
            expectIncrementalMatchesFresh(doc(), doc("stage"), { expectRebuild: true });
        });

        it("when a key moves to another node", () => {
            const reader = box("r", { x: "=[card.x]" }, { layerOrder: 2 });
            expectIncrementalMatchesFresh(
                comp([box("a", {}, { key: "card" }), box("b", {}, { layerOrder: 1 }), reader, ...fillers()]),
                comp([box("a"), box("b", {}, { key: "card", layerOrder: 1 }), reader, ...fillers()]),
                { expectRebuild: true },
            );
        });

        it("when a structural command is present", () => {
            const nodes = [box("g", { flow: "horizontal", width: 100, height: 40 }), box("a", {}, { parentId: "g" }), ...fillers()];
            const doc = (at: number) => comp(nodes, [cmd("drop", "removeChildAt", "g", at, { index: 0 }, 0)]);
            expectIncrementalMatchesFresh(doc(1), doc(2), { expectRebuild: true });
        });
    });
});

describe("ClipTimeline.applyUpdate constructs only what changed", () => {
    const nodes = [box("a", { x: 0 }), box("b", { x: 10 }, { layerOrder: 1 }), box("p", { width: 80, height: 80 }, { layerOrder: 2 }), ...fillers()];
    const commands = [cmd("sa", "to", "a", 0, { x: 40 }), cmd("vg", "variableTo", "g", 0.5, { value: 5 }), cmd("sb", "to", "b", 1, { y: 5 })];
    const vars: VariableSpec[] = [{ id: "g", value: 0 }];
    const prev = comp(nodes, commands, vars);

    it("a prop edit constructs exactly that node", () => {
        const { registry } = countingRegistry();
        const next = comp(edit(nodes, "a", (n) => ({ ...n, props: { ...n.props, fill: "blue" } })), commands, vars);
        expect(expectIncrementalMatchesFresh(prev, next, { registry }).constructed).toEqual(["a"]);
    });

    it("a placement edit constructs nothing", () => {
        const { registry } = countingRegistry();
        const next = comp(edit(nodes, "a", (n) => ({ ...n, props: { ...n.props, x: 12, rotation: 30 } })), commands, vars);
        expect(expectIncrementalMatchesFresh(prev, next, { registry }).constructed).toEqual([]);
    });

    it("a component moved by its x keeps its instance, and is drawn at the new x", () => {
        const Tag = component2d({
            key: "tag",
            state: { ...Paint.state, label: "tag" },
            commands: { ...Paint.commands },
            render: (ctx, state) => Paint.draw(ctx, state, new Graphics2D().rect({ width: ctx.size.width, height: ctx.size.height })),
        });
        const registry = new Registry({ nodes: [Tag] });
        const doc = (x: number) => comp(
            [{ id: "t", type: "tag", parentId: null, layerOrder: 0, props: { x, width: 40, height: 20, fill: "red" } }, ...fillers()],
            [cmd("fade", "fadeTo", "t", 1, { opacity: 0.5 }), cmd("slide", "to", "t", 2, { y: 30 })],
        );
        const clip = new TimelineClip(doc(0), runtimeScope({ registry }));
        clip.build();
        const before = clip.timeline.liveNode("t");
        const { patch, incremental } = expectIncrementalMatchesFresh(doc(0), doc(70), { registry });
        expect([...patch!.reinstantiate]).toEqual([]);
        expect(patch!.layoutChanged).toBe(false);
        expect(clip.update(doc(70))).not.toBeNull();
        expect(clip.timeline.liveNode("t")).toBe(before);
        incremental.seek(0.5);
        expect((incremental.timeline.liveNode("t") as Node2D).global.x).toBe(70);
    });

    it("an added node constructs only itself", () => {
        const { registry } = countingRegistry();
        const next = comp([...nodes, box("n", {}, { layerOrder: 9 })], commands, vars);
        expect(expectIncrementalMatchesFresh(prev, next, { registry }).constructed).toEqual(["n"]);
    });

    it("a command edit constructs nothing", () => {
        const { registry } = countingRegistry();
        const next = comp(nodes, edit(commands, "sb", (c) => ({ ...c, args: { y: 50 } })), vars);
        expect(expectIncrementalMatchesFresh(prev, next, { registry }).constructed).toEqual([]);
    });

    it("a variable edit constructs nothing", () => {
        const { registry } = countingRegistry();
        const next = comp(nodes, commands, [{ id: "g", value: 3 }]);
        expect(expectIncrementalMatchesFresh(prev, next, { registry }).constructed).toEqual([]);
    });

    it("a move constructs only the moved node", () => {
        const { registry } = countingRegistry();
        const next = comp(edit(nodes, "b", (n) => ({ ...n, parentId: "p" })), commands, vars);
        expect(expectIncrementalMatchesFresh(prev, next, { registry }).constructed).toEqual(["b"]);
    });
});

describe("ClipTimeline.applyUpdate over seeded random edits", { timeout: 30_000 }, () => {
    function random(seed: number): () => number {
        let s = seed >>> 0;
        return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    }
    const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    let serial = 0;
    // A text node takes no children, so it is never picked as a parent.
    const holders = (nodes: readonly TimedNodeSpec[]) => nodes.filter((n) => n.type !== "text");

    function row(r: () => number, nodes: TimedNodeSpec[]): TimedNodeSpec {
        const id = `n${serial++}`;
        const roll = r();
        const type = roll < 0.1 ? "ellipse" : roll < 0.2 ? "text" : roll < 0.27 ? "default-text-style" : "rect";
        const props: Record<string, unknown> = type === "default-text-style"
            ? { fontSize: pick(r, [10, 20]) }
            : { width: pick(r, [20, 40, "fill"]), height: pick(r, [10, 20]) };
        if (type === "text") props.text = pick(r, ["hi", "hello"]);
        if (type === "rect" && r() < 0.3) props.flow = pick(r, ["horizontal", "vertical"]);
        if (r() < 0.4) props.x = Math.floor(r() * 50);
        const keyed = nodes.filter((n) => n.key);
        if (r() < 0.2 && keyed.length > 0) props.y = `=[${pick(r, keyed).key}.x]+5`;
        else if (r() < 0.2) props.y = "=[g]*2";
        if (r() < 0.12) props.topLeft = { x: 5, y: 5 };
        const node: TimedNodeSpec = {
            id, type, layerOrder: Math.floor(r() * 3), props,
            parentId: holders(nodes).length > 0 && r() < 0.4 ? pick(r, holders(nodes)).id : null,
        };
        if (r() < 0.3) node.key = `k${id}`;
        if (r() < 0.3) node.startAt = pick(r, [0.5, 1, 2]);
        if (r() < 0.2) node.endAt = (node.startAt ?? 0) + pick(r, [0.5, 1, 2]);
        return node;
    }

    function command(r: () => number, nodes: TimedNodeSpec[]): CommandSpec {
        const base = { id: `c${serial++}`, at: pick(r, [0, 0.5, 1, 1.5, 2.5]), duration: pick(r, [0, 0.5, 1]) };
        const kind = r();
        if (kind < 0.15) return { ...base, type: "variableTo", targetId: "g", args: { value: Math.floor(r() * 20) } };
        if (kind < 0.2) return { ...base, type: "zoomTo", targetId: null, args: { zoom: pick(r, [1.5, 2]) } };
        const targetId = pick(r, nodes).id;
        if (kind < 0.3) return { ...base, type: "fadeTo", targetId, args: { opacity: pick(r, [0, 0.5]) } };
        if (kind < 0.35) return { ...base, type: "save", targetId, duration: 0, args: {} };
        if (kind < 0.4) return { ...base, type: "restore", targetId, args: {} };
        const keyed = nodes.filter((n) => n.key && n.id !== targetId);
        if (kind < 0.45 && keyed.length > 0) return { ...base, type: "set", targetId, duration: 0, args: { y: `=[${pick(r, keyed).key}.x]` } };
        const args = pick(r, [{ x: 70 }, { y: 30 }, { width: pick(r, [10, 50]) }, { rotation: 30 }, { center: { x: 10, y: -10 } }]);
        return { ...base, type: "to", targetId, args };
    }

    function mutate(r: () => number, doc: CompositionDocument): CompositionDocument {
        const next = structuredClone(doc);
        const nodes = next.nodes as TimedNodeSpec[];
        const node = pick(r, nodes);
        const target = next.commands.length > 0 ? pick(r, next.commands) : undefined;
        switch (Math.floor(r() * 11)) {
            case 0: node.props = node.type === "default-text-style" ? { fontSize: 30 } : { ...node.props, x: Math.floor(r() * 90) }; break;
            case 1: if (r() < 0.5) delete node.startAt; else node.startAt = pick(r, [0, 0.5, 2]); delete node.endAt; break;
            case 2: node.layerOrder = Math.floor(r() * 3); break;
            case 3: node.parentId = r() < 0.4 ? null : pick(r, holders(nodes).filter((n) => n !== node))?.id ?? null; break;
            case 4: nodes.push(row(r, nodes)); break;
            case 5: {
                const leaf = pick(r, nodes.filter((n) => !nodes.some((c) => c.parentId === n.id)));
                next.nodes = nodes.filter((n) => n !== leaf);
                next.commands = next.commands.filter((c) => c.targetId !== leaf.id);
                break;
            }
            case 6: if (target) target.at = pick(r, [0, 0.25, 1, 3]); break;
            case 7: if (target) target.duration = pick(r, [0, 2]); break;
            case 8: next.commands.push(command(r, nodes)); break;
            case 9: next.commands = next.commands.filter((c) => c !== target); break;
            case 10: next.variables = [{ id: "g", value: Math.floor(r() * 30) }]; break;
        }
        return next;
    }

    const registry = new Registry();
    const buildable = (doc: CompositionDocument) => {
        if (!validateDocument(doc).valid) return false;
        try {
            new TimelineClip(doc, runtimeScope({ registry })).build();
            return true;
        } catch {
            return false;
        }
    };

    function expectMatchesFresh(clip: TimelineClip, next: CompositionDocument, context: string): void {
        const fresh = new TimelineClip(next, runtimeScope({ registry }));
        fresh.build();
        const times = sampleTimes(documentDuration(next), 0.25, documentKeyTimes(next));
        const actual = snapshotClip(clip, times);
        const expected = snapshotClip(fresh, times);
        for (let i = 0; i < times.length; i++) {
            expect(actual[i], `${context}, at ${times[i]}s: ${JSON.stringify(next)}`).toEqual(expected[i]);
        }
    }

    it("matches a fresh build after edits to the scene root among other edits", () => {
        const rootProps = (r: () => number): Record<string, unknown> => {
            const props: Record<string, unknown> = {};
            if (r() < 0.6) props.fill = pick(r, ["#102030", "#e0d0c0", "#ff000080"]);
            if (r() < 0.3) props.zoom = pick(r, [0.5, 2, "=[g]/10+1"]);
            if (r() < 0.3) props.flow = pick(r, ["horizontal", "vertical", "freeform"]);
            if (r() < 0.3) props.gap = pick(r, [0, 8, 20]);
            if (r() < 0.2) props.lookAt = { x: pick(r, [0, 15]), y: pick(r, [0, -10]) };
            if (r() < 0.2) props.heading = pick(r, [0, 20]);
            return props;
        };
        const withRoot = (doc: CompositionDocument, props: Record<string, unknown>): CompositionDocument => ({
            ...doc,
            nodes: [{ id: "", type: "canvas2d", parentId: null, layerOrder: 0, props }, ...doc.nodes.filter((n) => n.id !== "")],
        });
        let compared = 0;
        for (let seed = 1; seed <= 120; seed++) {
            const r = random(seed * 7919);
            const nodes: TimedNodeSpec[] = [];
            for (let i = 3 + Math.floor(r() * 4); i > 0; i--) nodes.push(row(r, nodes));
            const commands = Array.from({ length: 2 + Math.floor(r() * 5) }, () => command(r, nodes));
            if (r() < 0.5) commands.push({ id: `bg${seed}`, type: "fillTo", targetId: null, at: 0.5, duration: 2, args: { fill: "#448866" } });
            let doc = withRoot({ kind: "composition", nodes, commands, variables: [{ id: "g", value: 3 }], duration: 4 }, rootProps(r));
            if (!buildable(doc)) continue;

            const clip = new TimelineClip(doc, runtimeScope({ registry }));
            clip.build();
            for (const t of [2.2, 0.7, 3.5]) clip.seek(t);
            for (let step = 0; step < 4; step++) {
                const root = doc.nodes.find((n) => n.id === "")!;
                // The root row stays out of `mutate`, which would otherwise pick it as a parent.
                const next = r() < 0.6
                    ? withRoot(doc, rootProps(r))
                    : withRoot(mutate(r, { ...doc, nodes: doc.nodes.filter((n) => n !== root) }), root.props);
                if (!buildable(next)) continue;
                if (!clip.update(next)) break;
                expectMatchesFresh(clip, next, `seed ${seed}, edit ${step}`);
                compared++;
                doc = next;
            }
        }
        expect(compared).toBeGreaterThan(200);
    });

    it("matches a fresh build after each of a chain of edits", () => {
        let compared = 0;
        for (let seed = 1; seed <= 150; seed++) {
            const r = random(seed);
            const nodes: TimedNodeSpec[] = [];
            for (let i = 4 + Math.floor(r() * 5); i > 0; i--) nodes.push(row(r, nodes));
            const commands = Array.from({ length: 2 + Math.floor(r() * 6) }, () => command(r, nodes));
            let doc: CompositionDocument = { kind: "composition", nodes, commands, variables: [{ id: "g", value: 3 }], duration: 4 };
            if (!buildable(doc)) continue;

            const clip = new TimelineClip(doc, runtimeScope({ registry }));
            clip.build();
            for (const t of [2.2, 0.7, 3.5]) clip.seek(t);
            for (let step = 0; step < 3; step++) {
                const next = mutate(r, doc);
                if (!buildable(next)) continue;
                if (!clip.update(next)) break;
                expectMatchesFresh(clip, next, `seed ${seed}, edit ${step}`);
                compared++;
                doc = next;
            }
        }
        expect(compared).toBeGreaterThan(150);
    });
});

describe("ClipTimeline.applyUpdate and a clip whose length changed", () => {
    const doc = (duration: number) => comp(
        [box("spin"), box("b", { x: 3 }, { layerOrder: 1 }), ...fillers()],
        [
            { id: "loop", type: "to", targetId: "spin", at: 0.5, duration: 1, args: { rotation: 90 }, loop: { count: null } },
            cmd("other", "to", "b", 0, { x: 20 }),
        ],
        undefined,
        duration,
    );
    const loopSpan = (clip: TimelineClip) => clip.timeline.placedCommands().find((p) => p.spec.id === "loop")!.duration;

    it("rebuilds an unlimited loop to fill a longer clip, matching a fresh build", () => {
        const { patch, incremental } = expectIncrementalMatchesFresh(doc(4), doc(7));
        expect(patch!.dirtyNodes.has("spin")).toBe(true);
        expect(patch!.dirtyNodes.has("b")).toBe(false);
        expect(loopSpan(incremental)).toBe(6.5);
    });

    it("rebuilds it to fill a shorter one", () => {
        const { patch, incremental } = expectIncrementalMatchesFresh(doc(7), doc(3));
        expect(patch!.dirtyNodes.has("spin")).toBe(true);
        expect(loopSpan(incremental)).toBe(2.5);
    });

    it("rebuilds it when a length the commands imply is what moved", () => {
        const implied = (tail: number): CompositionDocument => ({
            ...doc(4),
            duration: undefined,
            commands: [...doc(4).commands, cmd("tail", "to", "b", tail, { y: 3 }, 0.5)],
        });
        const { incremental } = expectIncrementalMatchesFresh(implied(3), implied(6));
        expect(loopSpan(incremental)).toBe(6);
    });

    it("leaves a counted loop's span alone", () => {
        const counted = (duration: number) => comp(
            [box("spin"), ...fillers()],
            [{ id: "loop", type: "to", targetId: "spin", at: 0.5, duration: 1, args: { rotation: 90 }, loop: { count: 2 } }],
            undefined,
            duration,
        );
        const { patch, incremental } = expectIncrementalMatchesFresh(counted(4), counted(7));
        expect(patch!.dirtyNodes.size).toBe(0);
        expect(loopSpan(incremental)).toBe(3);
    });
});

describe("ClipTimeline.applyUpdate refuses what it was not planned for", () => {
    const nodes = [box("a", { x: 0 }), ...fillers()];
    const prev = comp(nodes, [cmd("s", "to", "a", 0, { x: 40 })]);
    const nextA = comp(nodes, [cmd("s", "to", "a", 0, { x: 60 })]);
    const nextB = comp(nodes, [cmd("s", "to", "a", 0, { x: 80 })]);
    const built = (doc: CompositionDocument): TimelineClip => {
        const clip = new TimelineClip(doc);
        clip.build();
        return clip;
    };
    const apply = (clip: TimelineClip, patch: NonNullable<ReturnType<TimelineClip["timeline"]["planUpdate"]>>) => {
        clip.attach(0);
        clip.timeline.applyUpdate(patch, () => { }, () => { });
    };

    it("throws before the timeline is built", () => {
        const donor = built(prev);
        const patch = donor.timeline.planUpdate(nextA)!;
        const unbuilt = new TimelineClip(prev);
        expect(() => unbuilt.timeline.applyUpdate(patch, () => { }, () => { }))
            .toThrow("ClipTimeline.applyUpdate needs a built timeline.");
    });

    it("throws for a patch planned against a document the timeline has since moved on from", () => {
        const clip = built(prev);
        const first = clip.timeline.planUpdate(nextA)!;
        const second = clip.timeline.planUpdate(nextB)!;
        apply(clip, first);
        expect(() => apply(clip, second)).toThrow("This patch was planned against a different version of the document.");
    });

    it("throws for the same patch applied twice", () => {
        const clip = built(prev);
        const patch = clip.timeline.planUpdate(nextA)!;
        apply(clip, patch);
        expect(() => apply(clip, patch)).toThrow(/different version of the document/);
    });

    it("throws for a patch another timeline planned, though over an equal document", () => {
        const clip = built(prev);
        const other = built(structuredClone(prev));
        const foreign = other.timeline.planUpdate(nextA)!;
        expect(() => apply(clip, foreign)).toThrow(/different version of the document/);
    });

    it("applies a patch planned against the document it now holds, however many were planned", () => {
        const clip = built(prev);
        const first = clip.timeline.planUpdate(nextA)!;
        apply(clip, first);
        const second = clip.timeline.planUpdate(nextB)!;
        expect(second.prev).toBe(first.next);
        expect(() => apply(clip, second)).not.toThrow();
    });
});

describe("ClipTimeline.planUpdate", () => {
    const nodes = [box("a", { x: 0 }), box("b", { x: 5 }, { layerOrder: 1 }), ...fillers()];
    const prev = comp(nodes, [cmd("s", "to", "a", 0, { x: 40 }), cmd("v", "variableTo", "g", 0.5, { value: 5 })], [{ id: "g", value: 0 }]);
    const next = comp(edit(nodes, "a", (n) => ({ ...n, props: { ...n.props, x: 9 } })), prev.commands, [{ id: "g", value: 0 }]);

    const clipOf = (doc: CompositionDocument) => {
        const clip = new TimelineClip(doc);
        clip.build();
        return clip;
    };

    it("changes nothing in the timeline it plans for", () => {
        const clip = clipOf(prev);
        const times = sampleTimes(documentDuration(prev), 0.25, documentKeyTimes(prev));
        const before = snapshotClip(clip, times);
        const a = clip.timeline.liveNode("a");
        const placed = [...clip.timeline.placedCommands()];

        expect(clip.timeline.planUpdate(next)).not.toBeNull();

        expect(clip.timeline.liveNode("a")).toBe(a);
        expect(clip.timeline.placedCommands()).toEqual(placed);
        expect(clip.timeline.duration).toBe(documentDuration(prev));
        expect(snapshotClip(clip, times)).toEqual(before);
    });

    it("plans from the same index of the current document every time, built once", () => {
        const clip = clipOf(prev);
        const first = clip.timeline.planUpdate(next)!;
        const second = clip.timeline.planUpdate(next)!;
        const third = clip.timeline.planUpdate(comp(nodes, prev.commands, [{ id: "g", value: 1 }]))!;

        expect(second.prev).toBe(first.prev);
        expect(third.prev).toBe(first.prev);
        // The document being moved to is indexed afresh each time.
        expect(second.next).not.toBe(first.next);
    });

    it("answers null for what only a rebuild can do, and still changes nothing", () => {
        const clip = clipOf(prev);
        const times = sampleTimes(documentDuration(prev), 0.5, documentKeyTimes(prev));
        const before = snapshotClip(clip, times);

        expect(clip.timeline.planUpdate({ kind: "still", nodes })).toBeNull();
        expect(clip.timeline.planUpdate({ ...prev, theme: { colors: { primary: "#f00" } } })).toBeNull();
        expect(snapshotClip(clip, times)).toEqual(before);
        // A later plan still works.
        expect(clip.timeline.planUpdate(next)).not.toBeNull();
    });

    it("plans nothing to do for the document it already holds", () => {
        const clip = clipOf(prev);
        const patch = clip.timeline.planUpdate(structuredClone(prev))!;
        expect(patch.dirtyNodes.size + patch.dirtyVariables.size + patch.reinstantiate.size + patch.detach.size).toBe(0);
        expect(patch.diff.identical).toBe(true);
    });
});

describe("ClipTimeline.applyUpdate widens its replay for a binding that names another node", () => {
    /** A node-less command that logs each time one of its chains is run to the end. */
    function ticking() {
        const calls: string[] = [];
        const registry = new Registry();
        registry.addCommand("tick", (_target, args, duration) => ({
            duration,
            at: () => {
                calls.push(String(args.label));
                return {};
            },
            _stepper: () => ({ seek: () => { }, advance: () => true }),
        }));
        return { registry, calls };
    }

    const rows = [
        box("card", { x: 10 }, { key: "card" }),
        box("a", { x: 0 }, { layerOrder: 1 }),
        box("b", { x: 0 }, { layerOrder: 2 }),
        ...fillers(),
    ];
    const bindsCard = cmd("bind", "set", "a", 1, { x: "=[card.x]" }, 0);
    const doc = (y: number, withBinding: boolean) => comp(rows, [
        ...(withBinding ? [bindsCard] : []),
        cmd("hop", "to", "a", 2, { y }),
        cmd("tick", "tick", "b", 0, { label: "b" }, 0),
    ]);

    const replayedByUpdate = (withBinding: boolean) => {
        const { registry, calls } = ticking();
        const clip = new TimelineClip(doc(5, withBinding), runtimeScope({ registry }));
        clip.build();
        calls.length = 0;
        const patch = clip.update(doc(9, withBinding))!;
        expect(patch).not.toBeNull();
        expect([...patch.dirtyNodes]).toEqual(["a"]);
        return { calls, patch };
    };

    it("runs an untouched chain to its end when the dirty node is the target of such a binding", () => {
        const { calls, patch } = replayedByUpdate(true);
        // The planner did not ask for it; the walk widens it for the binding.
        expect(patch.replay).toEqual(new Set());
        expect(calls).toContain("b");
    });

    it("leaves that chain alone when no binding names another node", () => {
        const { calls, patch } = replayedByUpdate(false);
        expect(patch.replay).toEqual(new Set());
        expect(calls).not.toContain("b");
    });

    it("still agrees with a fresh build when it widens", () => {
        const { registry } = ticking();
        expectIncrementalMatchesFresh(doc(5, true), doc(9, true), { registry });
    });
});
