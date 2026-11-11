import type { Node, NodeDimension } from "@/components/trees/node/node";
import type { Command, CommandArgs } from "@/tween/command";
import type { EasingFunction } from "@/tween/ease/type";
import { getPropertyMeta, type PropertyEditor } from "@/attributes/properties/decorator";
import { getCommandMeta, type CommandArg, type CommandArgDescriptor } from "@/tween/command-decorator";
import {
    normalizeShaderPack,
    type EffectShader,
    type FillShader,
    type Shader,
} from "@/attributes/shape/shaders/pack";
import { installBuiltins } from "./builtins";
import { DENIED_GLOBALS } from "./deny-globals";
import { getNodeDescriptor } from "./node-decorator";
import { applyPropEvolution, propEvolutionOf } from "./prop-evolution";
import type { NodePropertyDescriptor, NodeTypeDescriptor } from "./node-descriptor";
import type { NodeSpec } from "./types";

/**
 * Resolve to the host's sdk barrel. The published name comes first; the two after it are earlier unscoped
 * names, kept so older scripts still compile.
 */
const SDK_SPECIFIERS: readonly string[] = ["@motionscript/sdk", "motionscript", "motion-script"];

export type NodeConstructor = new (props?: Record<string, unknown>) => Node;

export type NodeTypeMap = Record<string, NodeConstructor>;

export type ShaderPackMap = Record<string, unknown>;

/**
 * Called once per compile, in timeline order, with `target` already in the state the previous command left:
 * that fixes the command's `from` and makes `Command.at(t)` pure thereafter.
 */
export type CommandFactory = (
    target: Node,
    args: Record<string, unknown>,
    duration: number,
    easing?: EasingFunction,
) => Command<Record<string, unknown>>;

/**
 * A handle, not the cell, so a command cannot subscribe to it, rebind it or hold it past the build: each would
 * stop it being a pure function of `t`.
 */
export interface VariableTarget {
    readonly id: string;
    get(): unknown;
    set(value: unknown): void;
    /** A command may use a different lerp when its args ask (`variableTo` does). */
    readonly lerp: VariableLerp;
}

/** Same contract as {@link CommandFactory}, against a variable instead of a node. */
export type VariableCommandFactory = (
    target: VariableTarget,
    args: Record<string, unknown>,
    duration: number,
    easing?: EasingFunction,
) => Command<Record<string, unknown>>;

/** Widened to `unknown`: a variable's type is a fact of the document, not of a class. */
export type VariableLerp = (from: unknown, to: unknown, t: number) => unknown;

/**
 * `scope` picks the table `CommandSpec.targetId` is looked up in, so a variable command reuses the field a
 * node command uses.
 */
export type CommandTypeEntry =
    | {
        key: string;
        scope: "node";
        factory: CommandFactory;
        /**
         * Declared by the paint commands, one key each. Absent for `to`/`set`, whose args are the props diff.
         */
        args?: readonly CommandArgDescriptor[];
        /**
         * Args are a props diff that reaches `set()`, so an expression compiles to a binding. A flag, not a name
         * check: `to` tweens towards a value, and binding a formula there would interpolate towards `NaN`.
         */
        binds?: boolean;
        /**
         * The method it runs on its target (the paint commands call the node's own `fillTo`). A type without it, or
         * one that withdrew it, does not take the command ({@link Registry.takesCommand}).
         */
        method?: string;
    }
    | {
        key: string;
        scope: "variable";
        factory: VariableCommandFactory;
    };

/**
 * Built from the whole prototype chain, so a `Card` extending `Rect` answers to `fadeTo` as it does to
 * `.fadeTo()`. Inherited entries are copied into each type, so nothing collides.
 */
export interface NodeTypeRecord {
    key: string;
    ctor: NodeConstructor;
    commands: ReadonlyMap<string, NodeCommandEntry>;
    /** Always present, however the type was registered. */
    descriptor: NodeTypeDescriptor;
}

export interface NodeCommandEntry {
    method: string;
    /** A bare name normalises to `{ key, kind: "unknown" }`. */
    args: readonly CommandArgDescriptor[];
    /**
     * Present and true for an entrance (`CommandMeta.entrance`), so a host can offer one when the node is added.
     */
    entrance?: true;
}

/**
 * Host-supplied: `core` has no compiler dependency and cannot import the `@motionscript/sdk` barrel (that
 * package depends on `core`).
 */
export interface DynamicNodeConfig {
    /**
     * Must be the host's already-loaded sdk instance, or `instanceof` silently fails against it. The earlier
     * unscoped specifiers resolve to the same object.
     */
    sdk: Record<string, unknown>;
    /**
     * Consulted after the sdk specifiers, so they cannot be shadowed. Each must be the host's loaded instance, for
     * the same `instanceof` reason.
     */
    modules?: Readonly<Record<string, unknown>>;
    /** Host-injected, never bundled. */
    compile: (source: string) => Promise<string>;
}

export interface RegistryOptions {
    /**
     * A record names the key outright, which asserts the class agrees: a rename on either side throws here rather
     * than surfacing as an unknown type at render.
     */
    nodes?: NodeTypeMap | readonly NodeConstructor[];
    shaders?: ShaderPackMap;
    lerps?: Record<string, VariableLerp>;
    eases?: Record<string, EasingFunction>;
    dynamicNodes?: DynamicNodeConfig;
    /**
     * Fail the build on an unknown node type or command, instead of standing in a placeholder and recording it in
     * `buildErrors`.
     */
    strict?: boolean;
    /**
     * Only for a test asserting on the seeding, or a deliberately tiny vocabulary: a document naming `"rect"` will
     * not compile without it.
     */
    builtins?: boolean;
}

/**
 * An instance, not module-scope tables: what a document can name is a property of the engine opening it, so
 * two engines in one process disagree freely.
 *
 * Commands are per node type (a method on a class); only those that must resolve without a node
 * (variable-scoped, generic prop writers) sit in a table of their own.
 */
export class Registry {
    /** Ceiling, so an import cannot evict a workspace's own shaders by volume. */
    static readonly MAX_SHADERS = 512;

    readonly strict: boolean;

    constructor(options: RegistryOptions = {}) {
        this._dynamicNodes = options.dynamicNodes;
        this.strict = options.strict === true;
        if (options.builtins !== false) installBuiltins(this);
        if (Array.isArray(options.nodes)) {
            for (const ctor of options.nodes) this.addNode(ctor);
        } else {
            for (const [key, ctor] of Object.entries(options.nodes ?? {})) this.addNode(key, ctor);
        }
        for (const [key, lerp] of Object.entries(options.lerps ?? {})) this.addLerp(key, lerp);
        for (const [key, ease] of Object.entries(options.eases ?? {})) this.addEase(key, ease);
        for (const [key, pack] of Object.entries(options.shaders ?? {})) this.addShader(key, pack);
    }

    /**
     * Register a node class with its commands and descriptor. Commands come off the class's `command()` methods,
     * read through an object over the prototype so no constructor runs (it may expect props, build children or
     * touch a clock).
     *
     * Re-registering the same class under a key is a no-op (hot reload, a duplicated dependency); a different
     * class throws, since a document would render differently by registration order. `replace: true` opts out, for
     * a recompiled node (see {@link addNodeFromSource}).
     */
    addNode(ctor: NodeConstructor, options?: { replace?: boolean }): this;
    addNode(type: string | NodeTypeDescriptor, ctor: NodeConstructor, options?: { replace?: boolean }): this;
    addNode(
        type: string | NodeTypeDescriptor | NodeConstructor,
        ctorOrOptions?: NodeConstructor | { replace?: boolean },
        maybeOptions?: { replace?: boolean },
    ): this {
        const isTwoArgForm = typeof ctorOrOptions === "function";
        // A component (`component2d(...)`) registers as the node class it generated.
        const given = (isTwoArgForm ? ctorOrOptions : type) as NodeConstructor & { node?: NodeConstructor };
        const cls = typeof given.node === "function" ? given.node : given;
        const options = isTwoArgForm ? maybeOptions : ctorOrOptions as { replace?: boolean } | undefined;
        const declared = isTwoArgForm ? type as string | NodeTypeDescriptor : getNodeDescriptor(cls);
        if (declared === undefined) {
            throw new Error(
                `${cls.name || "The class"} is no component, so it has no document key. ` +
                `Make it with component2d({ key }), or register it explicitly: addNode("myKey", TheClass).`,
            );
        }
        const descriptor: NodeTypeDescriptor = typeof declared === "string" ? { key: declared } : declared;
        const key = descriptor.key;

        const existing = this._nodes.get(key);
        if (existing) {
            if (existing.ctor === cls) return this;
            if (!options?.replace) {
                throw new Error(
                    `Node type "${key}" is already registered to a different class ` +
                    `(${existing.ctor.name} vs ${cls.name}). Keys must be unique — a document ` +
                    `naming this type would otherwise resolve differently depending on registration order.`,
                );
            }
        }

        const commands = new Map<string, NodeCommandEntry>();
        for (const meta of getCommandMeta(Object.create(cls.prototype) as object)) {
            commands.set(meta.key, {
                method: meta.method,
                args: this._describeArgs(meta.args),
                ...(meta.entrance ? { entrance: true as const } : {}),
            });
        }

        this._nodes.set(key, {
            key,
            ctor: cls,
            commands,
            // Derived, never declared: see `NodeTypeDescriptor.properties`.
            descriptor: this._describeEvolution(cls, {
                ...descriptor,
                dimension: this._describeDimension(cls),
                holds: this._describeHolds(cls),
                properties: this._describeProperties(cls),
            }),
        });
        return this;
    }

    /**
     * The script must `export default` a component whose `key` supplies the registry key, as {@link addNode} reads
     * it: one way to name a dynamic node's key. Requires `dynamicNodes`; `core` only calls the host-supplied
     * `compile` and links the result.
     */
    async addNodeFromSource(source: string, options?: { replace?: boolean }): Promise<NodeConstructor> {
        if (!this._dynamicNodes) {
            throw new Error(
                "addNodeFromSource needs `dynamicNodes: { sdk, compile }` on the Registry constructor.",
            );
        }
        const js = await this._dynamicNodes.compile(source);
        const ctor = this._evalNodeModule(js);
        this.addNode(ctor, options);
        return ctor;
    }

    node(key: string): NodeTypeRecord | undefined {
        return this._nodes.get(key);
    }

    hasNode(key: string): boolean {
        return this._nodes.has(key);
    }

    nodeKeys(): string[] {
        return [...this._nodes.keys()].sort();
    }

    describe(key: string): NodeTypeDescriptor | undefined {
        return this._nodes.get(key)?.descriptor;
    }

    /**
     * The props pass through the type's evolution first (`migrateNodeProps`).
     *
     * `props` overrides the spec's own so the timeline can leave expression-bound props out of the constructor,
     * which reads raw props for defaults like size, and `set()` them after. The spec's `id` outranks both, so
     * {@link Node.id} is the document's identity. `key` rides along only when the row has one: `applyEditorStates`
     * keys on {@link Node.key}, and an absent row key must not overwrite one passed in `props`.
     */
    instantiate(spec: NodeSpec, props?: Record<string, unknown>): Node {
        const record = this._nodes.get(spec.type);
        if (!record) {
            throw new Error(
                `Unknown node type "${spec.type}" (node ${spec.id}). ` +
                `This registry knows: ${this.nodeKeys().join(", ") || "nothing"}.`,
            );
        }
        const evolution = propEvolutionOf(record.ctor);
        const given = props ?? spec.props;
        return new record.ctor({
            ...(evolution ? applyPropEvolution(evolution, given).props : given),
            id: spec.id,
            ...(spec.key !== undefined && { key: spec.key }),
        });
    }

    /** Same uniqueness rule as {@link addNode}. */
    addCommand(
        key: string,
        factory: CommandFactory,
        options?: { binds?: boolean; args?: readonly CommandArg[]; method?: string },
    ): this {
        if (this._claimed(key, factory)) return this;
        this._commands.set(key, {
            key,
            scope: "node",
            factory,
            ...(options?.args ? { args: this._describeArgs(options.args) } : {}),
            binds: options?.binds,
            ...(options?.method ? { method: options.method } : {}),
        });
        return this;
    }

    /**
     * A host's seam for its own variable commands (a spring, a wiggle); the returned {@link Command} must be a
     * pure function of `t`.
     */
    addVariableCommand(key: string, factory: VariableCommandFactory): this {
        if (this._claimed(key, factory)) return this;
        this._commands.set(key, { key, scope: "variable", factory });
        return this;
    }

    command(key: string): CommandTypeEntry | undefined {
        return this._commands.get(key);
    }

    /**
     * Dispatches by calling the named method, never by testing against a class: a forked component is a different
     * class carrying the same source, so `instanceof` against the original is false.
     */
    nodeCommand(nodeTypeKey: string, commandKey: string): CommandFactory | undefined {
        const record = this._nodes.get(nodeTypeKey);
        const entry = record?.commands.get(commandKey);
        if (!entry) return undefined;
        return (target, args, duration, easing) => {
            const fn = (target as unknown as Record<string, unknown>)[entry.method];
            if (typeof fn !== "function") {
                throw new Error(
                    `Command "${commandKey}" needs a "${entry.method}" method on ` +
                    `${target.constructor.name}, which has none.`,
                );
            }
            const data: Record<string, unknown> = {};
            for (const arg of entry.args) data[arg.key] = args[arg.key];
            return (fn as (args: CommandArgs) => Command<Record<string, unknown>>)
                .call(target, { data, duration, easing });
        };
    }

    /**
     * A node takes what its own table publishes, plus node-less commands that act on a node (`to`, `fillTo`)
     * unless the method they run is one the type lacks.
     */
    takesCommand(nodeTypeKey: string, commandKey: string): boolean {
        const record = this._nodes.get(nodeTypeKey);
        if (!record) return false;
        if (record.commands.has(commandKey)) return true;
        const global = this._commands.get(commandKey);
        if (global?.scope !== "node") return false;
        if (global.method === undefined) return true;
        return typeof (record.ctor.prototype as Record<string, unknown>)[global.method] === "function";
    }

    commandKeys(nodeTypeKey?: string): string[] {
        const keys = nodeTypeKey === undefined
            ? this._commands.keys()
            : this._nodes.get(nodeTypeKey)?.commands.keys() ?? [];
        return [...keys].sort();
    }

    /** Same uniqueness rule as {@link addNode}. */
    addLerp(key: string, lerp: VariableLerp): this {
        const existing = this._lerps.get(key);
        if (existing && existing !== lerp) {
            throw new Error(
                `Variable lerp "${key}" is already registered to a different function. Keys must be unique.`,
            );
        }
        this._lerps.set(key, lerp);
        return this;
    }

    lerp(key: string): VariableLerp | undefined {
        return this._lerps.get(key);
    }

    lerpKeys(): string[] {
        return [...this._lerps.keys()].sort();
    }

    /**
     * A numeric variable with no declared lerp interpolates; anything else snaps at the end. Guessing a structural
     * lerp off one sample would blend objects that merely share an `x` key.
     */
    requireLerp(key: string | undefined, value: unknown, where: string): VariableLerp {
        const resolved = key ?? (typeof value === "number" ? "number" : "step");
        const lerp = this._lerps.get(resolved);
        if (!lerp) {
            throw new Error(
                `Unknown variable lerp "${resolved}" (${where}). ` +
                `Registered: ${this.lerpKeys().join(", ") || "none"}.`,
            );
        }
        return lerp;
    }

    /** Referenced as `{ kind: "custom", args: key }`. Same uniqueness rule as {@link addNode}. */
    addEase(key: string, ease: EasingFunction): this {
        const existing = this._eases.get(key);
        if (existing && existing !== ease) {
            throw new Error(
                `Ease "${key}" is already registered to a different function. Keys must be unique.`,
            );
        }
        this._eases.set(key, ease);
        return this;
    }

    ease(key: string): EasingFunction | undefined {
        return this._eases.get(key);
    }

    easeKeys(): string[] {
        return [...this._eases.keys()].sort();
    }

    /**
     * The key is an argument, not a pack field (as in {@link addNode}), so a file stays portable between projects;
     * a pack's own `id` is provenance. The pack is normalised on the way in.
     *
     * Re-registering an equal pack is a no-op: the same file imported twice yields two equal objects, and throwing
     * there would defeat the uniqueness rule. `replace: true` overwrites with a different pack, for a live-edited
     * shader.
     */
    addShader(key: string, pack: unknown, options?: { replace?: boolean }): Shader {
        const normalized = normalizeShaderPack(pack);
        const existing = this._shaders.get(key);
        if (existing) {
            if (
                existing.scope === normalized.scope
                && existing.source === normalized.source
                && existing.name === normalized.name
            ) return existing;
            if (!options?.replace) {
                throw new Error(
                    `Shader "${key}" is already registered to a different pack ` +
                    `("${existing.name}" vs "${normalized.name}"). Keys must be unique — a document ` +
                    `naming this shader would otherwise resolve differently depending on registration order.`,
                );
            }
        } else if (this._shaders.size >= Registry.MAX_SHADERS) {
            throw new Error(
                `Cannot register shader "${key}": the ${Registry.MAX_SHADERS}-shader ceiling is reached.`,
            );
        }
        this._shaders.set(key, normalized);
        return normalized;
    }

    shader(key: string): Shader | undefined {
        return this._shaders.get(key);
    }

    /**
     * The typed accessors deliver the compile error the union promises: {@link shader} returns `Shader`, and an
     * unnarrowed call site could pass an effect pack to `Fills.shader`.
     */
    fillShader(key: string): FillShader | undefined {
        const pack = this._shaders.get(key);
        return pack?.scope === "fill" ? pack : undefined;
    }

    effectShader(key: string): EffectShader | undefined {
        const pack = this._shaders.get(key);
        return pack?.scope === "effect" ? pack : undefined;
    }

    shaderKeys(): string[] {
        return [...this._shaders.keys()].sort();
    }

    private readonly _nodes = new Map<string, NodeTypeRecord>();
    private readonly _commands = new Map<string, CommandTypeEntry>();
    private readonly _lerps = new Map<string, VariableLerp>();
    private readonly _eases = new Map<string, EasingFunction>();
    private readonly _shaders = new Map<string, Shader>();
    private readonly _dynamicNodes?: DynamicNodeConfig;

    /**
     * `new Function` in-realm, never a blob module or a worker (see {@link DynamicNodeConfig} and
     * `deny-globals.ts`). `require()` is locked to the sdk specifiers and the host's `modules`, own keys only so
     * `require("constructor")` cannot reach `Object`. No relative imports: a dynamic node is one script.
     */
    private _evalNodeModule(js: string): NodeConstructor {
        const { sdk, modules } = this._dynamicNodes!;
        const require = (specifier: string): unknown => {
            if (SDK_SPECIFIERS.includes(specifier)) return sdk;
            if (modules && Object.hasOwn(modules, specifier)) return modules[specifier];
            const available = ["@motionscript/sdk", ...Object.keys(modules ?? {})];
            throw new Error(
                `"${specifier}" isn't available to a custom node. It can require ` +
                `${available.map((s) => `"${s}"`).join(", ")}; a host supplies more through \`dynamicNodes.modules\`.`,
            );
        };
        const mod = { exports: {} as Record<string, unknown> };
        // The script runs one function in from the parameters that deny the
        // globals, so its own top-level `const frames` shadows a denied name
        // instead of redeclaring a parameter. A body that closes that function
        // early is still inside the outer one, which denies the same names.
        const factory = new Function(
            "exports", "require", "module", ...DENIED_GLOBALS,
            `"use strict";\nreturn function () {\n${js}\n};`,
        );
        factory(mod.exports, require, mod)();

        const ctor = mod.exports.default as (NodeConstructor & { node?: NodeConstructor }) | undefined;
        if (typeof ctor !== "function" || getNodeDescriptor(typeof ctor.node === "function" ? ctor.node : ctor) === undefined) {
            throw new Error("This script must `export default` a component: `component2d({ key: \"…\", … })`.");
        }
        return ctor;
    }

    /** See {@link addNode} for why. */
    private _claimed(key: string, factory: CommandFactory | VariableCommandFactory): boolean {
        const existing = this._commands.get(key);
        if (!existing) return false;
        if (existing.factory === factory) return true;
        throw new Error(
            `Command type "${key}" is already registered to a different factory. Keys must be unique.`,
        );
    }

    /** The whole prototype chain, so a component publishes the box its tree's base declares too. */
    private _describeProperties(ctor: NodeConstructor): Record<string, NodePropertyDescriptor> {
        const out: Record<string, NodePropertyDescriptor> = {};
        for (const meta of getPropertyMeta(Object.create(ctor.prototype) as object)) {
            const editor: PropertyEditor = meta.editor ?? {};
            out[meta.key] = {
                ...editor,
                kind: editor.kind ?? this._inferKind(meta.default),
                ...(meta.default !== undefined ? { default: meta.default } : {}),
            };
        }
        return out;
    }

    private _describeEvolution(ctor: NodeConstructor, descriptor: NodeTypeDescriptor): NodeTypeDescriptor {
        const evolution = propEvolutionOf(ctor);
        if (!evolution) return descriptor;
        const properties = { ...descriptor.properties };
        for (const [key, message] of Object.entries(evolution.deprecated)) {
            if (properties[key]) properties[key] = { ...properties[key], deprecated: message };
        }
        const renamed = Object.keys(evolution.renamed).length > 0 ? { renamed: { ...evolution.renamed } } : {};
        return { ...descriptor, ...renamed, properties };
    }

    /** `Node.dimension` is a getter so it answers from the prototype, before any field initializer has run. */
    private _describeDimension(ctor: NodeConstructor): NodeDimension | undefined {
        const dimension = (Object.create(ctor.prototype) as Node).dimension;
        return typeof dimension === "string" ? dimension : undefined;
    }

    private _describeHolds(ctor: NodeConstructor): readonly NodeDimension[] | undefined {
        const trees = (Object.create(ctor.prototype) as Partial<Node>)._childTrees;
        return Array.isArray(trees) ? [...trees] : undefined;
    }

    /**
     * A function default is a reactive binding, not a value, so it says nothing about the control; those declare a
     * kind or take "unknown", which a host draws read-only.
     */
    private _inferKind(value: unknown): string {
        switch (typeof value) {
            case "number": return "number";
            case "string": return "text";
            case "boolean": return "boolean";
            case "object":
                if (value === null) return "unknown";
                return Array.isArray(value) && value.every(v => typeof v === "number")
                    ? "vector"
                    : "object";
            default: return "unknown";
        }
    }

    private _describeArgs(args: readonly CommandArg[] | undefined): CommandArgDescriptor[] {
        return (args ?? []).map((arg) =>
            typeof arg === "string" ? { key: arg, kind: "unknown" } : { kind: "unknown", ...arg });
    }
}
