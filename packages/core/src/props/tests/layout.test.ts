import { describe, expect, it } from "vitest";
import { Rect } from "@/components/builtins/geometry/geometry";
import { childView } from "@/components/factory/views";
import { applyProp, type ReactiveHost } from "@/components/trees/node/node-reactive";
import type { PropCells } from "@/props/host";
import { PropLayout } from "@/props/layout";

/** The least a prop host is: slots, and a write that lands in them. */
class Host implements ReactiveHost {
    readonly id = "h";
    __cells?: PropCells;
    _stateStack = [];
    _writeProp(field: string, value: unknown): void {
        if (value !== undefined) this.__cells?.slots.get(field)?.set(value);
    }
    _prepareStep(): never {
        throw new Error("not tweened here");
    }
}

const read = (host: object, field: string) => (host as Record<string, unknown>)[field];

describe("PropLayout", () => {
    it("gives every node of a type the same accessors, on its prototype", () => {
        const a = new Rect({ x: 1 });
        const b = new Rect({ x: 2 });
        expect(Object.getOwnPropertyDescriptor(a, "x")).toBeUndefined();
        expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(a), "x")?.get).toBeTypeOf("function");
        a.x = 7;
        expect([a.x, b.x]).toEqual([7, 2]);
    });

    it("finds a field's slot whatever order an instance registered it in", () => {
        const one = new Host();
        const two = new Host();
        applyProp(one, "p", 1);
        applyProp(one, "q", 2);
        applyProp(two, "q", 20);
        applyProp(two, "p", 10);
        expect([read(one, "p"), read(one, "q"), read(two, "p"), read(two, "q")]).toEqual([1, 2, 10, 20]);
        expect(PropLayout.of(Host.prototype).indexOf("q")).toBe(1);
    });

    it("reads past a field an instance never registered, and a write lands on the instance", () => {
        const registered = new Host();
        const bare = new Host();
        applyProp(registered, "r", 5);
        expect(read(bare, "r")).toBeUndefined();
        (bare as unknown as Record<string, number>).r = 3;
        expect([read(bare, "r"), read(registered, "r")]).toEqual([3, 5]);
        expect(Object.getOwnPropertyDescriptor(bare, "r")?.value).toBe(3);
    });

    it("never hands a subclass's node a slot by its parent's index", () => {
        class Sub extends Host { }
        const parent = new Host();
        const sub = new Sub();
        applyProp(parent, "s0", "parent's first");
        applyProp(parent, "s1", "parent's second");
        applyProp(sub, "s1", "sub's own");
        expect([read(sub, "s1"), read(sub, "s0")]).toEqual(["sub's own", undefined]);
    });

    it("shadows a member the class already has, per instance, as before", () => {
        class Labelled extends Host {
            get label(): string {
                return "the class's";
            }
        }
        const registered = new Labelled();
        applyProp(registered, "label", "the slot's");
        expect([registered.label, new Labelled().label]).toEqual(["the slot's", "the class's"]);
        expect(Object.getOwnPropertyDescriptor(registered, "label")?.get).toBeTypeOf("function");
    });

    it("reads nothing from a disposed node", () => {
        const node = new Rect({ x: 4 });
        node.dispose();
        expect(node.x).toBeUndefined();
    });

    it("lists a child's entries as its own state, read-only", () => {
        const node = new Rect({ x: 3, width: 40 });
        const { state } = childView(node) as unknown as { state: Record<string, unknown> };
        expect(Object.keys(state)).toEqual(expect.arrayContaining(["x", "width", "fill"]));
        expect({ ...state }).toMatchObject({ x: 3, width: 40 });
        expect(() => { state.x = 1; }).toThrow(TypeError);
    });
});
