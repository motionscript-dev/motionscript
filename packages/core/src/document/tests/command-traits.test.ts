import { describe, expect, it } from "vitest";

import { Rect, type RectProps } from "@/components/builtins/geometry/geometry";
import { driveCommand, type Command, type CommandArgs } from "@/tween/command";
import { command } from "@/tween/command-decorator";

import {
    ALIGNMENT_KEYS,
    commandNodeRefs,
    commandTraits,
    hasNodeRef,
    isContextProvider,
    isLayoutNeutralProp,
} from "../command-traits";
import { Registry } from "../registry";
import type { CommandSpec, NodeSpec } from "../types";
import { generated } from "@/components/factory/tests/generated.fixtures";
import { declareMembers } from "@/attributes/properties/decorator";

/** Overrides a command it inherits, so what runs under `fadeTo` is no longer the library's. */
class Fader extends generated(Rect) {
    override fadeTo(args: CommandArgs<{ opacity: number }> & { duration: number }): Command<RectProps> {
        return super.fadeTo(args);
    }
}

/** Overrides the `to` every tween helper runs through. */
class Mover extends generated(Rect) {
    override to<D extends Partial<RectProps>>(args: CommandArgs<D> & { duration: number }): Command<RectProps> {
        return super.to(args);
    }
}

/** Adds nothing a command runs through. */
class Card extends generated(Rect) { }

/** Publishes a method of its own under a core command's key that nothing above it declares. */
class Counter extends generated(Rect) {
    tally(args: CommandArgs<{ value: number }> & { duration: number }): Command<RectProps> {
        return this.to({ data: { width: args.data?.value }, duration: args.duration });
    }
}

declareMembers(Counter, {
    tally: command({ key: "countTo" }),
});

const registry = new Registry({
    nodes: { fader: Fader as never, mover: Mover as never, card: Card as never, counter: Counter as never },
});
registry.addCommand("shimmy", () => driveCommand(0, () => { }) as never);
registry.addVariableCommand("spring", () => driveCommand(0, () => { }) as never);

function row(id: string, type: string, props: Record<string, unknown> = {}): NodeSpec {
    return { id, type, parentId: null, layerOrder: 0, props };
}

function cmd(type: string, args: Record<string, unknown> = {}, targetId: string | null = "t"): CommandSpec {
    return { id: "c", type, targetId, at: 0, duration: 1, args };
}

const rect = row("t", "rect");
const aligned = row("t", "rect", { topLeft: { x: 0, y: 0 }, width: 10, height: 10 });

describe("commandTraits — resolution", () => {
    it("resolves the global table first, then the target type's own", () => {
        expect(commandTraits(registry, cmd("to", { x: 1 }), rect)).toMatchObject({ scope: "node", known: true });
        expect(commandTraits(registry, cmd("fadeTo", { opacity: 0 }), rect)).toMatchObject({ scope: "node", known: true });
        expect(commandTraits(registry, cmd("variableTo", { value: 1 }, "g"), undefined)).toMatchObject({ scope: "variable", known: true });
    });

    it("is null for what compiling would refuse", () => {
        const strict = new Registry({ strict: true });
        expect(commandTraits(strict, cmd("nope"), rect)).toBeNull();
        expect(commandTraits(strict, cmd("fadeTo"), row("t", "unregistered"))).toBeNull();
        expect(commandTraits(registry, cmd("fadeTo"), undefined)).toBeNull();
        // A paint command on a node with nothing to paint.
        expect(commandTraits(registry, cmd("fillTo", { fill: "red" }), row("t", "audioBus"))).toBeNull();
    });

    it("knows a command the build skips writes nothing", () => {
        const skipped = { scope: "node", known: true, lifecycle: false, readsLayout: false, writesLayout: false };
        expect(commandTraits(registry, cmd("nope"), rect)).toEqual(skipped);
        expect(commandTraits(registry, cmd("fadeTo"), row("t", "unregistered"))).toEqual(skipped);
    });

    it("answers for the default root when a document authors none", () => {
        expect(commandTraits(registry, cmd("zoomTo", { zoom: 2 }, null), undefined))
            .toEqual({ scope: "node", known: true, lifecycle: false, readsLayout: false, writesLayout: false });
    });
});

describe("commandTraits — known", () => {
    it("knows every core command on a core type", () => {
        const cases: [string, NodeSpec][] = [
            ["to", rect], ["set", rect], ["save", rect], ["restore", rect],
            ["fadeTo", rect], ["rotateTo", rect], ["scaleTo", rect], ["moveTo", rect],
            ["layoutTo", rect], ["effectTo", rect], ["progressTo", rect],
            ["pulse", rect], ["wiggle", rect], ["flash", rect],
            ["fillTo", rect], ["overlayTo", rect], ["strokeTo", rect], ["shadowTo", rect],
            ["zoomTo", row("", "canvas2d")], ["panTo", row("c", "camera")], ["headingTo", row("c", "camera")],
            ["countTo", row("n", "number")], ["to", row("n", "number")],
            ["append", row("x", "text")], ["prepend", row("x", "text")],
        ];
        for (const [type, target] of cases) {
            expect(commandTraits(registry, cmd(type, {}, target.id), target)?.known, `${type} on ${target.type}`).toBe(true);
        }
    });

    it("does not know a subclass override, which reads and writes anything", () => {
        expect(commandTraits(registry, cmd("fadeTo", { opacity: 0 }), row("t", "fader")))
            .toEqual({ scope: "node", known: false, lifecycle: false, readsLayout: true, writesLayout: true });
    });

    it("does not know a command running through an overridden method", () => {
        expect(commandTraits(registry, cmd("fadeTo", { opacity: 0 }), row("t", "mover"))?.known).toBe(false);
        expect(commandTraits(registry, cmd("to", { x: 1 }), row("t", "mover"))?.known).toBe(false);
        // `set` runs through neither.
        expect(commandTraits(registry, cmd("set", { x: 1 }), row("t", "mover"))?.known).toBe(true);
    });

    it("does not know a core key published by a method of another name", () => {
        expect(commandTraits(registry, cmd("countTo", { value: 4 }), row("t", "counter")))
            .toEqual({ scope: "node", known: false, lifecycle: false, readsLayout: true, writesLayout: true });
    });

    it("knows a subclass that overrides nothing a command runs through", () => {
        expect(commandTraits(registry, cmd("fadeTo", { opacity: 0 }), row("t", "card"))?.known).toBe(true);
    });

    it("does not know a host's own global commands", () => {
        expect(commandTraits(registry, cmd("shimmy"), rect)).toMatchObject({ known: false, readsLayout: true, writesLayout: true });
        expect(commandTraits(registry, cmd("spring", {}, "g"), undefined))
            .toEqual({ scope: "variable", known: false, lifecycle: false, readsLayout: true, writesLayout: false });
    });

    it("flags lifecycle commands, and assumes the worst of them", () => {
        expect(commandTraits(registry, cmd("removeChildAt", { index: 0 }), rect))
            .toEqual({ scope: "node", known: false, lifecycle: true, readsLayout: true, writesLayout: true });
    });
});

describe("commandTraits — readsLayout", () => {
    it("is false for a plain tween on a plain node, and for a variable command", () => {
        expect(commandTraits(registry, cmd("to", { x: 5, width: 20 }), rect)?.readsLayout).toBe(false);
        expect(commandTraits(registry, cmd("variableSet", { value: 1 }, "g"), undefined)?.readsLayout).toBe(false);
    });

    it("is true for an alignment key in the args", () => {
        expect(commandTraits(registry, cmd("to", { topLeft: { x: 0, y: 0 } }), rect)?.readsLayout).toBe(true);
    });

    it("is true for a `from` over an alignment-authored x/y, and only those", () => {
        expect(commandTraits(registry, cmd("to", { x: 5 }), aligned)?.readsLayout).toBe(true);
        expect(commandTraits(registry, cmd("moveTo", { x: 5, y: 5 }), aligned)?.readsLayout).toBe(true);
        expect(commandTraits(registry, cmd("to", { opacity: 0 }), aligned)?.readsLayout).toBe(false);
        expect(commandTraits(registry, cmd("fadeTo", { opacity: 0 }), aligned)?.readsLayout).toBe(false);
        expect(commandTraits(registry, cmd("set", { x: 5 }), aligned)?.readsLayout).toBe(false);
    });

    it("is true for save/restore on an alignment-authored node, which snapshot its bindings", () => {
        expect(commandTraits(registry, cmd("save"), aligned)?.readsLayout).toBe(true);
        expect(commandTraits(registry, cmd("restore"), aligned)?.readsLayout).toBe(true);
        expect(commandTraits(registry, cmd("save"), rect)?.readsLayout).toBe(false);
        expect(commandTraits(registry, cmd("restore"), rect)?.readsLayout).toBe(false);
    });

    it("is true for a move aimed at another node's box, and only then", () => {
        expect(commandTraits(registry, cmd("moveTo", { target: "card" }), rect)?.readsLayout).toBe(true);
        expect(commandTraits(registry, cmd("moveTo", { target: "" }), rect)?.readsLayout).toBe(false);
        expect(commandTraits(registry, cmd("moveTo", { x: 5, y: 5 }), rect)?.readsLayout).toBe(false);
    });

    it("is true for a `from` over a prop bound to another node", () => {
        const bound = row("t", "rect", { x: "=[card.x]+4", opacity: "=[g]" });
        expect(commandTraits(registry, cmd("to", { x: 5 }), bound)?.readsLayout).toBe(true);
        // A variable is a value, never a box.
        expect(commandTraits(registry, cmd("fadeTo", { opacity: 0 }), bound)?.readsLayout).toBe(false);
        expect(commandTraits(registry, cmd("save"), bound)?.readsLayout).toBe(true);
    });
});

describe("commandTraits — writesLayout", () => {
    it("is false when every written prop is layout-neutral", () => {
        for (const [type, args] of [
            ["to", { x: 1, y: 2, opacity: 0, rotation: 9, scale: 2 }],
            ["to", { topLeft: { x: 0, y: 0 }, pivot: "center" }],
            ["set", { fill: "red", blend: "screen" }],
            ["fadeTo", { opacity: 0 }], ["rotateTo", { rotation: 45 }], ["scaleTo", { scale: 2 }],
            ["moveTo", { x: 1 }], ["fillTo", { fill: "red" }], ["strokeTo", { stroke: "red" }],
            ["effectTo", { effects: [{ type: "blur", radius: 4 }] }],
        ] as const) {
            expect(commandTraits(registry, cmd(type, args), rect)?.writesLayout, type).toBe(false);
        }
    });

    it("is true when any written prop can move a box", () => {
        expect(commandTraits(registry, cmd("to", { x: 1, width: 20 }), rect)?.writesLayout).toBe(true);
        expect(commandTraits(registry, cmd("set", { size: 20 }), rect)?.writesLayout).toBe(true);
        expect(commandTraits(registry, cmd("set", { pivot: "center" }), rect)?.writesLayout).toBe(true);
        expect(commandTraits(registry, cmd("layoutTo", { width: 20 }), rect)?.writesLayout).toBe(true);
    });

    it("is true for commands whose writes resize or restack the node", () => {
        expect(commandTraits(registry, cmd("countTo", { value: 3 }, "n"), row("n", "number"))?.writesLayout).toBe(true);
        expect(commandTraits(registry, cmd("append", { text: "!" }, "x"), row("x", "text"))?.writesLayout).toBe(true);
        expect(commandTraits(registry, cmd("save"), rect)?.writesLayout).toBe(true);
        expect(commandTraits(registry, cmd("restore"), rect)?.writesLayout).toBe(true);
    });

    it("is true on a custom type, whose layout could read anything but its placement", () => {
        expect(commandTraits(registry, cmd("to", { width: 10 }), row("t", "card"))?.writesLayout).toBe(true);
        expect(commandTraits(registry, cmd("fadeTo", { opacity: 0 }), row("t", "card"))?.writesLayout).toBe(false);
    });

    it("is false for any prop of a core audio node", () => {
        expect(commandTraits(registry, cmd("set", { volume: 0.5, mute: true }), row("s", "sound"))?.writesLayout).toBe(false);
    });
});

describe("commandNodeRefs", () => {
    it("reads the ids a command's `nodeRef` args name, and nothing else", () => {
        expect(commandNodeRefs(registry, cmd("moveTo", { target: "card", targetAnchor: "topLeft" }), rect)).toEqual(["card"]);
        expect(commandNodeRefs(registry, cmd("moveTo", { x: 5 }), rect)).toEqual([]);
        expect(commandNodeRefs(registry, cmd("to", { target: "card" }), rect)).toEqual([]);
    });
});

describe("isLayoutNeutralProp", () => {
    it("answers for placement on any type, and past it only for the library's own classes", () => {
        expect(isLayoutNeutralProp(registry, "rect", "x")).toBe(true);
        expect(isLayoutNeutralProp(registry, "rect", "fill")).toBe(true);
        expect(isLayoutNeutralProp(registry, "rect", "width")).toBe(false);
        expect(isLayoutNeutralProp(registry, "audioBus", "volume")).toBe(true);
        expect(isLayoutNeutralProp(registry, "card", "x")).toBe(true);
        expect(isLayoutNeutralProp(registry, "card", "fill")).toBe(false);
        expect(isLayoutNeutralProp(registry, "unregistered", "x")).toBe(false);
    });
});

describe("isContextProvider", () => {
    it("is true for a type that hands its descendants a context", () => {
        expect(isContextProvider(registry, "provider")).toBe(true);
        expect(isContextProvider(registry, "theme-provider")).toBe(true);
        expect(isContextProvider(registry, "default-text-style")).toBe(true);
        expect(isContextProvider(registry, "rect")).toBe(false);
        expect(isContextProvider(registry, "card")).toBe(false);
        expect(isContextProvider(registry, "unregistered")).toBe(false);
    });
});

describe("hasNodeRef", () => {
    it("finds a node reference at any depth, and nothing else", () => {
        expect(hasNodeRef({ padding: { top: "=[card.height]/2" } })).toBe(true);
        expect(hasNodeRef("=[g]*2")).toBe(false);
        expect(hasNodeRef("==[card.x]")).toBe(false);
        expect(hasNodeRef(12)).toBe(false);
    });
});

it("names the nine alignment keys", () => {
    expect([...ALIGNMENT_KEYS].sort()).toEqual([
        "bottomCenter", "bottomLeft", "bottomRight", "center", "centerLeft",
        "centerRight", "topCenter", "topLeft", "topRight",
    ]);
});
