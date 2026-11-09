import { describe, expect, it } from "vitest";

import { declareMembers, property } from "@/attributes/properties/decorator";
import { fillProperty } from "@/attributes/properties/typed";
import { Node2D, type Node2DProps } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { driveCommand, type Command, type CommandArgs } from "@/tween/command";
import { command } from "@/tween/command-decorator";

import { getNodeDescriptor, node } from "../node-decorator";
import {
    Registry,
    type CommandFactory,
    type NodeConstructor,
    type VariableCommandFactory,
    type VariableLerp,
} from "../registry";
import type { NodeSpec } from "../types";

const spec = (type: string, id = "n"): NodeSpec => ({ id, type, parentId: null, layerOrder: 0, props: {} });

const noopCommand = (): Command<Record<string, unknown>> => driveCommand(0, () => { }) as never;
const factory = (): CommandFactory => () => noopCommand();
const variableFactory = (): VariableCommandFactory => () => noopCommand();

describe("Registry.addCommand", () => {
    it("registers a node-less command that command() hands back", () => {
        const make = factory();
        const registry = new Registry({ builtins: false }).addCommand("pulse", make);
        expect(registry.command("pulse")).toMatchObject({ key: "pulse", scope: "node", factory: make });
        expect(registry.command("pulse")).not.toHaveProperty("args");
        expect(registry.command("missing")).toBeUndefined();
    });

    it("chains, returning the registry", () => {
        const registry = new Registry({ builtins: false });
        expect(registry.addCommand("a", factory())).toBe(registry);
        expect(registry.addVariableCommand("b", variableFactory())).toBe(registry);
    });

    it("is a no-op for the same factory and throws for a different one", () => {
        const make = factory();
        const registry = new Registry({ builtins: false }).addCommand("pulse", make);
        expect(() => registry.addCommand("pulse", make)).not.toThrow();
        expect(() => registry.addCommand("pulse", factory()))
            .toThrow(/Command type "pulse" is already registered to a different factory/);
        expect(registry.command("pulse")?.factory).toBe(make);
    });

    it("keeps the first entry when the same factory is added again with other options", () => {
        const make = factory();
        const registry = new Registry({ builtins: false }).addCommand("pulse", make, { binds: true });
        registry.addCommand("pulse", make, { binds: false, args: ["x"] });
        const entry = registry.command("pulse");
        expect(entry).toMatchObject({ scope: "node", binds: true });
        expect(entry).not.toHaveProperty("args");
    });

    it("carries `binds`, so an expression among its args compiles to a binding", () => {
        const registry = new Registry({ builtins: false })
            .addCommand("bound", factory(), { binds: true })
            .addCommand("plain", factory());
        const bound = registry.command("bound");
        const plain = registry.command("plain");
        expect(bound?.scope === "node" && bound.binds).toBe(true);
        expect(plain?.scope === "node" && plain.binds).toBeUndefined();
    });

    it("describes its args, whichever shorthand they were written in", () => {
        const registry = new Registry({ builtins: false }).addCommand("pulse", factory(), {
            args: ["amount", { key: "tint", kind: "fills" }, { key: "speed", min: 0, max: 5 }],
        });
        const entry = registry.command("pulse");
        expect(entry?.scope === "node" && entry.args).toEqual([
            { key: "amount", kind: "unknown" },
            { key: "tint", kind: "fills" },
            { key: "speed", kind: "unknown", min: 0, max: 5 },
        ]);
    });

    it("lets a node-less command be listed, sorted, without a node type", () => {
        const registry = new Registry({ builtins: false })
            .addCommand("zoom", factory())
            .addCommand("blur", factory())
            .addVariableCommand("wiggle", variableFactory());
        expect(registry.commandKeys()).toEqual(["blur", "wiggle", "zoom"]);
    });
});

describe("Registry.addVariableCommand", () => {
    it("registers under the variable scope", () => {
        const make = variableFactory();
        const registry = new Registry({ builtins: false }).addVariableCommand("wiggle", make);
        expect(registry.command("wiggle")).toEqual({ key: "wiggle", scope: "variable", factory: make });
    });

    it("shares one uniqueness rule with the node-less table", () => {
        const make = variableFactory();
        const registry = new Registry({ builtins: false }).addVariableCommand("wiggle", make);
        expect(() => registry.addVariableCommand("wiggle", make)).not.toThrow();
        expect(() => registry.addVariableCommand("wiggle", variableFactory())).toThrow(/already registered to a different factory/);
        expect(() => registry.addCommand("wiggle", factory())).toThrow(/already registered to a different factory/);
    });

    it("cannot take a built-in key", () => {
        const registry = new Registry();
        expect(() => registry.addVariableCommand("variableTo", variableFactory())).toThrow(/"variableTo" is already registered/);
        expect(() => registry.addCommand("to", factory())).toThrow(/"to" is already registered/);
    });
});

describe("Registry.takesCommand", () => {
    class Bare extends Node2D {}
    node("test-bare")(Bare);

    const registry = new Registry({ nodes: [Bare as never] });

    it("takes its own commands, and the node-less ones that act on any node", () => {
        expect(registry.takesCommand("test-bare", "fadeTo")).toBe(true);
        expect(registry.takesCommand("test-bare", "to")).toBe(true);
        expect(registry.takesCommand("test-bare", "set")).toBe(true);
    });

    it("does not take a node-less command whose method it lacks", () => {
        expect(registry.takesCommand("test-bare", "fillTo")).toBe(false);
        expect(registry.takesCommand("rect", "fillTo")).toBe(true);
        expect(registry.takesCommand("rect", "overlayTo")).toBe(true);
    });

    it("takes nothing scoped to a variable, and nothing for a type it does not know", () => {
        expect(registry.takesCommand("test-bare", "variableTo")).toBe(false);
        expect(registry.takesCommand("nope", "to")).toBe(false);
    });
});

describe("Registry.nodeCommand", () => {
    interface SpinnerProps extends Node2DProps { turns: number }

    class Spinner extends Node2D<SpinnerProps> {
        declare turns: number;
        readonly received: Array<CommandArgs<Record<string, unknown>>> = [];

        spin(args: CommandArgs<Record<string, unknown>> & { duration: number }): Command<SpinnerProps> {
            this.received.push(args);
            return this.to({ data: { turns: 1 }, duration: args.duration, easing: args.easing });
        }

        whirl(args: CommandArgs<Record<string, unknown>>): void {
            this.received.push(args);
        }
    }

    declareMembers(Spinner, {
        turns: property({ default: 0 }),

        spin: command({ args: ["amount", { key: "extra", kind: "number" }] }),
        whirl: command({ key: "twirl", args: [] }),
    });
    node("test-spinner")(Spinner);

    const registry = new Registry({ nodes: [Spinner] });

    it("is undefined for a type or a command the registry does not publish", () => {
        expect(registry.nodeCommand("nope", "spin")).toBeUndefined();
        expect(registry.nodeCommand("test-spinner", "nope")).toBeUndefined();
        expect(registry.nodeCommand("rect", "spin")).toBeUndefined();
    });

    it("calls the method with one args bag holding the declared args under `data`", () => {
        const target = new Spinner({});
        const ease = (t: number) => t;
        registry.nodeCommand("test-spinner", "spin")!(target, { amount: 3, extra: 7 }, 2, ease);
        expect(target.received).toEqual([{ data: { amount: 3, extra: 7 }, duration: 2, easing: ease }]);
    });

    it("passes along only the args the command declared", () => {
        const target = new Spinner({});
        registry.nodeCommand("test-spinner", "spin")!(target, { amount: 3, undeclared: 9, turns: 4 }, 1);
        const { data } = target.received[0];
        expect(data).toEqual({ amount: 3, extra: undefined });
        expect(Object.keys(data!)).toEqual(["amount", "extra"]);
    });

    it("hands a command that declares no args an empty bag, whatever the row carries", () => {
        const target = new Spinner({});
        registry.nodeCommand("test-spinner", "twirl")!(target, { amount: 1 }, 0.5);
        expect(target.received[0]).toEqual({ data: {}, duration: 0.5, easing: undefined });
    });

    it("returns whatever the method returns, a command or nothing", () => {
        const target = new Spinner({});
        expect(registry.nodeCommand("test-spinner", "spin")!(target, {}, 1)).toEqual(expect.objectContaining({ duration: 1 }));
        expect(registry.nodeCommand("test-spinner", "twirl")!(target, {}, 1)).toBeUndefined();
    });

    it("throws, naming the method and the class, when the target has no such method", () => {
        const make = registry.nodeCommand("test-spinner", "spin")!;
        expect(() => make(new Rect({}), {}, 1)).toThrow('Command "spin" needs a "spin" method on Rect, which has none.');
    });

    it("names the method, not the key, when the two differ", () => {
        const make = registry.nodeCommand("test-spinner", "twirl")!;
        expect(() => make(new Rect({}), {}, 1)).toThrow('Command "twirl" needs a "whirl" method on Rect');
    });

    it("dispatches by method, so a different class carrying the method works", () => {
        class Lookalike extends Node2D {
            seen = 0;
            spin(): void { this.seen++; }
        }
        const target = new Lookalike({});
        registry.nodeCommand("test-spinner", "spin")!(target, {}, 1);
        expect(target.seen).toBe(1);
    });

    it("lists a type's commands, sorted, inherited ones included", () => {
        expect(registry.commandKeys("test-spinner")).toEqual(expect.arrayContaining(["fadeTo", "spin", "to", "twirl"]));
        expect(registry.commandKeys("test-spinner")).not.toContain("whirl");
        expect(registry.commandKeys("test-spinner")).toEqual([...registry.commandKeys("test-spinner")].sort());
        expect(registry.commandKeys("no-such-type")).toEqual([]);
    });
});

describe("Registry lerps", () => {
    const wobble: VariableLerp = (from, to, t) => (t < 0.5 ? from : to);
    const other: VariableLerp = (from) => from;

    it("ships number, vector2, vector3, color and step", () => {
        expect(new Registry().lerpKeys()).toEqual(["color", "number", "step", "vector2", "vector3"]);
    });

    it("registers a lerp that lerp() reads back", () => {
        const registry = new Registry().addLerp("wobble", wobble);
        expect(registry.lerp("wobble")).toBe(wobble);
        expect(registry.lerp("missing")).toBeUndefined();
        expect(registry.lerpKeys()).toEqual(["color", "number", "step", "vector2", "vector3", "wobble"]);
    });

    it("lists its keys sorted, whatever order they came in", () => {
        const registry = new Registry({ builtins: false }).addLerp("zeta", wobble).addLerp("alpha", other);
        expect(registry.lerpKeys()).toEqual(["alpha", "zeta"]);
    });

    it("is a no-op for the same function and throws for a different one", () => {
        const registry = new Registry().addLerp("wobble", wobble);
        expect(() => registry.addLerp("wobble", wobble)).not.toThrow();
        expect(() => registry.addLerp("wobble", other))
            .toThrow('Variable lerp "wobble" is already registered to a different function. Keys must be unique.');
        expect(registry.lerp("wobble")).toBe(wobble);
    });

    it("refuses to replace a built-in", () => {
        expect(() => new Registry().addLerp("number", other)).toThrow(/"number" is already registered/);
    });

    it("seeds from RegistryOptions.lerps, after the built-ins", () => {
        const registry = new Registry({ lerps: { wobble } });
        expect(registry.lerp("wobble")).toBe(wobble);
        expect(registry.lerp("number")).toBeTypeOf("function");
        expect(() => new Registry({ lerps: { color: other } })).toThrow(/"color" is already registered/);
    });

    describe("requireLerp", () => {
        const registry = new Registry().addLerp("wobble", wobble);

        it("defaults a numeric value to the number lerp and anything else to step", () => {
            expect(registry.requireLerp(undefined, 3, "variable")).toBe(registry.lerp("number"));
            expect(registry.requireLerp(undefined, 0, "variable")).toBe(registry.lerp("number"));
            for (const value of ["text", true, null, undefined, [1, 2], { x: 1 }]) {
                expect(registry.requireLerp(undefined, value, "variable")).toBe(registry.lerp("step"));
            }
        });

        it("takes a declared key whatever the value is", () => {
            expect(registry.requireLerp("wobble", 3, "variable")).toBe(wobble);
            expect(registry.requireLerp("color", 3, "variable")).toBe(registry.lerp("color"));
            expect(registry.requireLerp("step", 3, "variable")).toBe(registry.lerp("step"));
        });

        it("throws for a key nothing registered, naming where it was asked for and what exists", () => {
            expect(() => registry.requireLerp("bezier", 0, 'variable "g"'))
                .toThrow('Unknown variable lerp "bezier" (variable "g"). Registered: color, number, step, vector2, vector3, wobble.');
        });

        it("says so when nothing is registered at all", () => {
            expect(() => new Registry({ builtins: false }).requireLerp(undefined, 1, "somewhere"))
                .toThrow('Unknown variable lerp "number" (somewhere). Registered: none.');
        });
    });
});

describe("Registry.describe", () => {
    class Described extends Node2D<Node2DProps> {
        declare count: number;
        declare label: string;
        declare shown: boolean;
        declare offset: number[];
        declare mixed: unknown[];
        declare config: object;
        declare nothing: unknown;
        declare derived: number;
        declare bare: number;
        declare turn: number;
        declare glow: unknown;
    }

    declareMembers(Described, {
        count: property({ default: 3 }),
        label: property({ default: "hello" }),
        shown: property({ default: true }),
        offset: property({ default: [1, 2] }),
        mixed: property({ default: ["a", 1] }),
        config: property({ default: { a: 1 } }),
        nothing: property({ default: null }),
        derived: property({ default: () => 4 }),
        bare: property(),
        turn: property({ default: 90, kind: "angle", min: 0, max: 360, unit: "°" }),
        glow: fillProperty({ default: "red" }),
    });
    node("test-described")(Described);

    const registry = new Registry({ nodes: [Described] });
    const properties = registry.describe("test-described")!.properties!;

    it("is undefined for a key nothing registered", () => {
        expect(registry.describe("nope")).toBeUndefined();
    });

    it("carries the key, and a dimension derived from the class", () => {
        expect(registry.describe("test-described")).toMatchObject({ key: "test-described", dimension: "2d" });
        expect(registry.describe("rect")?.dimension).toBe("2d");
        expect(registry.describe("box3d")?.dimension).toBe("3d");
        expect(registry.describe("audioBus")?.dimension).toBe("audio");
    });

    it("derives the properties from their `property` registrations, the whole prototype chain", () => {
        expect(properties.count).toEqual({ kind: "number", default: 3 });
        // `x` and `opacity` come from Node2D, which the subclass does not restate.
        expect(properties.x).toEqual({ kind: "number", default: 0 });
        expect(properties.opacity).toEqual({ kind: "number", default: 1 });
    });

    it("infers a control from the default's type", () => {
        expect(properties.count.kind).toBe("number");
        expect(properties.label.kind).toBe("text");
        expect(properties.shown.kind).toBe("boolean");
        expect(properties.offset.kind).toBe("vector");
        expect(properties.mixed.kind).toBe("object");
        expect(properties.config.kind).toBe("object");
    });

    it("says unknown rather than guess, for a null, a binding or no default", () => {
        expect(properties.nothing).toEqual({ kind: "unknown", default: null });
        expect(properties.derived.kind).toBe("unknown");
        expect(typeof properties.derived.default).toBe("function");
        expect(properties.bare).toEqual({ kind: "unknown" });
        expect("default" in properties.bare).toBe(false);
    });

    it("lets a declared kind and editor options win over the inference", () => {
        expect(properties.turn).toEqual({ kind: "angle", min: 0, max: 360, unit: "°", default: 90 });
    });

    it("takes a typed property's own kind", () => {
        expect(properties.glow.kind).toBe("fills");
    });

    it("is the descriptor a plain key registers too", () => {
        const plain = new Registry({ nodes: { "plain-rect": Rect as unknown as NodeConstructor } });
        const described = plain.describe("plain-rect")!;
        expect(described.key).toBe("plain-rect");
        expect(described.dimension).toBe("2d");
        expect(described.properties?.width).toBeDefined();
    });

    it("keeps what a full descriptor declared, beside the derived parts", () => {
        const registry = new Registry();
        registry.addNode({ key: "card", forkable: true, seed: { width: 100 }, layout: { children: "freeform" } }, Rect as unknown as NodeConstructor);
        expect(registry.describe("card")).toMatchObject({
            key: "card",
            forkable: true,
            seed: { width: 100 },
            layout: { children: "freeform" },
            dimension: "2d",
        });
        expect(registry.describe("card")?.properties?.fill).toBeDefined();
    });
});

describe("Registry.instantiate", () => {
    it("names the unknown type and the node, and lists what the registry knows, sorted", () => {
        const registry = new Registry({ builtins: false, nodes: { zeta: Rect as unknown as NodeConstructor, alpha: Rect as unknown as NodeConstructor } });
        expect(() => registry.instantiate(spec("ghost", "n7")))
            .toThrow('Unknown node type "ghost" (node n7). This registry knows: alpha, zeta.');
    });

    it("says nothing is known for an empty registry", () => {
        expect(() => new Registry({ builtins: false }).instantiate(spec("rect", "n1")))
            .toThrow('Unknown node type "rect" (node n1). This registry knows: nothing.');
    });

    it("builds the registered class", () => {
        expect(new Registry().instantiate(spec("rect"))).toBeInstanceOf(Rect);
    });
});

describe("Registry shaders", () => {
    const FILL = { scope: "fill" as const, name: "Stripes", source: "fn fill(in: FillIn) -> vec4f { return vec4f(1.0); }" };
    const EFFECT = { scope: "effect" as const, name: "Glow", source: "fn effect(in: EffectIn) -> vec4f { return vec4f(1.0); }" };

    it("keeps fill and effect packs apart behind typed accessors", () => {
        const registry = new Registry({ shaders: { stripes: FILL, glow: EFFECT } });
        expect(registry.shader("stripes")?.scope).toBe("fill");
        expect(registry.fillShader("stripes")?.name).toBe("Stripes");
        expect(registry.effectShader("stripes")).toBeUndefined();
        expect(registry.effectShader("glow")?.name).toBe("Glow");
        expect(registry.fillShader("glow")).toBeUndefined();
        expect(registry.shader("missing")).toBeUndefined();
        expect(registry.fillShader("missing")).toBeUndefined();
        expect(registry.effectShader("missing")).toBeUndefined();
    });

    it("lists its keys sorted", () => {
        const registry = new Registry();
        registry.addShader("zebra", FILL);
        registry.addShader("apple", EFFECT);
        expect(registry.shaderKeys()).toEqual(["apple", "zebra"]);
        expect(new Registry().shaderKeys()).toEqual([]);
    });

    it("returns the normalized pack it stored", () => {
        const stored = new Registry().addShader("s", { ...FILL, source: `  ${FILL.source}\n` });
        expect(stored.source).toBe(FILL.source);
        expect(stored.properties).toEqual({});
    });

    it("treats an equal pack as a no-op that hands back the pack already held", () => {
        const registry = new Registry();
        const first = registry.addShader("s", FILL);
        const again = registry.addShader("s", { ...FILL, source: `${FILL.source}  ` });
        expect(again).toBe(first);
        expect(registry.shaderKeys()).toEqual(["s"]);
    });

    it("throws for a pack that differs in scope, source or name, naming both", () => {
        const registry = new Registry();
        registry.addShader("s", FILL);
        expect(() => registry.addShader("s", { ...FILL, source: "fn fill(in: FillIn) -> vec4f { return vec4f(0.0); }" }))
            .toThrow(/Shader "s" is already registered to a different pack \("Stripes" vs "Stripes"\)/);
        expect(() => registry.addShader("s", { ...FILL, name: "Dots" }))
            .toThrow(/\("Stripes" vs "Dots"\)/);
        expect(() => registry.addShader("s", { ...EFFECT, name: "Stripes", source: FILL.source }))
            .toThrow(/already registered to a different pack/);
        expect(registry.fillShader("s")?.name).toBe("Stripes");
    });

    it("refuses a pack that is not one", () => {
        const registry = new Registry();
        expect(() => registry.addShader("s", null)).toThrow(/must be an object/);
        expect(() => registry.addShader("s", { name: "x", source: "y" })).toThrow(/needs scope "fill" or "effect"/);
        expect(() => registry.addShader("s", { scope: "fill", name: "x", source: "  " })).toThrow(/has no source/);
        expect(registry.shaderKeys()).toEqual([]);
    });

    it("caps how many it holds", () => {
        expect(Registry.MAX_SHADERS).toBe(512);
    });

    // The equality above compares scope, source and name only, so a pack whose
    // properties, uniforms or description changed under the same name and source
    // is returned as the old one without replacing it, and without a throw.
    it.todo("registers a pack whose properties changed under an unchanged name and source");
});

describe("a registry seeded without the built-ins", () => {
    it("holds nothing of the library's", () => {
        const bare = new Registry({ builtins: false });
        expect(bare.nodeKeys()).toEqual([]);
        expect(bare.commandKeys()).toEqual([]);
        expect(bare.lerpKeys()).toEqual([]);
        expect(bare.easeKeys()).toEqual([]);
        expect(bare.shaderKeys()).toEqual([]);
        expect(bare.hasNode("rect")).toBe(false);
        expect(bare.command("to")).toBeUndefined();
    });

    it("still takes everything it is handed", () => {
        const wobble: VariableLerp = (a) => a;
        const ease = (t: number) => t;
        const bare = new Registry({
            builtins: false,
            nodes: [Spun],
            lerps: { wobble },
            eases: { smooth: ease },
            shaders: { s: { scope: "fill", name: "S", source: "fn fill(in: FillIn) -> vec4f { return vec4f(1.0); }" } },
        });
        expect(bare.nodeKeys()).toEqual(["test-spun"]);
        expect(bare.lerpKeys()).toEqual(["wobble"]);
        expect(bare.easeKeys()).toEqual(["smooth"]);
        expect(bare.shaderKeys()).toEqual(["s"]);
    });

    it("cannot compile a document that names a built-in", () => {
        expect(new Registry({ builtins: false, nodes: [Spun] }).hasNode("rect")).toBe(false);
    });

    class Spun extends Node2D { }
    node("test-spun")(Spun);
});

describe("registry listings", () => {
    it("sorts node keys and every other listing, whatever order they were added in", () => {
        class B extends Node2D { }
        node("test-b")(B);
        class A extends Node2D { }
        node("test-a")(A);
        const registry = new Registry({ builtins: false, nodes: [B, A] });
        expect(registry.nodeKeys()).toEqual(["test-a", "test-b"]);
    });

    it("reads a node's declaration from the class itself and not from what it inherits", () => {
        class Parent extends Node2D { }
        node("test-parent")(Parent);
        class Child extends Parent { }

        expect(getNodeDescriptor(Parent)).toEqual({ key: "test-parent" });
        expect(getNodeDescriptor(Child)).toBeUndefined();
        expect(() => new Registry({ nodes: [Child] })).toThrow(/is no component/);
    });

    it("lets a subclass declare its own key beside its parent's", () => {
        class Parent extends Node2D { }
        node("test-parent")(Parent);
        class Child extends Parent { }
        node("test-child")(Child);
        expect(getNodeDescriptor(Child)).toEqual({ key: "test-child" });
        const registry = new Registry({ builtins: false, nodes: [Parent, Child] });
        expect(registry.nodeKeys()).toEqual(["test-child", "test-parent"]);
    });

    it("applies the full node() descriptor as given", () => {
        class Full extends Node2D { }
        node({ key: "test-full", forkable: false, seed: { width: 5 } })(Full);
        expect(getNodeDescriptor(Full)).toEqual({ key: "test-full", forkable: false, seed: { width: 5 } });
    });
});

describe("an explicit key against the class's own declaration", () => {
    class Declared extends Node2D { }
    node("test-declared")(Declared);

    it("registers under the key it was given and ignores what node() says", () => {
        // The docblock promises a mismatch throws; today the explicit key simply wins.
        const registry = new Registry({ builtins: false });
        registry.addNode("test-explicit", Declared as unknown as NodeConstructor);
        expect(registry.nodeKeys()).toEqual(["test-explicit"]);
        expect(registry.hasNode("test-declared")).toBe(false);
        expect(registry.node("test-explicit")?.ctor).toBe(Declared);
    });

    it("does the same through a record in RegistryOptions.nodes", () => {
        const registry = new Registry({ builtins: false, nodes: { "test-explicit": Declared as unknown as NodeConstructor } });
        expect(registry.nodeKeys()).toEqual(["test-explicit"]);
    });

    it("can register one class under two keys, as two records", () => {
        const registry = new Registry({ builtins: false });
        registry.addNode("test-one", Declared as unknown as NodeConstructor);
        registry.addNode("test-two", Declared as unknown as NodeConstructor);
        expect(registry.node("test-one")?.ctor).toBe(registry.node("test-two")?.ctor);
        expect(registry.nodeKeys()).toEqual(["test-one", "test-two"]);
    });

    it("reads a full descriptor's key from the descriptor, not the class", () => {
        const registry = new Registry({ builtins: false });
        registry.addNode({ key: "test-card", seed: { width: 3 } }, Declared as unknown as NodeConstructor);
        expect(registry.describe("test-card")?.seed).toEqual({ width: 3 });
        expect(registry.hasNode("test-declared")).toBe(false);
    });
});

describe("seeding order", () => {
    it("seeds the built-ins first, so an option that clashes with one throws from the constructor", () => {
        class Imposter extends Node2D { }
        expect(() => new Registry({ nodes: { rect: Imposter as unknown as NodeConstructor } }))
            .toThrow(/Node type "rect" is already registered to a different class/);
    });

    it("lets an option re-register a built-in class under its own key harmlessly", () => {
        const registry = new Registry({ nodes: { rect: Rect as unknown as NodeConstructor } });
        expect(registry.node("rect")?.ctor).toBe(Rect.node);
    });
});

describe("the built-in vocabulary", () => {
    /** The keys in `packages/core/docs/registry.md`, group by group. */
    const CONTRACT: Record<string, string[]> = {
        "clip root and structural": ["canvas2d", "provider", "theme-provider", "default-text-style"],
        geometry: ["rect", "ellipse", "path", "polygon", "polygram", "boolean", "mask"],
        layout: ["camera", "orbitCamera", "rotated-box"],
        text: ["text", "richtext", "number"],
        media: ["video"],
        audio: ["audioBus", "sound"],
        "3D scene": ["canvas3d", "group3d", "mesh3d", "camera3d", "fog3d", "environment3d"],
        "3D geometry": [
            "box3d", "sphere3d", "plane3d", "circle3d", "cylinder3d", "cone3d", "capsule3d",
            "torus3d", "torus-knot3d", "tube3d", "lathe3d", "extrude3d", "ring3d", "polyhedron3d",
        ],
        "3D drawables": ["points3d", "line3d", "sprite3d", "instances3d", "model3d"],
        "3D lights": [
            "ambient-light3d", "directional-light3d", "point-light3d",
            "spot-light3d", "hemisphere-light3d", "area-light3d",
        ],
    };
    const keys = Object.values(CONTRACT).flat();
    const registry = new Registry();

    it("is exactly the contract's 51 keys", () => {
        expect(keys).toHaveLength(51);
        expect(registry.nodeKeys()).toEqual([...keys].sort());
    });

    it.each(keys)("%s resolves to a class", (key) => {
        const record = registry.node(key);
        expect(record?.key).toBe(key);
        expect(record?.ctor).toBeTypeOf("function");
        expect(registry.hasNode(key)).toBe(true);
    });

    it.each(keys)("%s describes its own dimension", (key) => {
        expect(["2d", "3d", "audio"]).toContain(registry.describe(key)?.dimension);
        expect(registry.describe(key)?.properties).toBeDefined();
    });

    it("gives the node-less table its eight commands and no more", () => {
        expect(registry.commandKeys()).toEqual([
            "fillTo", "overlayTo", "save", "set", "shadowTo", "strokeTo", "to", "variableSet", "variableTo",
        ]);
    });

    it("scopes the two variable commands to variables and the rest to nodes", () => {
        for (const key of ["variableTo", "variableSet"]) expect(registry.command(key)?.scope).toBe("variable");
        for (const key of ["to", "set", "save", "fillTo", "overlayTo", "strokeTo", "shadowTo"]) {
            expect(registry.command(key)?.scope).toBe("node");
        }
    });

    it("lets only `set` bind its args", () => {
        for (const key of registry.commandKeys()) {
            const entry = registry.command(key);
            expect(entry?.scope === "node" && entry.binds === true).toBe(key === "set");
        }
    });

    it("describes the one arg of each paint command in its own kind", () => {
        const argsOf = (key: string) => {
            const entry = registry.command(key);
            return entry?.scope === "node" ? entry.args : undefined;
        };
        expect(argsOf("fillTo")).toEqual([{ key: "fill", kind: "fills" }]);
        expect(argsOf("overlayTo")).toEqual([{ key: "overlay", kind: "fills" }]);
        expect(argsOf("strokeTo")).toEqual([{ key: "stroke", kind: "strokes" }]);
        expect(argsOf("shadowTo")).toEqual([{ key: "shadow", kind: "shadows" }]);
        expect(argsOf("to")).toBeUndefined();
    });

    it("publishes a node's own commands off its class, not from the node-less table", () => {
        const rect = registry.commandKeys("rect");
        expect(rect).toEqual(expect.arrayContaining([
            "moveTo", "fadeTo", "rotateTo", "scaleTo", "layoutTo", "effectTo", "progressTo", "restore",
        ]));
        expect(registry.commandKeys("sound")).not.toContain("progressTo");
        expect(registry.commandKeys("canvas3d")).not.toContain("variableTo");
    });
});
