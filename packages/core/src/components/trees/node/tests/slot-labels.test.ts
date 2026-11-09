import { describe, expect, it } from "vitest";

import type { CompositionDocument, TimedNodeSpec } from "@/document/types";
import { Rect } from "@/components/builtins/geometry/geometry";
import type { Node } from "@/components/trees/node/node";
import { observeSlots, slotLabel, type SlotObserver } from "@/props/observer";
import { getPropSlot } from "@/props/host";
import { ClipInstance } from "@/runtime/clip-instance";
import { runtimeScope } from "@/runtime/document.fixtures";

/** Every read and write under `fn`, by label, each once, in first-seen order. */
function observed(fn: () => void): { reads: string[]; writes: string[]; clocks: string[] } {
    const reads = new Set<string>();
    const writes = new Set<string>();
    const clocks = new Set<string>();
    const observer: SlotObserver = {
        read: (slot) => reads.add(slotLabel(slot)),
        write: (slot) => writes.add(slotLabel(slot)),
        clock: (host) => clocks.add(host.id),
    };
    observeSlots(observer, fn);
    return { reads: [...reads], writes: [...writes], clocks: [...clocks] };
}

function row(id: string, props: Record<string, unknown>, extra: Partial<TimedNodeSpec> = {}): TimedNodeSpec {
    return { id, type: "rect", parentId: null, layerOrder: 0, props: { width: 10, height: 10, ...props }, ...extra };
}

function built(doc: CompositionDocument): ClipInstance {
    const instance = new ClipInstance(doc, 3, runtimeScope());
    instance.build();
    return instance;
}

function find(instance: ClipInstance, id: string): Rect {
    const stack: Node[] = [instance.canvas];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.id === id) return node as Rect;
        stack.push(...node._allChildren);
    }
    throw new Error(`no node "${id}" in the tree`);
}

describe("slot labels", () => {
    it("names a node prop by its node's id and the field", () => {
        const card = new Rect({ id: "card", width: 10, height: 10 });
        expect(slotLabel(getPropSlot(card, "x")!)).toBe("card.x");
        expect(observed(() => card.opacity).reads).toEqual(["card.opacity"]);
    });

    it("names the laid-out box", () => {
        const card = new Rect({ id: "card", width: 10, height: 10 });
        expect(observed(() => card.layoutBounds).reads).toEqual(["card.layoutBounds"]);
    });

    it("names a document variable's cell", () => {
        const instance = built({
            kind: "composition",
            variables: [{ id: "g", value: 3 }],
            nodes: [row("box", { x: "=[g]*2" })],
            commands: [],
        });
        const box = find(instance, "box");
        const { reads } = observed(() => expect(box.x).toBe(6));
        expect(reads).toEqual(["box.x", "var:g"]);
    });

    it("reports a node's clock", () => {
        const card = new Rect({ id: "card", width: 10, height: 10 });
        expect(observed(() => card.time).clocks).toEqual(["card"]);
    });
});

describe("presence pseudo-slots", () => {
    const doc: CompositionDocument = {
        kind: "composition",
        nodes: [
            row("group", {}, { startAt: 1 }),
            { ...row("card", { x: 7 }), key: "card", parentId: "group" },
            row("label", { x: "=[card.x]+1" }),
        ],
        commands: [],
    };

    it("records the presence of the node a reference reads, and of its ancestors", () => {
        const instance = built(doc);
        instance.evaluateAt(1.5);
        const label = find(instance, "label");
        const { reads } = observed(() => expect(label.x).toBe(8));
        expect(reads).toEqual(["label.x", "presence:card", "presence:group", "card.x"]);
    });

    it("records presence and structure writes as the tree moves", () => {
        const instance = built(doc);
        instance.evaluateAt(1.5);
        const { writes } = observed(() => instance.evaluateAt(0.5));
        expect(writes).toContain("presence:group");
        expect(writes).toContain(".structure");
        expect(writes).toContain("group.structure");
        expect(writes).not.toContain("presence:card");
    });
});

describe("the structure pseudo-slot", () => {
    it("is read by the child and parent accessors", () => {
        const parent = new Rect({ id: "parent", width: 10, height: 10 });
        const child = new Rect({ id: "child", width: 1, height: 1 });
        parent.add(child);

        expect(observed(() => parent.children).reads).toEqual(["parent.structure"]);
        expect(observed(() => parent._allChildren).reads).toEqual(["parent.structure"]);
        expect(observed(() => child.parent).reads).toEqual(["child.structure"]);
    });

    it("is written, on both ends, by every insert and removal", () => {
        const parent = new Rect({ id: "parent", width: 10, height: 10 });
        const child = new Rect({ id: "child", width: 1, height: 1 });
        expect(observed(() => parent.add(child)).writes).toEqual(["parent.structure", "child.structure"]);
        expect(observed(() => parent.remove(child)).writes).toEqual(["parent.structure", "child.structure"]);
        expect(observed(() => parent.addChildAt({ data: { child, index: 0 } })).writes)
            .toEqual(["parent.structure", "child.structure"]);
        expect(observed(() => parent.removeChildAt({ data: { index: 0 } })).writes)
            .toEqual(["parent.structure", "child.structure"]);
        parent.add(child);
        expect(observed(() => parent.clear()).writes).toEqual(["parent.structure", "child.structure"]);
    });

    it("is never allocated while nothing observes", () => {
        const parent = new Rect({ id: "parent", width: 10, height: 10 });
        const child = new Rect({ id: "child", width: 1, height: 1 });
        parent.add(child);
        void parent.children;
        void child.parent;
        parent.remove(child);
        const slotOf = (node: Rect) => (node as unknown as { _structure: unknown })._structure;
        expect(slotOf(parent)).toBeNull();
        expect(slotOf(child)).toBeNull();
    });
});
