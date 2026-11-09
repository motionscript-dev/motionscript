import { describe, expect, it } from "vitest";

import { AUDIO_ROOT_ID } from "../audio";
import { diffClip, jsonEqual } from "../diff";
import type { AudioDocument, CommandSpec, CompositionDocument, StillDocument, TimedNodeSpec, VariableSpec } from "../types";

const node = (id: string, props: Record<string, unknown> = {}, extra: Partial<TimedNodeSpec> = {}): TimedNodeSpec =>
    ({ id, type: "rect", parentId: null, layerOrder: 0, props, ...extra });

const cmd = (id: string, targetId: string | null, at: number, args: Record<string, unknown> = {}, extra: Partial<CommandSpec> = {}): CommandSpec =>
    ({ id, type: "to", targetId, at, args, ...extra });

const comp = (nodes: TimedNodeSpec[], commands: CommandSpec[] = [], variables?: VariableSpec[]): CompositionDocument =>
    ({ kind: "composition", nodes, commands, ...(variables && { variables }) });

describe("jsonEqual", () => {
    it("ignores key order and treats an undefined key as absent", () => {
        expect(jsonEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
        expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
        expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
        expect(jsonEqual({ a: 1 }, { a: 1, b: null })).toBe(false);
    });

    it("keeps arrays ordered and tells arrays from objects", () => {
        expect(jsonEqual([1, 2], [2, 1])).toBe(false);
        expect(jsonEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
        expect(jsonEqual("1", 1)).toBe(false);
        expect(jsonEqual(NaN, NaN)).toBe(true);
    });
});

describe("diffClip", () => {
    it("takes the identity fast path, and finds a deep copy identical", () => {
        const doc = comp([node("a", { fill: ["red"] })], [cmd("c1", "a", 1, { x: 10 })], [{ id: "g", value: 1 }]);
        const same = diffClip(doc, doc);
        expect(same.identical).toBe(true);
        expect(diffClip(doc, structuredClone(doc)).identical).toBe(true);
    });

    it("is insensitive to array order where the timeline is", () => {
        const prev = comp([node("a", {}, { layerOrder: 0 }), node("b", {}, { layerOrder: 1 })], [cmd("c1", "a", 1), cmd("c2", "b", 2)]);
        const next = comp([node("b", {}, { layerOrder: 1 }), node("a", {}, { layerOrder: 0 })], [cmd("c2", "b", 2), cmd("c1", "a", 1)]);
        expect(diffClip(prev, next).identical).toBe(true);
    });

    it("classifies each node field", () => {
        const prev = comp([
            node("p"),
            node("type"), node("key"), node("props", { fill: "red" }), node("parent"),
            node("start", {}, { startAt: 1 }), node("end", {}, { endAt: 4 }), node("zero"),
        ]);
        const next = comp([
            node("p"),
            { ...node("type"), type: "ellipse" }, node("key", {}, { key: "k" }), node("props", { fill: "blue" }),
            node("parent", {}, { parentId: "p" }),
            node("start", {}, { startAt: 2 }), node("end", {}, { endAt: 5 }), node("zero", {}, { startAt: 0 }),
        ]);
        const { nodes, identical } = diffClip(prev, next);
        expect(identical).toBe(false);
        expect([...nodes.respec].sort()).toEqual(["key", "props", "type"]);
        expect([...nodes.moved]).toEqual(["parent"]);
        expect([...nodes.span].sort()).toEqual(["end", "start"]);
        expect(nodes.changed.has("zero")).toBe(false);
        expect([...nodes.changed].sort()).toEqual(["end", "key", "parent", "props", "start", "type"]);
    });

    it("finds added and removed nodes, keeping the root out of both", () => {
        const prev = comp([{ ...node(""), type: "canvas2d" }, node("a")]);
        const next = comp([node("b")]);
        const diff = diffClip(prev, next);
        expect([...diff.nodes.added]).toEqual(["b"]);
        expect([...diff.nodes.removed]).toEqual(["a"]);
        expect(diff.rootChanged).toBe(false);
    });

    it("compares the root row on its own", () => {
        const root = (props: Record<string, unknown>): TimedNodeSpec => ({ id: "", type: "canvas2d", parentId: null, layerOrder: 0, props });
        const diff = diffClip(comp([root({ fill: "red" }), node("a")]), comp([root({ fill: "blue" }), node("a")]));
        expect(diff.rootChanged).toBe(true);
        expect(diff.nodes.respec.size).toBe(0);
    });

    it("reports a sibling reorder by layerOrder, and a layerOrder edit that keeps the order as a change only", () => {
        const prev = comp([node("a", {}, { layerOrder: 0 }), node("b", {}, { layerOrder: 1 })]);
        const swapped = comp([node("a", {}, { layerOrder: 2 }), node("b", {}, { layerOrder: 1 })]);
        expect([...diffClip(prev, swapped).nodes.reorderedParents]).toEqual([""]);

        const spaced = comp([node("a", {}, { layerOrder: 0 }), node("b", {}, { layerOrder: 5 })]);
        const diff = diffClip(prev, spaced);
        expect(diff.nodes.reorderedParents.size).toBe(0);
        expect([...diff.nodes.changed]).toEqual(["b"]);
        expect(diff.identical).toBe(false);
    });

    it("breaks layerOrder ties by array index", () => {
        const p = node("p");
        const prev = comp([p, node("a", {}, { parentId: "p" }), node("b", {}, { parentId: "p" })]);
        const next = comp([p, node("b", {}, { parentId: "p" }), node("a", {}, { parentId: "p" })]);
        expect([...diffClip(prev, next).nodes.reorderedParents]).toEqual(["p"]);
    });

    it("ignores added, removed and moved children when comparing sibling order", () => {
        const prev = comp([node("p"), node("a", {}, { parentId: "p" }), node("b", {}, { parentId: "p" }), node("c", {}, { parentId: "p" })]);
        const next = comp([node("p"), node("new", {}, { parentId: "p" }), node("a", {}, { parentId: "p" }), node("c", {}, { parentId: "p" }), node("b")]);
        expect(diffClip(prev, next).nodes.reorderedParents.size).toBe(0);
    });

    it("classifies each command field", () => {
        const base = cmd("c", "a", 1, { x: 10 });
        const nodes = [node("a"), node("b")];
        const changedBy = (edit: Partial<CommandSpec>) =>
            diffClip(comp(nodes, [base]), comp(nodes, [{ ...base, ...edit }])).commands.changed.has("c");

        expect(changedBy({ type: "set" })).toBe(true);
        expect(changedBy({ targetId: "b" })).toBe(true);
        expect(changedBy({ at: 2 })).toBe(true);
        expect(changedBy({ duration: 1 })).toBe(true);
        expect(changedBy({ easing: { kind: "linear" } })).toBe(true);
        expect(changedBy({ args: { x: 20 } })).toBe(true);
        expect(changedBy({ duration: 0 })).toBe(false);
        expect(changedBy({ args: { x: 10, y: undefined } })).toBe(false);
    });

    it("finds added and removed commands", () => {
        const nodes = [node("a")];
        const diff = diffClip(comp(nodes, [cmd("old", "a", 1)]), comp(nodes, [cmd("new", "a", 1)]));
        expect([...diff.commands.added]).toEqual(["new"]);
        expect([...diff.commands.removed]).toEqual(["old"]);
    });

    it("reports a same-at reorder, and nothing for commands at different times", () => {
        const nodes = [node("a"), node("b"), node("c")];
        const prev = comp(nodes, [cmd("c1", "a", 1), cmd("c2", "b", 1), cmd("c3", "c", 2), cmd("c4", "c", 3)]);
        const next = comp(nodes, [cmd("c4", "c", 3), cmd("c2", "b", 1), cmd("c3", "c", 2), cmd("c1", "a", 1)]);
        const diff = diffClip(prev, next);
        expect([...diff.commands.reorderedAts]).toEqual([1]);
        expect(diff.commands.changed.size).toBe(0);
    });

    it("reports a key naming a different node as remapped", () => {
        const prev = comp([node("a", {}, { key: "card" }), node("b")]);
        const next = comp([node("a"), node("b", {}, { key: "card" })]);
        const diff = diffClip(prev, next);
        expect([...diff.remappedKeys]).toEqual(["card"]);
    });

    it("ignores a variable's name and compares value and lerp", () => {
        const nodes = [node("a")];
        const prev = comp(nodes, [], [{ id: "g", name: "Glow", value: { x: 1 } }, { id: "h", value: 1 }, { id: "gone", value: 0 }]);
        expect(diffClip(prev, comp(nodes, [], [{ id: "g", name: "Renamed", value: { x: 1 } }, { id: "h", value: 1 }, { id: "gone", value: 0 }])).identical).toBe(true);

        const next = comp(nodes, [], [{ id: "g", value: { x: 2 } }, { id: "h", value: 1, lerp: "step" }, { id: "fresh", value: 0 }]);
        const { variables } = diffClip(prev, next);
        expect([...variables.changed].sort()).toEqual(["g", "h"]);
        expect([...variables.added]).toEqual(["fresh"]);
        expect([...variables.removed]).toEqual(["gone"]);
    });

    it("reports kind, theme and duration changes", () => {
        const still: StillDocument = { kind: "still", nodes: [node("a")] };
        expect(diffClip(still, comp([node("a")])).kindChanged).toBe(true);
        expect(diffClip(still, { ...still, theme: { colors: { brand: "red" } } as never }).themeChanged).toBe(true);
        expect(diffClip(comp([node("a")], [cmd("c", "a", 1)]), comp([node("a")], [cmd("c", "a", 1)], undefined)).duration).toBe(false);
        const longer = { ...comp([node("a")], [cmd("c", "a", 1)]), duration: 5 };
        const diff = diffClip(comp([node("a")], [cmd("c", "a", 1)]), longer);
        expect(diff.duration).toBe(true);
        expect(diff.identical).toBe(false);
    });

    it("diffs audio documents as the compositions they lower to", () => {
        const bus = (props: Record<string, unknown>): TimedNodeSpec => ({ id: "", type: "audioBus", parentId: null, layerOrder: 0, props });
        const sound = { id: "s", type: "sound", parentId: null, layerOrder: 0, props: { src: "a.mp3" } };
        const audio = (volume: number, commands: CommandSpec[] = []): AudioDocument =>
            ({ kind: "audio", nodes: [bus({ volume }), sound], commands });

        const diff = diffClip(audio(1), audio(0.5));
        expect(diff.rootChanged).toBe(false);
        expect([...diff.nodes.respec]).toEqual([AUDIO_ROOT_ID]);
        expect(diff.nodes.moved.size).toBe(0);

        const retimed = diffClip(audio(1, [cmd("c", null, 1)]), audio(1, [cmd("c", null, 2)]));
        expect([...retimed.commands.changed]).toEqual(["c"]);
        expect(diffClip(audio(1, [cmd("c", null, 1)]), audio(1, [cmd("c", null, 1)])).identical).toBe(true);
    });
});
