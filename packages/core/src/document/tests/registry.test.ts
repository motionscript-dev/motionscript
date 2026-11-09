import { describe, expect, it } from "vitest";

import { declareMembers, property } from "@/attributes/properties/decorator";
import { Node2D, type NodeConfig, type Node2DProps } from "@/components/trees/2d/node2d";
import { evaluatorFor, FPS, precompFor, project, track } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";
import type { Command, CommandArgs } from "@/tween/command";
import { command } from "@/tween/command-decorator";

import { Path, PathShape } from "@/components/builtins/geometry/geometry";

import { component2d } from "@/components/factory/component2d";

import { node } from "../node-decorator";
import { Registry, type NodeConstructor } from "../registry";
import { ROOT_NODE_ID, type CompositionDocument, type NodeSpec } from "../types";

function row(id: string, type: string, props: Record<string, unknown>, order = 0): NodeSpec {
    return { id, type, parentId: null, layerOrder: order, props };
}

// Two node types publishing the same command name with *different* arguments —
// the case a single flat command table cannot express.

interface BlobProps extends Node2DProps { wobble: number }

class Blob extends Node2D<BlobProps> {
    declare readonly wobble: number;

    constructor(props?: NodeConfig<Blob, BlobProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
    }

    wobbleTo(args: CommandArgs<{ wobble: number }> & { duration: number }): Command<BlobProps> {
        return this.to({ data: args.data as Partial<BlobProps>, duration: args.duration, easing: args.easing });
    }
}

declareMembers(Blob, {
    wobble: property({ default: 0.4 }),

    wobbleTo: command({ args: ["wobble"] }),
});
node("test-blob")(Blob);

interface JellyProps extends Node2DProps { amount: number; phase: number }

class Jelly extends Node2D<JellyProps> {
    declare readonly amount: number;
    declare readonly phase: number;

    constructor(props?: NodeConfig<Jelly, JellyProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
    }

    wobbleTo(args: CommandArgs<{ amount: number; phase: number }> & { duration: number }): Command<JellyProps> {
        return this.to({ data: args.data as Partial<JellyProps>, duration: args.duration, easing: args.easing });
    }
}

declareMembers(Jelly, {
    amount: property({ default: 0 }),
    phase: property({ default: 0 }),

    wobbleTo: command({ args: ["amount", "phase"] }),
});
node("test-jelly")(Jelly);

/** A subclass publishes what it inherits, with nothing restated. */
class _BlobSub extends Blob { }
node("test-blob-sub")(_BlobSub);

// One registry, built the way an engine builds one: the builtins it seeds
// itself with, plus this file's own types handed in as values.
const registry = new Registry({ nodes: [Blob, Jelly, _BlobSub] });

/** A lone composition, as the one track of a project. */
const opened = (doc: CompositionDocument) => project([track("a", doc)]);
const evaluatorOver = (doc: CompositionDocument): StateEvaluator => evaluatorFor(opened(doc), { registry });

describe("Registry.addNode", () => {
    it("registers the class under its key", () => {
        expect(registry.node("test-blob")?.ctor).toBe(Blob);
        expect(registry.nodeKeys()).toContain("test-blob");
    });

    it("publishes the class's own commands", () => {
        expect(registry.commandKeys("test-blob")).toContain("wobbleTo");
    });

    it("publishes inherited commands too", () => {
        // `fadeTo`/`moveTo` are declared on Node2D, `restore` on Node.
        expect(registry.commandKeys("test-blob")).toEqual(
            expect.arrayContaining(["fadeTo", "moveTo", "restore", "wobbleTo"]),
        );
        expect(registry.commandKeys("test-blob-sub")).toContain("wobbleTo");
    });

    it("describes moveTo's path argument, so a host can offer a path editor", () => {
        const args = registry.node("test-blob")?.commands.get("moveTo")?.args ?? [];
        expect(args).toEqual(
            expect.arrayContaining([{ key: "path", kind: "path" }]),
        );
    });

    it("is a no-op for the same class and throws for a different one", () => {
        expect(() => registry.addNode("test-blob", Blob as never)).not.toThrow();
        expect(() => registry.addNode("test-blob", Jelly as never))
            .toThrow(/already registered to a different class/);
    });

    it("does not register from node() — a registry holds what it was given", () => {
        class Unregistered extends Node2D { }
        node("test-unregistered")(Unregistered);

        // Declared, imported, evaluated — and still unknown, because nothing
        // handed it to this registry. That is the whole difference: a
        // registration is an act with an owner, not a side effect of a module.
        expect(registry.hasNode("test-unregistered")).toBe(false);
        expect(new Registry({ nodes: [Unregistered] }).hasNode("test-unregistered")).toBe(true);
    });

    it("refuses a class with neither a node() declaration nor an explicit key", () => {
        class Bare extends Node2D { }
        expect(() => registry.addNode(Bare as never))
            .toThrow(/is no component/);
    });

    it("two registries disagree freely", () => {
        const other = new Registry();
        expect(other.hasNode("test-blob")).toBe(false);
        expect(other.hasNode("rect")).toBe(true);
        // …and each seeds its own builtins, so neither can be emptied by the other.
        expect(registry.hasNode("rect")).toBe(true);
    });

    it("reads command metadata without constructing the class", () => {
        let constructed = 0;
        class Counting extends Node2D {
            constructor(props?: NodeConfig<Counting, Node2DProps>) {
                super(props as NodeConfig<Node2D, Node2DProps>);
                constructed++;
            }
            spin(args: CommandArgs<{ v: number }> & { duration: number }): Command<Node2DProps> {
                return this.to({ data: { rotation: args.data?.v } as Partial<Node2DProps>, duration: args.duration, easing: args.easing });
            }
        }

        declareMembers(Counting, {
            spin: command({ args: ["v"] }),
        });
        registry.addNode("test-counting", Counting as never);
        expect(registry.commandKeys("test-counting")).toContain("spin");
        expect(constructed).toBe(0);
    });
});

describe("Registry.instantiate — node identity", () => {
    const spec = (id: string, props: Record<string, unknown> = {}): NodeSpec =>
        ({ id, type: "test-blob", parentId: null, layerOrder: 0, props });

    it("gives the node its spec's id", () => {
        expect(registry.instantiate(spec("blob-7")).id).toBe("blob-7");
    });

    it("the spec's id outranks an `id` among the overriding props", () => {
        expect(registry.instantiate(spec("blob-7"), { id: "not-this" }).id).toBe("blob-7");
    });

    it("falls back to a unique id for a node built in code rather than from a row", () => {
        const a = new Blob({ width: 1, height: 1 });
        const b = new Blob({ width: 1, height: 1 });
        expect(a.id).not.toBe(b.id);
        expect(a.id).not.toBe("");
    });

    /**
     * `key` is a row field, not a prop, and it has to reach the node:
     * `applyEditorStates` keys the whole editor-state record on `Node.key`, so a
     * key that stopped at the spec is a node a host cannot hide or lock.
     */
    it("carries the row's key onto the node", () => {
        expect(registry.instantiate({ ...spec("blob-7"), key: "card" }).key).toBe("card");
        expect(registry.instantiate(spec("blob-7")).key).toBeUndefined();
    });

    it("leaves a `key` passed as a prop alone when the row has none", () => {
        expect(registry.instantiate(spec("blob-7", { key: "legacy" })).key).toBe("legacy");
        expect(registry.instantiate({ ...spec("blob-7"), key: "row" }, { key: "prop" }).key).toBe("row");
    });

    it("keeps an empty-string id rather than generating over it", () => {
        // The fallback is nullish, not falsy. `""` is the scene root's real id
        // (see `ROOT_NODE_ID`), so a `props?.id ?? uuid()` written as
        // `props?.id || uuid()` would silently rename the root.
        expect(new Blob({ id: "", width: 1, height: 1 }).id).toBe("");
        expect(registry.instantiate(spec("")).id).toBe("");
    });

    it("carries a document's authored ids into the live tree, and keeps them across a rebuild", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [
                row("b", "test-blob", { width: 10, height: 10 }),
                row("j", "test-jelly", { width: 10, height: 10 }, 1),
            ],
            commands: [],
        };
        const evaluator = evaluatorOver(doc);
        const ids = () => evaluator.currentCanvas!.children.map((c) => c.id);

        evaluator.stateAt(0);
        expect(ids()).toEqual(["b", "j"]);

        // The whole point: a rebuild used to hand every node a fresh UUID, so a
        // host could never resolve one it had addressed by id.
        evaluator.rebuild();
        evaluator.stateAt(0);
        expect(ids()).toEqual(["b", "j"]);
    });

    it("builds the clip root as the document's root row — id \"\"", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [row("b", "test-blob", { width: 10, height: 10 })],
            commands: [],
        };
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(0);
        // The root is the one node `instantiate` never makes — `ClipInstance`
        // builds it and `ClipTimeline` only `set()`s that row's props over it —
        // so this pins the two to the same id rather than leaving the canvas a
        // UUID the document has no row for.
        expect(evaluator.currentCanvas!.id).toBe(ROOT_NODE_ID);
    });
});

/**
 * Which class a *document* means by a type name, for the one key where two
 * classes could answer. `Path` and `PathShape` both draw a `d`, and they read it
 * differently: `Path` at face value, `PathShape` as a fraction of the node's own
 * box. An editor stores the second — a resize has to be a `width`/`height`
 * write, not a rewrite of every coordinate — so a document that names `path` and
 * gets the first draws its whole shape inside one pixel at the node's centre.
 * What each class then *draws* is `geometry/tests/bounds-shape.test.ts`'s.
 */
describe("the built-in `path` type", () => {
    it("is the unit-box PathShape, not the face-value Path", () => {
        expect(registry.node("path")?.ctor).toBe(PathShape.node as unknown as NodeConstructor);
        expect(registry.node("path")?.ctor).not.toBe(Path as unknown as NodeConstructor);
    });

    it("builds one from a document row", () => {
        const spec = row("p", "path", { width: 400, height: 200, data: "M 0 -0.5 L 0.5 0 L 0 0.5 L -0.5 0 Z" });
        expect(registry.instantiate(spec)).toBeInstanceOf(PathShape);
    });
});

describe("per-node command tables", () => {
    it("two node types share a command name with different arguments", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [
                row("b", "test-blob", { wobble: 0.2, width: 10, height: 10 }),
                row("j", "test-jelly", { amount: 0, phase: 0, width: 10, height: 10 }, 1),
            ],
            commands: [
                { id: "w1", type: "wobbleTo", targetId: "b", at: 0, duration: 1, args: { wobble: 1 } },
                { id: "w2", type: "wobbleTo", targetId: "j", at: 0, duration: 1, args: { amount: 4, phase: 8 } },
            ],
        };
        const evaluator = evaluatorOver(doc);
        const blob = () => evaluator.currentCanvas!.children.find((c) => c instanceof Blob) as Blob;
        const jelly = () => evaluator.currentCanvas!.children.find((c) => c instanceof Jelly) as Jelly;

        evaluator.stateAt(0);
        expect(blob().wobble).toBeCloseTo(0.2);

        evaluator.stateAt(FPS / 2);
        expect(blob().wobble).toBeCloseTo(0.6);
        expect(jelly().amount).toBeCloseTo(2);
        expect(jelly().phase).toBeCloseTo(4);

        evaluator.stateAt(FPS);
        expect(blob().wobble).toBeCloseTo(1);
        expect(jelly().amount).toBeCloseTo(4);
    });

    it("a built-in command still reaches its node", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [row("r", "rect", { width: 10, height: 10, opacity: 0 })],
            commands: [
                { id: "f", type: "fadeTo", targetId: "r", at: 0, duration: 1, args: { opacity: 1 } },
            ],
        };
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(FPS / 2);
        expect(evaluator.currentCanvas!.children[0]?.opacity).toBeCloseTo(0.5);
    });

    it("a command published under another key runs its own method", () => {
        // Each key already names something else on the class: a prop, and an
        // inherited method that does nothing with command args.
        interface BellProps extends Node2DProps { ring: number; swing: number }
        class Bell extends Node2D<BellProps> {
            declare readonly ring: number;
            declare readonly swing: number;

            constructor(props?: NodeConfig<Bell, BellProps>) {
                super(props as NodeConfig<Node2D, Node2DProps>);
            }

            strike(args: CommandArgs<{ ring: number }> & { duration: number }): Command<BellProps> {
                return this.to({ data: { ring: args.data?.ring }, duration: args.duration, easing: args.easing });
            }

            sway(args: CommandArgs<{ swing: number }> & { duration: number }): Command<BellProps> {
                return this.to({ data: { swing: args.data?.swing }, duration: args.duration, easing: args.easing });
            }
        }

        declareMembers(Bell, {
            ring: property({ default: 0 }),
            swing: property({ default: 0 }),

            strike: command({ key: "ring", args: ["ring"] }),
            sway: command({ key: "remove", args: ["swing"] }),
        });
        const bells = new Registry({ nodes: { "test-bell": Bell as never } });
        expect(bells.commandKeys("test-bell")).toEqual(expect.arrayContaining(["ring", "remove"]));
        expect(bells.commandKeys("test-bell")).not.toContain("strike");

        const evaluator = evaluatorFor(opened({
            kind: "composition",
            nodes: [row("b", "test-bell", { width: 10, height: 10 })],
            commands: [
                { id: "r", type: "ring", targetId: "b", at: 0, duration: 1, args: { ring: 1 } },
                { id: "s", type: "remove", targetId: "b", at: 0, duration: 1, args: { swing: 4 } },
            ],
        }), { registry: bells });
        evaluator.stateAt(FPS / 2);
        const bell = evaluator.currentCanvas!.children.find((c) => c instanceof Bell) as Bell;
        expect(bell.ring).toBeCloseTo(0.5);
        expect(bell.swing).toBeCloseTo(2);
        expect(bells.node("test-bell")?.commands.get("ring")?.method).toBe("strike");
    });

    it("an unknown command names what the type does publish", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [row("b", "test-blob", { width: 10, height: 10 })],
            commands: [
                { id: "x", type: "squishTo", targetId: "b", at: 0, duration: 1, args: {} },
            ],
        };
        // Skipped and recorded, never thrown: the rest of the clip still builds.
        const [error] = precompFor(opened(doc), { registry }).run().buildErrors;
        expect([error?.code, error?.commandId, error?.nodeId]).toEqual(["unknown-command", "x", "b"]);
        const message = error?.message ?? "";
        expect(message).toMatch(/Node type "test-blob" has no command "squishTo"/);
        expect(message).toMatch(/It publishes:.*wobbleTo/);
    });
});

describe("a subclass redeclaring what it inherits", () => {
    const snap = (a: number, b: number, t: number) => (t < 1 ? a : b);

    interface DialProps extends Node2DProps { level: number; spare: number; turned: number }

    class Dial extends Node2D<DialProps> {
        declare readonly level: number;
        declare readonly spare: number;
        declare readonly turned: number;

        constructor(props?: NodeConfig<Dial, DialProps>) {
            super(props as NodeConfig<Node2D, Node2DProps>);
        }

        turn(args: CommandArgs<Record<string, number>> & { duration: number }): Command<DialProps> {
            const sum = Object.values(args.data ?? {}).reduce((a, b) => a + (b ?? 0), 0);
            return this.to({ data: { turned: sum }, duration: args.duration, easing: args.easing });
        }
    }

    declareMembers(Dial, {
        level: property({ default: 1, min: 0, max: 10, unit: "°" }),
        spare: property({ default: 3 }),
        turned: property({ default: 0 }),

        turn: command({ args: ["by"] }),
    });

    class FineDial extends Dial {
        declare readonly level: number;

        override turn(args: CommandArgs<Record<string, number>> & { duration: number }): Command<DialProps> {
            return super.turn(args);
        }
    }

    declareMembers(FineDial, {
        level: property({ default: 7, min: 5, max: 20, step: 0.5, tween: snap }),

        turn: command({ args: ["coarse", { key: "fine", min: 0, max: 1 }] }),
    });

    const dials = new Registry({ nodes: { "test-dial": Dial as never, "test-fine-dial": FineDial as never } });

    it("describes the subclass's declaration, and keeps what it does not redeclare", () => {
        const props = dials.describe("test-fine-dial")?.properties ?? {};
        expect(props.level).toEqual({ kind: "number", default: 7, min: 5, max: 20, step: 0.5 });
        expect(props.spare).toEqual({ kind: "number", default: 3 });
        expect(dials.describe("test-dial")?.properties?.level)
            .toEqual({ kind: "number", default: 1, min: 0, max: 10, unit: "°" });
    });

    it("starts an instance at the subclass's default", () => {
        expect(new FineDial().level).toBe(7);
        expect(new FineDial().spare).toBe(3);
        expect(new Dial().level).toBe(1);
        expect((dials.instantiate(row("f", "test-fine-dial", {})) as FineDial).level).toBe(7);
    });

    it("tweens with the subclass's tween", () => {
        const evaluator = evaluatorFor(opened({
            kind: "composition",
            nodes: [row("f", "test-fine-dial", { width: 10, height: 10 })],
            commands: [{ id: "t", type: "to", targetId: "f", at: 0, duration: 1, args: { level: 17 } }],
        }), { registry: dials });
        const dial = () => evaluator.currentCanvas!.children.find((c) => c instanceof FineDial) as FineDial;

        evaluator.stateAt(FPS / 2);
        expect(dial().level).toBe(7);
        evaluator.stateAt(FPS);
        expect(dial().level).toBe(17);
    });

    it("publishes and dispatches the subclass's command arguments", () => {
        expect(dials.node("test-fine-dial")?.commands.get("turn")?.args)
            .toEqual([{ key: "coarse", kind: "unknown" }, { key: "fine", kind: "unknown", min: 0, max: 1 }]);
        expect(dials.node("test-dial")?.commands.get("turn")?.args).toEqual([{ key: "by", kind: "unknown" }]);

        const evaluator = evaluatorFor(opened({
            kind: "composition",
            nodes: [row("f", "test-fine-dial", { width: 10, height: 10 })],
            commands: [{ id: "t", type: "turn", targetId: "f", at: 0, duration: 1, args: { coarse: 4, fine: 0.5, by: 100 } }],
        }), { registry: dials });
        evaluator.stateAt(FPS);
        const dial = evaluator.currentCanvas!.children.find((c) => c instanceof FineDial) as FineDial;
        expect(dial.turned).toBeCloseTo(4.5);
    });
});

describe("Registry.addNode replace option", () => {
    it("still throws by default on a different class", () => {
        const r = new Registry();
        r.addNode("dup", Blob as never);
        expect(() => r.addNode("dup", Jelly as never)).toThrow(/already registered to a different class/);
    });

    it("replaces the class when { replace: true } is passed", () => {
        const r = new Registry();
        r.addNode("dup", Blob as never);
        r.addNode("dup", Jelly as never, { replace: true });
        expect(r.node("dup")?.ctor).toBe(Jelly);
    });
});

describe("Registry.addShader replace option", () => {
    const stripes = { scope: "fill" as const, name: "Stripes", source: "fn fill(in: FillIn) -> vec4f { return vec4f(1.0); }" };
    const dots = { scope: "fill" as const, name: "Dots", source: "fn fill(in: FillIn) -> vec4f { return vec4f(0.0); }" };

    it("still throws by default on a different pack", () => {
        const r = new Registry();
        r.addShader("dup", stripes);
        expect(() => r.addShader("dup", dots)).toThrow(/already registered to a different pack/);
    });

    it("replaces the pack when { replace: true } is passed", () => {
        const r = new Registry();
        r.addShader("dup", stripes);
        r.addShader("dup", dots, { replace: true });
        expect(r.shader("dup")?.name).toBe("Dots");
    });

    it("only enforces the MAX_SHADERS ceiling for a genuinely new key", () => {
        const r = new Registry();
        for (let i = 0; i < Registry.MAX_SHADERS; i++) {
            r.addShader(`s${i}`, { scope: "fill" as const, name: `s${i}`, source: "fn fill(in: FillIn) -> vec4f { return vec4f(1.0); }" });
        }
        // The registry is full — replacing an existing key still works…
        expect(() => r.addShader("s0", dots, { replace: true })).not.toThrow();
        // …but a brand new one doesn't.
        expect(() => r.addShader("new", dots)).toThrow(/shader ceiling is reached/);
    });
});

describe("Registry.addEase", () => {
    const bounce = (t: number) => t * t;
    const wobble = (t: number) => 1 - (1 - t) * (1 - t);

    it("registers under a key and reads back", () => {
        const r = new Registry();
        r.addEase("bounce", bounce);
        expect(r.ease("bounce")).toBe(bounce);
        expect(r.ease("nope")).toBeUndefined();
    });

    it("lists every registered key, sorted", () => {
        const r = new Registry();
        r.addEase("wobble", wobble);
        r.addEase("bounce", bounce);
        expect(r.easeKeys()).toEqual(["bounce", "wobble"]);
    });

    it("is a no-op re-registering the same function, throws for a different one", () => {
        const r = new Registry();
        r.addEase("dup", bounce);
        expect(() => r.addEase("dup", bounce)).not.toThrow();
        expect(() => r.addEase("dup", wobble)).toThrow(/already registered to a different function/);
    });

    it("seeds from RegistryOptions.eases", () => {
        const r = new Registry({ eases: { bounce } });
        expect(r.ease("bounce")).toBe(bounce);
    });
});

describe("Registry.addNodeFromSource", () => {
    // The `compile` stub is the identity function: these sources are already
    // plain JS (CommonJS, `require`), each default-exporting a component, so
    // there is nothing for a real compiler to do.
    const sdk = { component2d };

    const blobSource = `
        const { component2d } = require("@motionscript/sdk");
        module.exports.default = component2d({ key: "dynamic-blob" });
    `;

    function dynamicRegistry(config: Partial<{ modules: Record<string, unknown> }> = {}) {
        return new Registry({
            dynamicNodes: { sdk, modules: config.modules, compile: async (source) => source },
        });
    }

    /** The node class a registered source's component generated. */
    const classOf = (component: NodeConstructor) => (component as unknown as { node: NodeConstructor }).node;

    it("compiles and registers a live component that satisfies instanceof against the injected sdk", async () => {
        const r = dynamicRegistry();
        const Blob = await r.addNodeFromSource(blobSource);
        expect(r.hasNode("dynamic-blob")).toBe(true);
        expect(new Blob()).toBeInstanceOf(Node2D);
    });

    it("denies DOM/network/storage globals — they read as undefined", async () => {
        const r = dynamicRegistry();
        const source = `
            const { component2d } = require("motion-script");
            const Probe = component2d({ key: "dynamic-probe" });
            Probe.seen = { window: typeof window, fetch: typeof fetch, document: typeof document };
            module.exports.default = Probe;
        `;
        const Probe = await r.addNodeFromSource(source);
        expect((Probe as unknown as { seen: Record<string, string> }).seen).toEqual({
            window: "undefined", fetch: "undefined", document: "undefined",
        });
    });

    it("a script may declare its own top-level binding under a denied name", async () => {
        const r = dynamicRegistry();
        const source = `
            const { component2d } = require("@motionscript/sdk");
            const frames = 30;
            let history = [frames];
            class Request {}
            const Reel = component2d({ key: "dynamic-reel" });
            Reel.seen = { frames, history, Request: typeof Request, fetch: typeof fetch };
            module.exports.default = Reel;
        `;
        const Reel = await r.addNodeFromSource(source);
        expect((Reel as unknown as { seen: Record<string, unknown> }).seen).toEqual({
            frames: 30, history: [30], Request: "function", fetch: "undefined",
        });
    });

    // The script body sits in a function of its own, so a stray `}` can close it.
    // What runs after that is still in the scope that binds the denied names.
    it("code that closes the script's own scope early still reads denied globals as undefined", async () => {
        const r = dynamicRegistry();
        const source = `
            }, (exports.seen = { fetch: typeof fetch, Request: typeof Request }), function () {
            const { component2d } = require("@motionscript/sdk");
            const Escape = component2d({ key: "dynamic-escape" });
            Escape.seen = exports.seen;
            module.exports.default = Escape;
        `;
        const Escape = await r.addNodeFromSource(source);
        expect((Escape as unknown as { seen: Record<string, string> }).seen).toEqual({
            fetch: "undefined", Request: "undefined",
        });
    });

    it("require() rejects any specifier other than the sdk's own", async () => {
        const r = dynamicRegistry();
        await expect(r.addNodeFromSource(`require("fs"); module.exports.default = class {};`))
            .rejects.toThrow(/"fs" isn't available/);
        await expect(r.addNodeFromSource(`require("./sibling"); module.exports.default = class {};`))
            .rejects.toThrow(/"\.\/sibling" isn't available/);
    });

    // The scoped name is the published one; the dashed and no-dash spellings are
    // the package's earlier names, and a script written against either still works.
    it.each(["@motionscript/sdk", "motion-script", "motionscript"])("require(%j) returns exactly the injected sdk object", async (specifier) => {
        const r = dynamicRegistry();
        const source = `
            const sdkBarrel = require("${specifier}");
            const Tag = sdkBarrel.component2d({ key: "dynamic-tag" });
            Tag.sdkIsInjected = sdkBarrel;
            module.exports.default = Tag;
        `;
        const Tag = await r.addNodeFromSource(source);
        expect((Tag as unknown as { sdkIsInjected: unknown }).sdkIsInjected).toBe(sdk);
    });

    it("rejects when dynamicNodes was never configured", async () => {
        const r = new Registry();
        await expect(r.addNodeFromSource(blobSource)).rejects.toThrow(/needs `dynamicNodes/);
    });

    it("rejects a script with no export default, a non-function default, or a class that is no component", async () => {
        const r = dynamicRegistry();
        await expect(r.addNodeFromSource(`module.exports.default = undefined;`))
            .rejects.toThrow(/must `export default` a component/);
        await expect(r.addNodeFromSource(`module.exports.default = 42;`))
            .rejects.toThrow(/must `export default` a component/);
        await expect(r.addNodeFromSource(`module.exports.default = class {};`))
            .rejects.toThrow(/must `export default` a component/);
    });

    it("re-registering the same key with a different component throws without { replace: true }, succeeds with it", async () => {
        const r = dynamicRegistry();
        await r.addNodeFromSource(blobSource);
        const jellySource = `
            const { component2d } = require("motion-script");
            module.exports.default = component2d({ key: "dynamic-blob" });
        `;
        await expect(r.addNodeFromSource(jellySource)).rejects.toThrow(/already registered to a different class/);
        const Jelly = await r.addNodeFromSource(jellySource, { replace: true });
        expect(r.node("dynamic-blob")?.ctor).toBe(classOf(Jelly));
    });

    it("has no JSX runtime to require: a component is written with calls", async () => {
        for (const specifier of ["@motionscript/sdk/jsx-runtime", "motionscript/jsx-runtime", "motion-script/jsx-runtime"]) {
            await expect(dynamicRegistry().addNodeFromSource(`require("${specifier}");`))
                .rejects.toThrow(/isn't available/);
        }
    });

    // A forked component imports what the sdk leaves out — its package's kit,
    // the sdk's component subpath — and the host hands those over by name.
    it("require() returns a host-supplied module by its exact specifier", async () => {
        const kit = { layOutBars: () => [] };
        const component = { seekable: true };
        const r = dynamicRegistry({ modules: { "@motionscript/sdk/component": component, "@motionscript/charts/kit": kit } });
        const source = `
            const { component2d } = require("@motionscript/sdk");
            const Forked = component2d({ key: "dynamic-forked" });
            Forked.linked = [require("@motionscript/sdk/component"), require("@motionscript/charts/kit")];
            module.exports.default = Forked;
        `;
        const Forked = await r.addNodeFromSource(source);
        const [linkedComponent, linkedKit] = (Forked as unknown as { linked: unknown[] }).linked;
        expect(linkedComponent).toBe(component);
        expect(linkedKit).toBe(kit);
        expect(new Forked()).toBeInstanceOf(Node2D);
    });

    it("an unknown specifier still throws, naming what can be required and where more comes from", async () => {
        const unknown = `require("@motionscript/plot/kit"); module.exports.default = class {};`;
        await expect(dynamicRegistry().addNodeFromSource(unknown))
            .rejects.toThrow(/"@motionscript\/plot\/kit" isn't available.*"@motionscript\/sdk";.*dynamicNodes\.modules/);

        const r = dynamicRegistry({ modules: { "@motionscript/sdk/component": {} } });
        await expect(r.addNodeFromSource(unknown))
            .rejects.toThrow(/"@motionscript\/plot\/kit" isn't available.*"@motionscript\/sdk", "@motionscript\/sdk\/component"/);
        // Own keys only: the map's prototype is not a way out to `Object`.
        await expect(r.addNodeFromSource(`require("constructor"); module.exports.default = class {};`))
            .rejects.toThrow(/"constructor" isn't available/);
    });

    it("the built-in specifiers win over a module of the same name", async () => {
        const decoy = { decoy: true };
        const r = dynamicRegistry({
            modules: { "@motionscript/sdk": decoy, "motionscript": decoy, "motion-script": decoy },
        });
        const source = `
            const sdk = require("@motionscript/sdk");
            const Tag = sdk.component2d({ key: "dynamic-tag" });
            Tag.linked = [sdk, require("motionscript"), require("motion-script")];
            module.exports.default = Tag;
        `;
        const Tag = await r.addNodeFromSource(source);
        expect((Tag as unknown as { linked: unknown[] }).linked).toEqual([sdk, sdk, sdk]);
    });
});
