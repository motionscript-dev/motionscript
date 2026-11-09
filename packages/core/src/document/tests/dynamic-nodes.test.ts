import { describe, expect, it } from "vitest";

import { Node2D } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { runtimeScope } from "@/runtime/document.fixtures";
import { Engine, type EnginePlatform } from "@/runtime/engine";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";

import { DENIED_GLOBALS } from "../deny-globals";
import { node } from "../node-decorator";
import { Registry, type DynamicNodeConfig, type NodeConstructor } from "../registry";
import type { CompositionDocument } from "../types";

/**
 * Nodes registered from source. The compile step is the identity, so the sources
 * below are already CommonJS, each default-exporting a component. The browser
 * package's own suite drives the real compiler.
 */
const sdk = { component2d, Types };

function dynamicRegistry(over: Partial<DynamicNodeConfig> = {}): Registry {
    return new Registry({ dynamicNodes: { sdk, compile: async (source) => source, ...over } });
}

/** An engine over a platform that offers nothing a registry test touches. */
function engineWith(dynamicNodes: DynamicNodeConfig | null = { sdk, compile: async (source) => source }): Engine {
    const platform = { createExporter: () => ({}) } as unknown as EnginePlatform;
    return new Engine(platform, dynamicNodes ? { dynamicNodes } : {});
}

type Static = Record<string, unknown>;
const statics = (ctor: NodeConstructor): Static => ctor as unknown as Static;

/** A source defining `key` with the usual shell around `body`, run beside the component. */
function nodeSource(key: string, body = ""): string {
    return `
        const { component2d } = require("@motionscript/sdk");
        const Source = component2d({ key: "${key}" });
        ${body}
        module.exports.default = Source;
    `;
}

/** The node class a registered source's component generated. */
const classOf = (component: NodeConstructor) => (component as unknown as { node: NodeConstructor }).node;

describe("a registered source component", () => {
    const source = `
        const { component2d, Types } = require("@motionscript/sdk");
        const Spinner = component2d({
            key: "dyn-spinner",
            state: { level: Types.number(5, { min: 0, max: 10 }) },
            children: () => { Spinner.constructed += 1; return []; },
            commands: { bump: { args: { amount: Types.number(0) }, run: (timeline) => timeline.tween({ level: timeline.args.amount }) } },
        });
        Spinner.constructed = 0;
        module.exports.default = Spinner;
    `;

    it("has its commands, dimension and properties without ever being constructed", async () => {
        const registry = dynamicRegistry();
        const Spinner = await registry.addNodeFromSource(source);

        expect(statics(Spinner).constructed).toBe(0);
        expect(registry.commandKeys("dyn-spinner")).toEqual(expect.arrayContaining(["bump", "fadeTo", "to"]));
        expect(registry.node("dyn-spinner")?.commands.get("bump")).toMatchObject({
            method: "bump",
            args: [{ key: "amount", kind: "number", default: 0 }],
        });
        const described = registry.describe("dyn-spinner");
        expect(described).toMatchObject({ key: "dyn-spinner", dimension: "2d" });
        expect(described?.properties?.level).toEqual({ kind: "number", default: 5, min: 0, max: 10 });
        expect(described?.properties?.x).toEqual({ kind: "number", default: 0 });
        expect(statics(Spinner).constructed).toBe(0);
    });

    it("is built by instantiate with the row's id and key, and its own default", async () => {
        const registry = dynamicRegistry();
        const Spinner = await registry.addNodeFromSource(source);

        const built = registry.instantiate({ id: "s1", key: "spin", type: "dyn-spinner", parentId: null, layerOrder: 0, props: { x: 3 } });
        expect(built).toBeInstanceOf(Spinner);
        expect(built).toBeInstanceOf(Node2D);
        expect(built.id).toBe("s1");
        expect(built.key).toBe("spin");
        expect((built as unknown as { level: number; x: number }).level).toBe(5);
        expect((built as unknown as { x: number }).x).toBe(3);
        expect(statics(Spinner).constructed).toBe(1);
    });

    it("answers a document command by the name of its command", async () => {
        const registry = dynamicRegistry();
        await registry.addNodeFromSource(source);
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [{ id: "s", type: "dyn-spinner", parentId: null, layerOrder: 0, props: { width: 10, height: 10 } }],
            commands: [{ id: "b", type: "bump", targetId: "s", at: 0, duration: 1, args: { amount: 9, ignored: 1 } }],
        };
        const clip = new TimelineClip(doc, runtimeScope({ registry }));
        clip.build();
        const level = () => (clip.timeline.liveNode("s") as unknown as { level: number }).level;

        clip.seek(0);
        expect(level()).toBe(5);
        clip.seek(0.5);
        expect(level()).toBe(7);
        clip.seek(1);
        expect(level()).toBe(9);
    });
});

describe("a script's module scope", () => {
    it("sees `this` as undefined at the top level", async () => {
        const Probe = await dynamicRegistry().addNodeFromSource(nodeSource("dyn-this", "Source.thisType = typeof this;"));
        expect(statics(Probe).thisType).toBe("undefined");
    });

    it("gets a fresh `module.exports` for every registration", async () => {
        const registry = dynamicRegistry();
        const body = "Source.before = typeof exports.counter; exports.counter = 1; Source.exportsObject = exports;";
        const first = await registry.addNodeFromSource(nodeSource("dyn-first", body));
        const second = await registry.addNodeFromSource(nodeSource("dyn-second", body));

        expect(statics(first).before).toBe("undefined");
        expect(statics(second).before).toBe("undefined");
        expect(statics(first).exportsObject).not.toBe(statics(second).exportsObject);
    });

    it("accepts a reassigned `module.exports`", async () => {
        const registry = dynamicRegistry();
        const Replaced = await registry.addNodeFromSource(`
            const { component2d } = require("@motionscript/sdk");
            module.exports = { default: component2d({ key: "dyn-reassigned" }) };
        `);
        expect(registry.node("dyn-reassigned")?.ctor).toBe(classOf(Replaced));
    });

    it("takes a default export from `exports` as well as `module.exports`", async () => {
        const registry = dynamicRegistry();
        const Exported = await registry.addNodeFromSource(`
            const { component2d } = require("@motionscript/sdk");
            exports.default = component2d({ key: "dyn-exports" });
        `);
        expect(registry.node("dyn-exports")?.ctor).toBe(classOf(Exported));
    });
});

describe("what a script is denied", () => {
    it.each(DENIED_GLOBALS)("reads %s as undefined", async (name) => {
        const registry = dynamicRegistry();
        const Probe = await registry.addNodeFromSource(nodeSource(`dyn-deny-${name}`, `Source.seen = typeof ${name};`));
        expect(statics(Probe).seen).toBe("undefined");
    });

    it("denies every name the contract lists, and the list is the contract's", () => {
        const contract = [
            "globalThis", "window", "self", "top", "parent", "frames",
            "Function", "importScripts",
            "document", "navigator", "location", "history", "screen", "customElements",
            "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Request", "Response", "Headers",
            "localStorage", "sessionStorage", "indexedDB", "caches", "cookieStore", "crypto",
            "Worker", "SharedWorker", "ServiceWorker", "MessageChannel", "BroadcastChannel", "postMessage",
            "alert", "confirm", "prompt", "open", "print", "Notification",
        ];
        expect([...DENIED_GLOBALS].sort()).toEqual([...contract].sort());
    });

    it("leaves ordinary language globals alone", async () => {
        const Probe = await dynamicRegistry().addNodeFromSource(
            nodeSource("dyn-language", "Source.seen = [typeof Math, typeof JSON, typeof Map, typeof Promise, typeof Symbol];"),
        );
        expect(statics(Probe).seen).toEqual(["object", "object", "function", "function", "function"]);
    });
});

/**
 * Hardening, not a sandbox (see `deny-globals.ts`): these paths stay open, and
 * a test says so, so a change to the boundary is made on purpose.
 */
describe("what a script can still reach", () => {
    it("the real global object, through an indirect eval", async () => {
        const Probe = await dynamicRegistry().addNodeFromSource(nodeSource(
            "dyn-eval",
            'Source.seen = (0, eval)("typeof globalThis"); Source.sameGlobal = (0, eval)("this") === (0, eval)("globalThis");',
        ));
        expect(statics(Probe).seen).toBe("object");
        expect(statics(Probe).sameGlobal).toBe(true);
    });

    it("`Function`, through the constructor chain", async () => {
        const Probe = await dynamicRegistry().addNodeFromSource(nodeSource(
            "dyn-chain",
            'Source.seen = [typeof Function, ({}).constructor.constructor("return typeof globalThis")()];',
        ));
        expect(statics(Probe).seen).toEqual(["undefined", "object"]);
    });

    // A dynamic `import()` is syntax, not a name, so nothing in DENIED_GLOBALS can
    // close it. This runner evaluates test code without an import
    // callback, so a script containing one cannot even be linked here; the
    // reach is observable in a real page, which is the browser suite's.
    it.todo("a dynamic import(), which is syntax and so cannot be denied by name (needs a realm with an import callback)");

    it("the host's own classes, which a script may mutate", async () => {
        class Host { }
        const registry = dynamicRegistry({ sdk: { ...sdk, Host } });
        await registry.addNodeFromSource(nodeSource(
            "dyn-mutate",
            'const { Host } = require("@motionscript/sdk"); Host.mutated = "yes"; Host.prototype.greet = () => "hijacked";',
        ));
        expect((Host as unknown as Static).mutated).toBe("yes");
        expect((new Host() as unknown as { greet(): string }).greet()).toBe("hijacked");
    });
});

describe("what a script may require", () => {
    it("has no JSX runtime: a component is written with calls", async () => {
        const source = (specifier: string) => `require("${specifier}"); module.exports.default = class {};`;
        for (const specifier of ["@motionscript/sdk/jsx-runtime", "@motionscript/sdk/jsx-dev-runtime", "motionscript/jsx-runtime"]) {
            await expect(dynamicRegistry().addNodeFromSource(source(specifier))).rejects.toThrow(/isn't available to a custom node/);
        }
    });

    it("names what is available", async () => {
        const message = await dynamicRegistry().addNodeFromSource('require("fs");').catch((error: Error) => error.message);
        expect(message).toContain('"@motionscript/sdk"');
        expect(message).not.toContain("jsx");
    });

    it("resolves the component subpath only through `modules`", async () => {
        const component = { seekable: true };
        const source = nodeSource("dyn-component", 'Source.component = require("@motionscript/sdk/component");');
        await expect(dynamicRegistry().addNodeFromSource(source))
            .rejects.toThrow(/"@motionscript\/sdk\/component" isn't available to a custom node/);

        const Linked = await dynamicRegistry({ modules: { "@motionscript/sdk/component": component } }).addNodeFromSource(source);
        expect(statics(Linked).component).toBe(component);
    });
});

describe("a failed registration", () => {
    it("rejects with the compiler's own error, unchanged", async () => {
        const failure = new SyntaxError("Unexpected token at line 3");
        const registry = dynamicRegistry({ compile: async () => { throw failure; } });
        await expect(registry.addNodeFromSource("anything")).rejects.toBe(failure);
    });

    it("rejects with a script's own top-level throw, unchanged", async () => {
        const registry = dynamicRegistry();
        const error = await registry.addNodeFromSource('throw new RangeError("script says no");').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RangeError);
        expect((error as Error).message).toBe("script says no");
    });

    it("rejects with a thrown value that is not an Error as it was thrown", async () => {
        const thrown = { code: "E_CUSTOM" };
        const registry = dynamicRegistry();
        await expect(registry.addNodeFromSource("throw { code: 'E_CUSTOM' };")).rejects.toEqual(thrown);
    });

    it("rejects a syntax error in already-compiled text as the engine's own SyntaxError", async () => {
        await expect(dynamicRegistry().addNodeFromSource("class {")).rejects.toBeInstanceOf(SyntaxError);
    });

    it("leaves the registry as it was, whichever stage failed", async () => {
        const registry = dynamicRegistry({ modules: {} });
        await registry.addNodeFromSource(nodeSource("dyn-kept"));
        const before = registry.nodeKeys();

        await expect(registry.addNodeFromSource('throw new Error("boom");')).rejects.toThrow("boom");
        await expect(registry.addNodeFromSource('require("fs");')).rejects.toThrow(/isn't available/);
        await expect(registry.addNodeFromSource("module.exports.default = 42;")).rejects.toThrow(/must `export default`/);
        await expect(registry.addNodeFromSource(nodeSource("dyn-kept"))).rejects.toThrow(/already registered to a different class/);
        expect(registry.nodeKeys()).toEqual(before);
        expect(registry.nodeKeys()).toContain("dyn-kept");
    });

    it("calls the configured compiler once per registration, and needs one to register anything", async () => {
        let compiled = 0;
        const registry = dynamicRegistry({ compile: async (source) => { compiled++; return source; } });
        await registry.addNodeFromSource(nodeSource("dyn-once"));
        expect(compiled).toBe(1);
        await expect(new Registry().addNodeFromSource("anything")).rejects.toThrow(/needs `dynamicNodes/);
    });
});

describe("replacing a key from source", () => {
    const v1 = nodeSource("dyn-edit", "Source.version = 1;");
    const v2 = nodeSource("dyn-edit", "Source.version = 2;");

    it("is refused without { replace: true }, and the first class stays", async () => {
        const registry = dynamicRegistry();
        const first = await registry.addNodeFromSource(v1);
        await expect(registry.addNodeFromSource(v2)).rejects.toThrow(/Node type "dyn-edit" is already registered to a different class/);
        expect(registry.node("dyn-edit")?.ctor).toBe(classOf(first));
    });

    it("swaps the class with it, while nodes already built keep the old one", async () => {
        const registry = dynamicRegistry();
        const first = await registry.addNodeFromSource(v1);
        const spec = { id: "n", type: "dyn-edit", parentId: null, layerOrder: 0, props: {} };
        const before = registry.instantiate(spec);

        const second = await registry.addNodeFromSource(v2, { replace: true });
        expect(second).not.toBe(first);
        expect(registry.node("dyn-edit")?.ctor).toBe(classOf(second));
        expect(before).toBeInstanceOf(first);
        expect(before).not.toBeInstanceOf(second);
        expect(registry.instantiate(spec)).toBeInstanceOf(second);
    });

    it("can replace a built-in key, on this registry only", async () => {
        // Whether this should be allowed is open; today it is.
        const registry = dynamicRegistry();
        const other = new Registry();
        const keys = registry.nodeKeys();

        await expect(registry.addNodeFromSource(nodeSource("rect"))).rejects.toThrow(/Node type "rect" is already registered to a different class/);
        expect(registry.node("rect")?.ctor).toBe(Rect.node);
        expect(registry.nodeKeys()).toEqual(keys);

        const Imposter = await registry.addNodeFromSource(nodeSource("rect"), { replace: true });
        expect(registry.node("rect")?.ctor).toBe(classOf(Imposter));
        expect(registry.node("rect")?.ctor).not.toBe(Rect.node);
        expect(registry.nodeKeys()).toEqual(keys);
        expect(other.node("rect")?.ctor).toBe(Rect.node);
    });
});

describe("Engine.registerNode", () => {
    class Bare extends Node2D { }

    it("rejects a class that is no component instead of throwing", async () => {
        const engine = engineWith();
        let pending: Promise<NodeConstructor> | undefined;
        expect(() => { pending = engine.registerNode(Bare as unknown as NodeConstructor); }).not.toThrow();
        await expect(pending).rejects.toThrow(/is no component/);
        expect(engine.knows("bare")).toBe(false);
    });

    it("rejects a source string when no dynamicNodes were configured", async () => {
        const engine = engineWith(null);
        await expect(engine.registerNode(nodeSource("dyn-nowhere"))).rejects.toThrow(/needs `dynamicNodes/);
        expect(engine.knows("dyn-nowhere")).toBe(false);
    });

    it("registers a source string with { replace: true }, and sessions' nodes built before keep the old class", async () => {
        const engine = engineWith();
        const first = await engine.registerNode(nodeSource("dyn-engine", "Source.version = 1;"));
        const built = engine.registry.instantiate({ id: "n", type: "dyn-engine", parentId: null, layerOrder: 0, props: {} });

        const second = await engine.registerNode(nodeSource("dyn-engine", "Source.version = 2;"), { replace: true });
        expect(second).not.toBe(first);
        expect(engine.registry.node("dyn-engine")?.ctor).toBe(classOf(second));
        expect(built).toBeInstanceOf(first);
        expect(built).not.toBeInstanceOf(second);
    });

    it("refuses a clashing source without { replace: true } and leaves nodeKeys() unchanged", async () => {
        const engine = engineWith();
        await engine.registerNode(nodeSource("dyn-engine"));
        const keys = engine.registry.nodeKeys();

        await expect(engine.registerNode(nodeSource("dyn-engine"))).rejects.toThrow(/already registered to a different class/);
        await expect(engine.registerNode("throw new Error('no');")).rejects.toThrow("no");
        expect(engine.registry.nodeKeys()).toEqual(keys);
    });

    it("refuses a clashing class the same way", async () => {
        const engine = engineWith();
        const first = await engine.registerNode(nodeSource("dyn-engine"));
        class Other extends Node2D { }
        const keys = engine.registry.nodeKeys();

        await expect(engine.registerNode(Other as unknown as NodeConstructor)).rejects.toThrow(/is no component/);
        node("dyn-engine")(Other);
        await expect(engine.registerNode(Other as unknown as NodeConstructor)).rejects.toThrow(/already registered to a different class/);
        expect(engine.registry.node("dyn-engine")?.ctor).toBe(classOf(first));
        expect(engine.registry.nodeKeys()).toEqual(keys);
    });

    it("keeps a type registered on one engine unknown to another", async () => {
        const one = engineWith();
        const two = engineWith();
        await one.registerNode(nodeSource("dyn-private"));

        expect(one.knows("dyn-private")).toBe(true);
        expect(two.knows("dyn-private")).toBe(false);
        expect(two.registry.hasNode("dyn-private")).toBe(false);
        // And each engine still has its own copy of the built-ins.
        expect(two.knows("rect")).toBe(true);
    });

    it("lets two engines register the same key to different classes", async () => {
        const one = engineWith();
        const two = engineWith();
        const a = await one.registerNode(nodeSource("dyn-shared", "Source.which = 'one';"));
        const b = await two.registerNode(nodeSource("dyn-shared", "Source.which = 'two';"));
        expect(a).not.toBe(b);
        expect(one.registry.node("dyn-shared")?.ctor).toBe(classOf(a));
        expect(two.registry.node("dyn-shared")?.ctor).toBe(classOf(b));
    });
});
