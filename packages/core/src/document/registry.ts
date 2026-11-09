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
 * The specifiers a dynamic node's `require()` resolves to the host's sdk
 * barrel. The published
 * name comes first; the two after it are the package's earlier unscoped names,
 * kept so a script authored under either still compiles.
 */
const SDK_SPECIFIERS: readonly string[] = ["@motionscript/sdk", "motionscript", "motion-script"];

/**
 * The **code** half of the document model, as one object an engine owns.
 *
 * A document names a node type, a command, a lerp and a shader with a string.
 * Something has to turn `"rect"` into a class and `"fillTo"` into an animation,
 * and that something is deliberately a registry rather than a table in the
 * database: node types are code — a class with `property` declarations, a
 * `renderSelf`, and `command()` methods — and code is versioned with the
 * library, not with the document.
 *
 * **It is an instance, not a module.** Every table here used to be a
 * module-scope `Map` behind a dozen free functions, which made a registration
 * a fact about the *process*: two engines in one process shared one vocabulary,
 * a declared class was registered by the mere act of being imported, whichever
 * host loaded first won a contested key, and a test had to remember to call a
 * `clearRegistries()` that reached into three modules. A registry is now a value
 * with an owner — an `Engine`'s own, reached through `registerNode`/`registerShader`
 * rather than a public `registry` field — so what a document can name is a
 * property of the engine opening it, and two engines disagree about it freely.
 *
 * ```ts
 * const registry = new Registry({ nodes: [Blob], shaders: { swirl: SWIRL } });
 * registry.commandKeys("blob");   // ["fadeTo", "moveTo", …, "wobbleTo"]
 * ```
 *
 * **Commands are per node type, and that is the point.** They used to share one
 * flat table with the node types, which made a command key a global claim: the
 * first package to register `reveal` owned the word, and a second node type
 * wanting it — with different arguments — could not have it. Nothing about a
 * command is global, though: it is a method on a class, dispatched against an
 * instance the document already names. Only the handful that must resolve
 * *without* a node — the variable-scoped ones and the generic prop writers — sit
 * in a table of their own.
 */

/** Constructs a node from its authored props. Every built-in node class matches this. */
export type NodeConstructor = new (props?: Record<string, unknown>) => Node;

/** Node types a registry makes available, by the key a document names them with. */
export type NodeTypeMap = Record<string, NodeConstructor>;

/** Shader packs a registry makes available, by document key. A pack is plain JSON. */
export type ShaderPackMap = Record<string, unknown>;

/**
 * Builds the {@link Command} a `CommandSpec` stands for.
 *
 * Called **once per compile**, in timeline order, with `target` already in the
 * state the previous command left it — that is what fixes the command's `from`
 * value and makes the returned `Command.at(t)` pure thereafter. See
 * `tween/command.ts` and `document/timeline.ts`.
 *
 * @param target   The node the command acts on (the scene root for `targetId: null`).
 * @param args     The spec's `args`, verbatim.
 * @param duration Seconds, already defaulted by the caller.
 * @param easing   Resolved from the spec's `EaseSpec`, or `undefined`.
 */
export type CommandFactory = (
    target: Node,
    args: Record<string, unknown>,
    duration: number,
    easing?: EasingFunction,
) => Command<Record<string, unknown>>;

/**
 * The variable a variable command writes.
 *
 * A handle rather than the cell itself, so a command cannot subscribe to it,
 * rebind it, or hold it past the build that made it — the three ways a command
 * could stop being a pure function of `t`.
 */
export interface VariableTarget {
    /** The id an expression names with `[id]`. */
    readonly id: string;
    /** What it holds right now. */
    get(): unknown;
    set(value: unknown): void;
    /**
     * The lerp its `VariableSpec.lerp` resolved to. A command is free to use a
     * different one when its args ask for it — `variableTo` does.
     */
    readonly lerp: VariableLerp;
}

/**
 * Builds the {@link Command} a variable-scoped `CommandSpec` stands for.
 *
 * Same contract as {@link CommandFactory} — called once per compile, in timeline
 * order, against a variable already holding what its predecessors left — with a
 * {@link VariableTarget} in place of a node.
 */
export type VariableCommandFactory = (
    target: VariableTarget,
    args: Record<string, unknown>,
    duration: number,
    easing?: EasingFunction,
) => Command<Record<string, unknown>>;

/**
 * How a variable's value interpolates between two states.
 *
 * The same shape every `property` tween already has, widened to `unknown`
 * because a variable's type is a fact of the document rather than of a class:
 * one holds a number, the next a colour string, the next a whole fill object.
 */
export type VariableLerp = (from: unknown, to: unknown, t: number) => unknown;

/**
 * One command that resolves without a node.
 *
 * `scope` says which table `CommandSpec.targetId` is looked up in, and is what
 * lets a variable command reuse the same field a node command uses instead of
 * inventing a second one every host's timeline would then have to special-case.
 */
export type CommandTypeEntry =
    | {
        key: string;
        scope: "node";
        factory: CommandFactory;
        /**
         * Its leading parameters, as {@link NodeCommandEntry.args} describes a
         * node command's — declared by the paint commands, which read one key
         * each. Absent for `to`/`set`, whose args *are* the props diff.
         */
        args?: readonly CommandArgDescriptor[];
        /**
         * This command **writes props declaratively**, so an expression in its
         * args compiles to a binding rather than being passed through as a
         * string. `set` is the only built-in that does.
         *
         * A flag rather than a name check, because the distinction is real: `to`
         * tweens *towards* a value and a formula is not a value, so binding one
         * as a tween destination would interpolate towards `NaN` and look like a
         * renderer bug. A command opting in is saying its args reach `set()`.
         */
        binds?: boolean;
        /**
         * The method it runs on its target, where it runs one: the paint
         * commands call the node's own `fillTo`, `strokeTo`, …. A node type
         * without it, or one that withdrew it, does not take the command
         * ({@link Registry.takesCommand}).
         */
        method?: string;
    }
    | {
        key: string;
        scope: "variable";
        factory: VariableCommandFactory;
    };

/**
 * One node type's own command table.
 *
 * Built from the class's `command()` methods — the **whole** prototype chain,
 * not just its own — because the table is per type. A `Card` extending `Rect`
 * answers to `fadeTo` for the same reason it answers to `.fadeTo()`: it has the
 * method. There is nothing here for two node types to collide over, so
 * inherited entries can simply be copied into each.
 */
export interface NodeTypeRecord {
    /** The document key, matching `NodeSpec.type`. */
    key: string;
    /** The class to construct. */
    ctor: NodeConstructor;
    /** Its commands, by the key a document names them with. */
    commands: ReadonlyMap<string, NodeCommandEntry>;
    /**
     * What the type declares about itself — see {@link NodeTypeDescriptor}.
     *
     * Always present, so a host reads one shape whether the type was registered
     * with a bare key, a full descriptor, or a component.
     */
    descriptor: NodeTypeDescriptor;
}

/** One command on one node type. */
export interface NodeCommandEntry {
    /** The method to call. */
    method: string;
    /**
     * Its leading parameters, from `command({ args })`, always as descriptors.
     *
     * A bare name normalises to `{ key, kind: "unknown" }`, so a host reads one
     * shape whether the method bothered to describe its arguments or not.
     */
    args: readonly CommandArgDescriptor[];
    /** Present and true for an entrance (`CommandMeta.entrance`), so a host can offer one when the node is added. */
    entrance?: true;
}

/**
 * How a registry compiles and links a node authored as a TS source string
 * that default-exports a component, via {@link Registry.addNodeFromSource}.
 *
 * Entirely host-supplied — `core` has no compiler dependency and cannot
 * import the published `@motionscript/sdk` barrel itself (that package
 * depends on `core`, so the reverse direction would be circular).
 */
export interface DynamicNodeConfig {
    /**
     * What `require("@motionscript/sdk")` resolves to inside a compiled
     * script — the host's own already-loaded sdk barrel instance. Must be the
     * same module instance the rest of the app uses, or `instanceof` silently
     * fails against it. The earlier unscoped specifiers, `"motionscript"` and
     * the dashed `"motion-script"`, resolve to the same object, so a node
     * script authored under either name keeps compiling unmodified.
     */
    sdk: Record<string, unknown>;
    /**
     * Further modules a script may `require`, by exact specifier — what a
     * forked component imports beyond the sdk barrel:
     * `@motionscript/sdk/component`, its package's kit. Consulted after the
     * two above, so neither can be shadowed. Each value has to be the host's
     * own loaded instance, for the same `instanceof` reason as `sdk`.
     */
    modules?: Readonly<Record<string, unknown>>;
    /**
     * TS source → JS text (CommonJS). Host-injected, never bundled —
     * `core` has no compiler dependency of its own.
     */
    compile: (source: string) => Promise<string>;
}

/** What a registry is seeded with, on top of the builtin vocabulary. */
export interface RegistryOptions {
    /**
     * Custom node types — components, or explicit keys.
     *
     * An array reads each class's `node()` declaration; a record names the key
     * outright, which is also an assertion that the two agree (a rename on
     * either side throws here rather than surfacing as an unknown type at
     * render).
     */
    nodes?: NodeTypeMap | readonly NodeConstructor[];
    /** Shader packs, by document key. Plain JSON — normalised on the way in. */
    shaders?: ShaderPackMap;
    /** Extra variable interpolations, on top of `number`/`vector2`/`vector3`/`color`/`step`. */
    lerps?: Record<string, VariableLerp>;
    /** Custom eases, referenced from a document as `{ kind: "custom", args: key }`. */
    eases?: Record<string, EasingFunction>;
    /** Enables {@link Registry.addNodeFromSource} — see {@link DynamicNodeConfig}. */
    dynamicNodes?: DynamicNodeConfig;
    /**
     * Fail a track's build on a node type or command this registry lacks, as
     * builds did before placeholders. Off, the build stands an inert
     * placeholder in for the node, skips the command, and records each in
     * `buildErrors`. For a render whose output nobody inspects.
     */
    strict?: boolean;
    /**
     * Leave out everything the library itself ships. Only useful to a test
     * asserting on the seeding, or a host building a deliberately tiny
     * vocabulary — a document naming `"rect"` will not compile without it.
     */
    builtins?: boolean;
}

/** See the module docblock. */
export class Registry {
    /** Ceiling, so an import cannot evict a workspace's own shaders by volume. */
    static readonly MAX_SHADERS = 512;

    /** See {@link RegistryOptions.strict}. */
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

    // ─── Node types ──────────────────────────────────────────────────────────

    /**
     * Register a node class, with its commands and whatever else it declares.
     *
     * Takes a component (or a class carrying a `node()` declaration) on its own, or a bare key / full
     * {@link NodeTypeDescriptor} plus the class. The descriptor is the code half
     * of what a component package used to restate in a `manifest.json` —
     * carried, never interpreted, so a host has one place to ask and no second
     * file to disagree with the class.
     *
     * The commands come off the class, so `command()` is the only place a
     * node's animations are written down. Nothing is constructed to read them:
     * `command` records onto the prototype, so an object *over* the prototype
     * reaches the whole chain without running a constructor that may expect
     * props, build children, or touch a clock.
     *
     * Re-registering the same class under the same key is a no-op, so a hot
     * reload or a duplicated dependency is harmless. Re-registering a
     * *different* class throws: two classes answering to one key means a
     * document renders differently depending on registration order, which is not
     * a failure anyone would find by looking at the document.
     *
     * Pass `{ replace: true }` to opt out of that throw — the one case it's
     * wrong for is a node whose source has genuinely been edited and
     * recompiled (see {@link addNodeFromSource}), where re-registering under
     * the same key with a new class is the whole point. The default stays a
     * throw; this is deliberately not the common path.
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
     * Compile a TS source string into a live node type and register it.
     *
     * The script must `export default` a component (`component2d({ key, … })`),
     * whose `key` supplies the registry key, exactly as {@link addNode}
     * already reads it off a statically-imported one. There is no separate
     * `key` parameter: one way to name a dynamic node's key, not two that
     * could disagree.
     *
     * Requires `dynamicNodes` to have been passed to the constructor — see
     * {@link DynamicNodeConfig}. `core` never compiles anything itself; this
     * only calls the host-supplied `compile` and links its result.
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

    /** Everything registered under `key`, or `undefined`. */
    node(key: string): NodeTypeRecord | undefined {
        return this._nodes.get(key);
    }

    /** Whether a document naming `key` can be compiled against this registry. */
    hasNode(key: string): boolean {
        return this._nodes.has(key);
    }

    /** Every registered node key, for a host offering a palette. Sorted, so the order is stable. */
    nodeKeys(): string[] {
        return [...this._nodes.keys()].sort();
    }

    /** What `key` declares about itself, or `undefined` if it is not registered. */
    describe(key: string): NodeTypeDescriptor | undefined {
        return this._nodes.get(key)?.descriptor;
    }

    /**
     * Build a node from its spec. Throws on an unknown type.
     *
     * The props pass through the type's own evolution first (`migrateNodeProps`),
     * so a row written before a prop was renamed still sets it.
     *
     * `props` overrides the spec's own, which is how the timeline keeps an
     * expression out of a constructor: an expression-bound prop is left out of
     * what is passed here and written afterwards with `set()`. Constructors read
     * their raw props to decide things like a default size, and a `() => number`
     * is not an answer to that question. The spec's `id` outranks both, so
     * {@link Node.id} is the document's own identity rather than a per-instance
     * UUID — without it a host could never resolve a node it addressed by id.
     *
     * `key` rides along the same way, and only when the row carries one:
     * `applyEditorStates` keys the whole editor-state record on {@link Node.key},
     * so a row whose key never reached the node is a node a host cannot hide or
     * lock — and overwriting one passed in `props` with an absent row-level key
     * would take that away from a caller who had it working.
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

    // ─── Commands ────────────────────────────────────────────────────────────

    /**
     * Register a command that resolves **without** a node — see
     * {@link CommandTypeEntry}. Same uniqueness rule as {@link addNode}.
     */
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
     * Register a command that writes a **variable** rather than a node.
     *
     * The seam a host reaches for to add its own — a spring, a wiggle, a
     * sample-and-hold — without touching the timeline. `CommandSpec.targetId`
     * names the variable, and the {@link Command} that comes back must be a pure
     * function of `t` like any other.
     */
    addVariableCommand(key: string, factory: VariableCommandFactory): this {
        if (this._claimed(key, factory)) return this;
        this._commands.set(key, { key, scope: "variable", factory });
        return this;
    }

    /** The node-less command registered under `key`, or `undefined`. */
    command(key: string): CommandTypeEntry | undefined {
        return this._commands.get(key);
    }

    /**
     * A factory for `commandKey` on `nodeTypeKey`, or `undefined` if that type
     * does not publish it.
     *
     * Dispatches by **calling the named method**, never by testing the target
     * against a class: a forked component is a different class carrying the same
     * source, and an `instanceof` against the original is false for it.
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
     * Whether a node of `nodeTypeKey` takes `commandKey`: one its own table
     * publishes, or a node-less one that acts on a node (`to`, `fillTo`) unless
     * the method it runs is one the type lacks. What a host offers a
     * node is its table and the node-less commands it takes.
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

    /**
     * Every command key available. With a node type, that type's own table;
     * without one, the node-less commands. Sorted, so the order is stable.
     */
    commandKeys(nodeTypeKey?: string): string[] {
        const keys = nodeTypeKey === undefined
            ? this._commands.keys()
            : this._nodes.get(nodeTypeKey)?.commands.keys() ?? [];
        return [...keys].sort();
    }

    // ─── Variable lerps ──────────────────────────────────────────────────────

    /**
     * Register an interpolation under a document key.
     *
     * The **code** half of a variable, exactly as a node class is the code half
     * of a node: `{"lerp": "color"}` in a document is a string, and something
     * has to turn it into the function that blends two colours. Same uniqueness
     * rule as {@link addNode}.
     */
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

    /** The lerp registered under `key`, or `undefined`. */
    lerp(key: string): VariableLerp | undefined {
        return this._lerps.get(key);
    }

    /** Every registered lerp key. Sorted, so the order is stable. */
    lerpKeys(): string[] {
        return [...this._lerps.keys()].sort();
    }

    /**
     * The lerp a `VariableSpec` resolves to, defaulting from its value.
     *
     * A numeric variable with no declared lerp interpolates; anything else snaps
     * at the end. That is less a fallback than the only honest default —
     * guessing a structural lerp off one sample would blend two objects that
     * merely share an `x` key into something neither of them is.
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

    // ─── Custom eases ────────────────────────────────────────────────────────

    /**
     * Register a custom ease under a document key, referenced as
     * `{ kind: "custom", args: key }`. Same uniqueness rule as {@link addNode}.
     */
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

    /** The ease registered under `key`, or `undefined`. */
    ease(key: string): EasingFunction | undefined {
        return this._eases.get(key);
    }

    /** Every registered ease key. Sorted, so the order is stable. */
    easeKeys(): string[] {
        return [...this._eases.keys()].sort();
    }

    // ─── Shaders ─────────────────────────────────────────────────────────────

    /**
     * Register a shader pack under a document key.
     *
     * The key is an argument rather than a field of the pack — the same shape
     * {@link addNode} has — so one file can be registered under whatever name a
     * project wants and stays portable between them. A pack's own `id`, when it
     * has one, is provenance.
     *
     * The pack is normalised on the way in, so what comes back out of
     * {@link shader} is always the current shape whatever the file looked like.
     * Re-registering an equal pack is a no-op — the common case is the *same
     * file* imported twice, which produces two structurally identical objects,
     * and throwing on that would make the uniqueness rule fire on the one case
     * it is meant to tolerate.
     *
     * Pass `{ replace: true }` to overwrite a key with a genuinely different
     * pack — the same opt-in `addNode` takes, for the same reason: a live-edited
     * shader re-registering under its existing key.
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

    /** The pack registered under `key`, or `undefined`. */
    shader(key: string): Shader | undefined {
        return this._shaders.get(key);
    }

    /**
     * The pack registered under `key`, if it is a **fill** shader.
     *
     * The typed accessors are what actually deliver the compile error the union
     * promises: {@link shader} hands back `Shader`, and a call site that never
     * narrows could still pass an effect pack to `Fills.shader`.
     */
    fillShader(key: string): FillShader | undefined {
        const pack = this._shaders.get(key);
        return pack?.scope === "fill" ? pack : undefined;
    }

    /** The pack registered under `key`, if it is an **effect** shader. */
    effectShader(key: string): EffectShader | undefined {
        const pack = this._shaders.get(key);
        return pack?.scope === "effect" ? pack : undefined;
    }

    /** Every registered shader key, for a host offering a picker. Sorted. */
    shaderKeys(): string[] {
        return [...this._shaders.keys()].sort();
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    private readonly _nodes = new Map<string, NodeTypeRecord>();
    private readonly _commands = new Map<string, CommandTypeEntry>();
    private readonly _lerps = new Map<string, VariableLerp>();
    private readonly _eases = new Map<string, EasingFunction>();
    private readonly _shaders = new Map<string, Shader>();
    private readonly _dynamicNodes?: DynamicNodeConfig;

    /**
     * Evaluates one compiled (CommonJS) dynamic-node module in the current
     * realm and returns its default export.
     *
     * `new Function` in-realm, never a blob module or a worker — see
     * {@link DynamicNodeConfig} and `deny-globals.ts` for why. `require()` is
     * locked to exactly `"@motionscript/sdk"` (plus the earlier unscoped `"motionscript"` and `"motion-script"`
     * spellings, so a script written under either name still compiles) and
     * the host's `modules`, own keys only so `require("constructor")` cannot
     * reach `Object`. No relative
     * imports, since a dynamic node is one script, not a package.
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

    /** One key, one factory — see {@link addNode} for why. */
    private _claimed(key: string, factory: CommandFactory | VariableCommandFactory): boolean {
        const existing = this._commands.get(key);
        if (!existing) return false;
        if (existing.factory === factory) return true;
        throw new Error(
            `Command type "${key}" is already registered to a different factory. Keys must be unique.`,
        );
    }

    /**
     * A class's editable properties, read off its `property` declarations.
     *
     * The whole prototype chain, so a component publishes the box its tree's
     * base declares as well as its own entries — a host editing one edits every
     * control it actually has.
     */
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

    /** A component's `renamed` and `deprecated`, where a host reading the descriptor sees them. */
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

    /**
     * A type's dimension, read off the prototype without constructing one.
     *
     * `Node.dimension` is a getter rather than a field for exactly this reason —
     * it answers from the prototype, before any field initializer has run.
     */
    private _describeDimension(ctor: NodeConstructor): NodeDimension | undefined {
        const dimension = (Object.create(ctor.prototype) as Node).dimension;
        return typeof dimension === "string" ? dimension : undefined;
    }

    /** The trees a type takes children from, off the prototype as its dimension is. */
    private _describeHolds(ctor: NodeConstructor): readonly NodeDimension[] | undefined {
        const trees = (Object.create(ctor.prototype) as Partial<Node>)._childTrees;
        return Array.isArray(trees) ? [...trees] : undefined;
    }

    /**
     * The control a value's own type implies. Only ever a fallback: a typed
     * property states its kind, and a plain `property` may too.
     *
     * A function default is a *reactive binding*, not a value, so it says nothing
     * about the control; those declare their kind or take "unknown", which a host
     * draws as read-only rather than guessing.
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

    /** A command's arguments as descriptors, whichever shorthand they were written in. */
    private _describeArgs(args: readonly CommandArg[] | undefined): CommandArgDescriptor[] {
        return (args ?? []).map((arg) =>
            typeof arg === "string" ? { key: arg, kind: "unknown" } : { kind: "unknown", ...arg });
    }
}
