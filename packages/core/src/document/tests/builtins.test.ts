import { describe, expect, it } from "vitest";

import { declareMembers, property } from "@/attributes/properties/decorator";
import { AudioBus } from "@/components/builtins/audio/audio";
import { Node2D, type Node2DProps } from "@/components/trees/2d/node2d";
import { Ellipse, Rect } from "@/components/builtins/geometry/geometry";
import { Text } from "@/components/builtins/text/text";
import { attached } from "@/components/trees/node/node.fixtures";
import { TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { runtimeScope } from "@/runtime/document.fixtures";
import type { Command, CommandArgs } from "@/tween/command";
import { command } from "@/tween/command-decorator";

import { Registry, type CommandTypeEntry, type VariableTarget } from "../registry";
import type { CommandSpec, CompositionDocument, NodeSpec, TimedNodeSpec, VariableSpec } from "../types";

const registry = new Registry();

const box = (id: string, props: Record<string, unknown> = {}, extra: Partial<TimedNodeSpec> = {}): TimedNodeSpec =>
    ({ id, type: "rect", parentId: null, layerOrder: 0, props: { width: 20, height: 20, ...props }, ...extra });

const cmd = (id: string, type: string, targetId: string | null, at: number, args: Record<string, unknown>, duration = 0): CommandSpec =>
    ({ id, type, targetId, at, duration, args });

const comp = (nodes: NodeSpec[], commands: CommandSpec[], variables?: VariableSpec[], duration?: number): CompositionDocument =>
    ({ kind: "composition", nodes, commands, ...(variables && { variables }), ...(duration !== undefined && { duration }) });

/** A built clip over `doc`, seekable to any second. */
function clipOf(doc: CompositionDocument, over: { registry?: Registry } = {}) {
    const clip = new TimelineClip(doc, runtimeScope({ registry: over.registry ?? registry }));
    clip.build();
    const at = <N extends object>(id: string): N => clip.timeline.liveNode(id) as unknown as N;
    return { clip, at };
}

/** The factory a node-scoped, node-less command was registered with. */
function factoryOf(key: string) {
    const entry = registry.command(key) as Extract<CommandTypeEntry, { scope: "node" }> | undefined;
    if (!entry || entry.scope !== "node") throw new Error(`no node-scoped command ${key}`);
    return entry.factory;
}

/** A stand-in for the variable a variable command writes. */
function variableStub(initial: unknown, lerp = registry.lerp("number")!) {
    let value = initial;
    const writes: unknown[] = [];
    const target: VariableTarget = {
        id: "g",
        get: () => value,
        set: (v) => { value = v; writes.push(v); },
        lerp,
    };
    return { target, writes, value: () => value };
}

const variableFactory = (key: string) => {
    const entry = registry.command(key);
    if (!entry || entry.scope !== "variable") throw new Error(`no variable command ${key}`);
    return entry.factory;
};

/** The red channel of a node's first fill layer. */
const red = (node: { fill: unknown }): number => (node.fill as Array<{ color: number[] }>)[0].color[0];
const blue = (node: { fill: unknown }): number => (node.fill as Array<{ color: number[] }>)[0].color[2];

describe("the `to` command", () => {
    it("tweens the props its args name, from where the node is", () => {
        const { clip, at } = clipOf(comp([box("a", { x: 10 })], [cmd("t", "to", "a", 0, { x: 50 }, 2)]));
        clip.seek(1);
        expect(at<Rect>("a").x).toBe(30);
        clip.seek(2);
        expect(at<Rect>("a").x).toBe(50);
    });

    it("copies its args, so expanding sugar never rewrites the document row", () => {
        const args = { size: 60 };
        const doc = comp([box("a")], [cmd("t", "to", "a", 0, args, 1)]);
        const { clip, at } = clipOf(doc);
        clip.seek(1);

        // `size` is sugar `_prepareStep` expands into width and height — in place on whatever it is given.
        expect([at<Rect>("a").width, at<Rect>("a").height]).toEqual([60, 60]);
        expect(args).toEqual({ size: 60 });
        expect(doc.commands[0].args).toEqual({ size: 60 });
    });

    it("does not touch the args of a factory call either", () => {
        const args = { size: 40, x: 5 };
        const target = attached(new Rect({ width: 10, height: 10 }));
        factoryOf("to")(target, args, 1).at(1);
        expect(args).toEqual({ size: 40, x: 5 });
        expect(target.width).toBe(40);
    });

    it("applies the easing it is given", () => {
        const doc = comp([box("a", { x: 0 })], [{ ...cmd("t", "to", "a", 0, { x: 100 }, 1), easing: { kind: "in", args: "quad" } }]);
        const { clip, at } = clipOf(doc);
        clip.seek(0.5);
        expect(at<Rect>("a").x).toBe(25);
    });
});

describe("the `set` command", () => {
    it("writes its props at once, and holds them from then on", () => {
        const { clip, at } = clipOf(comp([box("a", { x: 1 })], [cmd("s", "set", "a", 1, { x: 40 })], undefined, 3));
        clip.seek(0.5);
        expect(at<Rect>("a").x).toBe(1);
        clip.seek(1);
        expect(at<Rect>("a").x).toBe(40);
        clip.seek(3);
        expect(at<Rect>("a").x).toBe(40);
    });

    it("ignores duration and easing, being a stamp", () => {
        const stamped: CommandSpec = { ...cmd("s", "set", "a", 1, { x: 40 }, 5), easing: { kind: "in", args: "quad" } };
        const { clip, at } = clipOf(comp([box("a", { x: 0 })], [stamped], undefined, 8));

        clip.seek(1);
        expect(at<Rect>("a").x).toBe(40);
        clip.seek(3.5);   // halfway through its declared five seconds
        expect(at<Rect>("a").x).toBe(40);
        clip.seek(0.9);
        expect(at<Rect>("a").x).toBe(0);
    });

    it("is a stamp from the factory too, whatever duration it is handed", () => {
        const target = attached(new Rect({ width: 10, height: 10, x: 0 }));
        const made = factoryOf("set")(target, { x: 7 }, 9, () => 0);
        expect(made.duration).toBe(0);
        made.at(0);
        expect(target.x).toBe(7);
    });

    it("binds an expression among its args, which is what `binds` is for", () => {
        const { clip, at } = clipOf(comp(
            [box("a", { x: 0 })],
            [cmd("s", "set", "a", 0, { x: "=[g]*2" })],
            [{ id: "g", value: 4 }],
        ));
        clip.seek(0);
        expect(at<Rect>("a").x).toBe(8);
    });
});

describe("the `save` and `restore` pair through a timeline", () => {
    const base = (restore: CommandSpec) => comp(
        [box("a", { x: 0 })],
        [
            cmd("save", "save", "a", 0, {}),
            cmd("slide", "to", "a", 0, { x: 100 }, 1),
            restore,
        ],
        undefined,
        4,
    );

    it("rolls back at once when `restore` has no duration", () => {
        const { clip, at } = clipOf(base(cmd("back", "restore", "a", 2, {})));
        clip.seek(1.5);
        expect(at<Rect>("a").x).toBe(100);
        clip.seek(2);
        expect(at<Rect>("a").x).toBe(0);
        clip.seek(3.5);
        expect(at<Rect>("a").x).toBe(0);
    });

    it("tweens back over its duration when `restore` has one", () => {
        const { clip, at } = clipOf(base(cmd("back", "restore", "a", 2, {}, 1)));
        clip.seek(2);
        expect(at<Rect>("a").x).toBe(100);
        clip.seek(2.5);
        expect(at<Rect>("a").x).toBe(50);
        clip.seek(3);
        expect(at<Rect>("a").x).toBe(0);
    });

    it("gives the same frame whichever way the playhead arrived", () => {
        const { clip, at } = clipOf(base(cmd("back", "restore", "a", 2, {}, 1)));
        const frame = (t: number) => { clip.seek(t); return at<Rect>("a").x; };

        const forward = [0, 0.5, 1, 2, 2.25, 2.5, 3, 3.5].map(frame);
        const backward = [3.5, 3, 2.5, 2.25, 2, 1, 0.5, 0].map(frame).reverse();
        expect(backward).toEqual(forward);
        // And a re-run of the same seeks adds nothing to the stack: a later restore pops its own save.
        expect([0, 0.5, 1, 2, 2.25, 2.5, 3, 3.5].map(frame)).toEqual(forward);
    });

    it("keeps one layer per `save`, popped by its own `restore`", () => {
        const { clip, at } = clipOf(comp(
            [box("a", { x: 0 })],
            [
                cmd("s1", "save", "a", 0, {}),
                cmd("m1", "to", "a", 0, { x: 10 }, 1),
                cmd("s2", "save", "a", 1, {}),
                cmd("m2", "to", "a", 1, { x: 20 }, 1),
                cmd("r2", "restore", "a", 2, {}),
                cmd("r1", "restore", "a", 3, {}),
            ],
            undefined,
            4,
        ));
        const frame = (t: number) => { clip.seek(t); return at<Rect>("a").x; };
        expect(frame(1.5)).toBe(15);
        expect(frame(2)).toBe(10);
        expect(frame(3)).toBe(0);
        // Scrubbing back across both restores replays the same pops.
        expect(frame(1.5)).toBe(15);
        expect(frame(2.5)).toBe(10);
    });
});

describe("a node-less command against a node's own", () => {
    interface ProbeProps extends Node2DProps { flagged: number }

    /** Publishes its own method under the key `save`, which the node-less table already holds. */
    class Probe extends Node2D<ProbeProps> {
        declare flagged: number;

        ownSave(args: CommandArgs<Record<string, unknown>> & { duration: number }): Command<ProbeProps> {
            return this.to({ data: { flagged: 1 }, duration: args.duration, easing: args.easing });
        }
    }

    declareMembers(Probe, {
        flagged: property({ default: 0 }),

        ownSave: command({ key: "save", args: [] }),
    });

    it("resolves the node-less table first", () => {
        const probing = new Registry({ nodes: { probe: Probe as never } });
        expect(probing.commandKeys("probe")).toContain("save");
        expect(probing.command("save")).toBeDefined();

        const doc = comp(
            [{ id: "p", type: "probe", parentId: null, layerOrder: 0, props: { width: 10, height: 10 } }],
            [cmd("s", "save", "p", 0, {}, 1)],
            undefined,
            2,
        );
        const { clip, at } = clipOf(doc, { registry: probing });
        clip.seek(1);
        // The node's own `save` command would have set `flagged`; the global one pushes a layer instead.
        expect(at<Probe>("p").flagged).toBe(0);
        expect(at<Probe>("p")._stateStack).toHaveLength(1);
    });
});

describe("the paint commands", () => {
    const PAINT = [
        ["fillTo", "fill"],
        ["strokeTo", "stroke"],
        ["shadowTo", "shadow"],
        ["overlayTo", "overlay"],
    ] as const;

    it("tween a fill, easing it", () => {
        const target = attached(new Rect({ width: 10, height: 10, fill: "#ff0000" }));
        const made = factoryOf("fillTo")(target, { fill: "#0000ff" }, 1);
        made.at(0.5);
        expect(red(target)).toBeCloseTo(0.5, 3);
        expect(blue(target)).toBeCloseTo(0.5, 3);

        const eased = attached(new Rect({ width: 10, height: 10, fill: "#ff0000" }));
        factoryOf("fillTo")(eased, { fill: "#0000ff" }, 1, () => 0.25).at(0.9);
        expect(red(eased)).toBeCloseTo(0.75, 3);
    });

    it("tween an overlay, a stroke and a shadow too", () => {
        const target = attached(new Rect({ width: 10, height: 10 }));
        factoryOf("overlayTo")(target, { overlay: "#ffffff" }, 1).at(1);
        expect((target.overlay as unknown[]).length).toBe(1);

        factoryOf("strokeTo")(target, { stroke: { fill: "#00ff00", weight: 4 } }, 1).at(1);
        expect((target.stroke as unknown[]).length).toBe(1);

        factoryOf("shadowTo")(target, { shadow: { color: "#000000", blur: 8 } }, 1).at(1);
        expect((target.shadow as unknown[]).length).toBe(1);
    });

    it.each(PAINT)("%s reads its one arg and ignores the others", (key, arg) => {
        const target = attached(new Rect({ width: 10, height: 10 }));
        const args: Record<string, unknown> = { [arg]: arg === "stroke" ? { fill: "#00ff00" } : arg === "shadow" ? { color: "#000" } : "#123456" };
        expect(() => factoryOf(key)(target, { ...args, unrelated: 5 }, 1).at(1)).not.toThrow();
        expect((target as unknown as Record<string, unknown[]>)[arg]).toHaveLength(1);
    });

    it.each(PAINT)("%s throws, naming the class, on a target without the method", (key) => {
        const bus = new AudioBus({});
        expect(() => factoryOf(key)(bus, {}, 1)).toThrow(`Command "${key}" is not available on AudioBus.`);
    });

    it("leave overlayTo to shapes, so text, which paints a fill, does not have it", () => {
        const text = attached(new Text({ text: "hi", fontSize: 12 }));
        expect(() => factoryOf("fillTo")(text, { fill: "#fff" }, 1)).not.toThrow();
        expect(() => factoryOf("overlayTo")(text, { overlay: "#fff" }, 1))
            .toThrow('Command "overlayTo" is not available on Text.');

        const ellipse = attached(new Ellipse({ width: 10, height: 10 }));
        expect(() => factoryOf("overlayTo")(ellipse, { overlay: "#fff" }, 1)).not.toThrow();
    });

    it("run through a document like any other command", () => {
        const { clip, at } = clipOf(comp(
            [box("a", { fill: "#ff0000" })],
            [cmd("f", "fillTo", "a", 0, { fill: "#0000ff" }, 2)],
        ));
        clip.seek(1);
        expect(red(at<Rect>("a"))).toBeCloseTo(0.5, 3);
        clip.seek(2);
        expect(red(at<Rect>("a"))).toBeCloseTo(0, 3);
        clip.seek(0);
        expect(red(at<Rect>("a"))).toBeCloseTo(1, 3);
    });
});

describe("the `save` command", () => {
    it("is a stamp that pushes the node's state", () => {
        const target = attached(new Rect({ width: 10, height: 10, x: 3 }));
        const made = factoryOf("save")(target, {}, 5);
        expect(made.duration).toBe(0);
        made.at(0);
        expect(target._stateStack).toHaveLength(1);
    });
});

describe("the variable commands", () => {
    describe("variableTo", () => {
        it("interpolates from the value it first finds, with the variable's own lerp", () => {
            const stub = variableStub(10);
            const made = variableFactory("variableTo")(stub.target, { value: 20 }, 2);
            made.at(0.5);
            expect(stub.value()).toBe(15);
            made.at(1);
            expect(stub.value()).toBe(20);
        });

        it("captures `from` once, on the first evaluation, so a later change does not move it", () => {
            const stub = variableStub(0);
            const made = variableFactory("variableTo")(stub.target, { value: 100 }, 1);
            made.at(0.5);               // captures 0
            stub.target.set(1000);
            made.at(0.5);
            expect(stub.value()).toBe(50);
        });

        it("applies the easing", () => {
            const stub = variableStub(0);
            variableFactory("variableTo")(stub.target, { value: 100 }, 1, (t) => t * t).at(0.5);
            expect(stub.value()).toBe(25);
        });

        it("takes a lerp named in its args over the variable's own", () => {
            const stub = variableStub(0);
            const made = variableFactory("variableTo")(stub.target, { value: 100, lerp: "step" }, 1);
            made.at(0.5);
            expect(stub.value()).toBe(0);
            made.at(1);
            expect(stub.value()).toBe(100);
        });

        it("refuses a lerp that names nothing registered, saying what is", () => {
            const stub = variableStub(0);
            expect(() => variableFactory("variableTo")(stub.target, { value: 1, lerp: "bezier" }, 1))
                .toThrow('A "lerp" param must name a registered lerp (variable "g"), got "bezier". Registered: color, number, step, vector2, vector3.');
        });

        it("refuses a lerp that is not even a string", () => {
            const stub = variableStub(0);
            expect(() => variableFactory("variableTo")(stub.target, { value: 1, lerp: 5 }, 1))
                .toThrow(/got 5\. Registered:/);
            expect(() => variableFactory("variableTo")(stub.target, { value: 1, lerp: null }, 1))
                .toThrow(/got null\. Registered:/);
        });

        it("ignores an absent lerp rather than treating it as bad", () => {
            const stub = variableStub(0);
            expect(() => variableFactory("variableTo")(stub.target, { value: 1, lerp: undefined }, 1)).not.toThrow();
        });
    });

    describe("variableSet", () => {
        it("writes its value at once, ignoring duration", () => {
            const stub = variableStub(1);
            const made = variableFactory("variableSet")(stub.target, { value: 9 }, 5, (t) => t * t);
            expect(made.duration).toBe(0);
            made.at(0);
            expect(stub.value()).toBe(9);
        });

        it("writes whatever the value is, not only a number", () => {
            const stub = variableStub(null);
            variableFactory("variableSet")(stub.target, { value: { x: 1 } }, 0).at(1);
            expect(stub.value()).toEqual({ x: 1 });
        });
    });
});
