import type { Disposer } from "@/assets/record";
import type { AssetScope } from "@/assets/scope";
import { getPropertyMeta, property, type PropertyMeta } from "@/attributes/properties/decorator";
import type { FillResolved } from "@/attributes/shape/fill/union";
import type { ShadowResolved } from "@/attributes/shape/shadow/shadow";
import type { StrokeResolved } from "@/attributes/shape/stroke/stroke";
import { node } from "@/document/node-decorator";
import { declarePropEvolution } from "@/document/prop-evolution";
import type { Node } from "@/components/trees/node/node";
import { settling, type Command, type CommandArgs } from "@/tween/command";
import { command, type CommandArg } from "@/tween/command-decorator";
import type { EasingFunction } from "@/tween/ease/type";
import type { ContextMap } from "@/util/context";
import type { ChildView, Loader, Provided, StateSpec } from "@/components/factory/api";
import { commandOf, makeTimeline } from "@/components/factory/timeline";
import { defOf, isTypeLike, type TypeDef } from "@/components/factory/type-def";
import { nodeOfView, nodeView, snapshot, stateView, stateViewPrototype, type ViewShape } from "@/components/factory/views";

/**
 * What every factory does, whatever tree it builds for: declare the state on a
 * generated subclass of the tree's base, publish the commands, run the
 * `children` builder, provide and inherit context, and declare assets. Each
 * factory adds only its own tree's hooks on top.
 */

/** The fields every factory takes. */
export interface CoreSpec {
    readonly key: string;
    readonly state?: StateSpec;
    readonly defaults?: Record<string, unknown>;
    readonly renamed?: Readonly<Record<string, string>>;
    readonly deprecated?: Readonly<Record<string, string>>;
    readonly migrate?: Readonly<Record<string, (value: unknown) => unknown>>;
    readonly commands?: Record<string, unknown>;
    readonly children?: (state: never) => unknown;
    readonly provide?: (state: never, inherited: <T>(context: { readonly id: symbol; readonly defaultValue: T }) => T) => readonly Provided[];
    readonly load?: (loader: Loader, state: never) => void;
    /** `[]` takes none; `null` (the default) anything of its tree; components, or `"2d"`/`"3d"`/`"audio"`, only those. */
    readonly allowedChildren?: readonly unknown[] | null;
    /** The components it goes only inside; unsaid, wherever its tree allows. */
    readonly allowedParents?: readonly unknown[];
}

/** A spec, resolved against the base it lowers onto. */
export interface Lowering {
    readonly spec: CoreSpec;
    readonly entries: Map<string, TypeDef>;
    readonly defaults: Record<string, unknown>;
    readonly builtIn: ReadonlyMap<string, PropertyMeta>;
    readonly view: ViewShape;
    /** Built-in entries whose default a factory applies itself (a 2D size), not by redeclaring the property. */
    readonly ownsDefault: ReadonlySet<string>;
}

type NodeBase = abstract new (...args: any[]) => Node;

export function lowering(spec: CoreSpec, Base: NodeBase, ownsDefault: ReadonlySet<string> = new Set()): Lowering {
    const builtIn = new Map(getPropertyMeta(Object.create(Base.prototype as object)).map((m) => [m.key, m]));
    const entries = new Map<string, TypeDef>(Object.entries(spec.state ?? {}).map(([k, e]) => [k, defOf(e)]));
    const defaults = (spec.defaults ?? {}) as Record<string, unknown>;
    // A default for an own entry is that entry's default; for a built-in one, a redeclaration.
    for (const [key, value] of Object.entries(defaults)) {
        if (typeof value === "function") continue;
        const own = entries.get(key);
        if (own) entries.set(key, { ...own, default: value });
        else if (!builtIn.has(key)) throw new TypeError(`${spec.key}: "defaults.${key}" names no entry.`);
    }
    checkEvolution(spec, (key) => entries.has(key) || builtIn.has(key));
    // A reference entry holds an id; its fields read a view of the node it names.
    const references = new Set([...entries].filter(([, def]) => def.editor.kind === "nodeRef").map(([key]) => key));
    return { spec, entries, defaults, builtIn, view: stateViewPrototype([...builtIn.keys(), ...entries.keys()], references), ownsDefault };
}

export function factoryDefault(def: TypeDef): unknown {
    return typeof def.default === "function" ? (def.default as () => unknown)() : def.default;
}

/** The members every generated node has, whatever its tree. */
export interface ComponentNode extends Node {
    _view: object;
    /** How many nodes the `children` builder made. */
    _built: number;
    _commandChildren(): readonly ChildView[];
    _animate(frame: (t: number) => Record<string, unknown>, duration: number, easing: unknown): unknown;
}

/** The base every tree's generated class extends: `Base` with the spec's state, context, assets and children. */
export function componentBase<T extends NodeBase>(Base: T, l: Lowering): T & (abstract new (...args: any[]) => ComponentNode) {
    const { spec: s, entries, defaults } = l;

    abstract class Componentized extends (Base as unknown as abstract new (...args: any[]) => Node) implements Partial<ComponentNode> {
        declare _view: object;
        declare _built: number;
        declare _assembling: boolean;
        declare _provided: { parent: ContextMap; values: readonly Provided[]; map: ContextMap } | undefined;

        constructor(...args: any[]) {
            const props = args[0] as Record<string, unknown> | undefined;
            const given = s.children ? props?.children : undefined;
            super(s.children && props ? { ...props, children: undefined } : props);
            this._view = stateView(l.view, this);
            this._built = 0;

            for (const [key, def] of entries) {
                if (def.private) this.applyProp(key, factoryDefault(def), { mapper: def.mapper, tween: def.tween });
                else if (typeof def.default === "function" && props?.[key] === undefined) this._writeProp(key, factoryDefault(def));
            }
            let built: Readonly<Record<string, unknown>> | undefined;
            for (const [key, value] of Object.entries(defaults)) {
                if (typeof value === "function" && props?.[key] === undefined) {
                    const asBuilt = (built ??= Object.freeze({ ...props }));
                    this._writeProp(key, () => (value as (state: object, given: object) => unknown)(this._view, asBuilt));
                }
            }

            if (s.children) {
                // Live, like the field state, so a binding the builder writes reads the node as it changes.
                const builderState = stateView(l.view, this);
                const authored = [given ?? []].flat(Infinity).filter(Boolean);
                if (s.allowedChildren != null) for (const child of authored) this.assertAcceptsChild(child as Node);
                Object.defineProperty(builderState, "children", { value: authored });
                const built = [s.children(builderState as never)].flat(Infinity).filter(Boolean) as Node[];
                this._assembling = true;
                try {
                    for (const part of built) this.add(part);
                } finally {
                    this._assembling = false;
                }
                this._built = built.length;
            }
        }

        /** Each entry the author left unset that inherits takes what its ancestors provide, once, on first attach. */
        protected override resolveContext(ctx: ContextMap): void {
            super.resolveContext(ctx);
            const given = (this._props ?? {}) as Record<string, unknown>;
            const self = this as unknown as Record<string, unknown>;
            for (const [key, def] of entries) {
                if (!def.inherit || given[key] !== undefined) continue;
                const value = def.inherit((context) => ctx.get(context), given);
                if (value !== undefined) self[key] = value;
            }
        }

        protected override provideContext(parent: ContextMap): ContextMap {
            if (!s.provide) return super.provideContext(parent);
            const provided = s.provide(this._view as never, (context) => parent.get(context as never));
            // The same map while nothing changed, so the subtree isn't re-bound every attach.
            const memo = this._provided;
            if (memo && memo.parent === parent && memo.values.length === provided.length
                && memo.values.every((p, i) => p.context === provided[i].context && p.value === provided[i].value)) return memo.map;
            let map = parent;
            for (const { context, value } of provided) if (map.get(context) !== value) map = map.with(context, value);
            this._provided = { parent, values: provided, map };
            return map;
        }

        override declareAssets(assets: AssetScope): void {
            super.declareAssets(assets);
            const self = this as unknown as Record<string, unknown>;
            for (const [key, def] of entries) declareEntry(assets, def.editor.kind ?? "", self[key]);
            if (s.load) s.load(loaderOf(assets), this._view as never);
        }

        protected override acceptsChild(child: Node): boolean {
            const allowed = s.allowedChildren;
            if (allowed === undefined || allowed === null || (this._assembling && allowed.length === 0)) return super.acceptsChild(child);
            return allowed.some((rule) => matches(child, rule));
        }

        protected override _childRule(): string {
            const allowed = s.allowedChildren;
            if (!allowed) return super._childRule();
            return allowed.length === 0 ? "It takes no children." : `It takes only ${namesOf(allowed)}.`;
        }

        override _parentRefusal(parent: Node): string | null {
            const allowed = s.allowedParents;
            if (!allowed || allowed.some((rule) => matches(parent, rule))) return null;
            return `${this.className} goes only inside ${namesOf(allowed)}, not ${parent.className}.`;
        }

        /** The children a command's builders see: none, unless the tree says which. */
        _commandChildren(): readonly ChildView[] {
            return [];
        }

        _animate(frame: (t: number) => Record<string, unknown>, duration: number, easing: unknown) {
            return this.command(frame, duration, easing as EasingFunction | undefined);
        }
    }
    return Componentized as unknown as T & (abstract new (...args: any[]) => ComponentNode);
}

type CommandFn = (timeline: unknown, state: unknown, children: unknown) => never;

/**
 * Declare the state and commands on the generated class, register its key, and
 * hand back the component value.
 */
export function finishComponent(Generated: abstract new (...args: any[]) => Node, l: Lowering): object {
    const { spec: s, entries, defaults, builtIn } = l;
    Object.defineProperty(Generated, "name", { value: pascal(s.key) });
    const proto = Generated.prototype as unknown as Record<string, unknown>;
    // A node is a context provider by overriding these: only one that provides, or inherits, keeps them.
    if (!s.provide) deleteUpTo(proto, "provideContext");
    if (![...entries.values()].some((def) => def.inherit)) deleteUpTo(proto, "resolveContext");
    if (s.allowedChildren === undefined || s.allowedChildren === null) {
        deleteUpTo(proto, "acceptsChild");
        deleteUpTo(proto, "_childRule");
    }
    if (!s.allowedParents) deleteUpTo(proto, "_parentRefusal");
    const allowed = s.allowedChildren;
    if (allowed) {
        const trees = [...new Set(allowed.map((rule) => (typeof rule === "string"
            ? rule
            : (Object.create((rule as { node: { prototype: object } }).node.prototype) as Node).dimension)))];
        Object.defineProperty(proto, "_childTrees", { get: () => trees, configurable: true });
    }

    for (const [key, def] of entries) {
        if (def.private) continue;
        property({ default: typeof def.default === "function" ? undefined : def.default, mapper: def.mapper, tween: def.tween, ...def.editor })(proto, key);
    }
    for (const [key, value] of Object.entries(defaults)) {
        if (entries.has(key) || l.ownsDefault.has(key) || typeof value === "function") continue;
        const inherited = builtIn.get(key)!;
        property({ default: value, mapper: inherited.options?.mapper, tween: inherited.options?.tween, ...inherited.editor })(proto, key);
    }

    const base = Object.getPrototypeOf(Object.getPrototypeOf(proto)) as object;
    for (const [key, entry] of Object.entries(s.commands ?? {})) {
        // Commands have their own namespace: a key a node already uses (`remove`, `to`) publishes through another method name.
        const method = key in base ? `_command_${key}` : key;
        let args: CommandArg[] | undefined;
        const entrance = typeof entry === "object" && (entry as { entrance?: boolean }).entrance === true;
        if (typeof entry === "function") {
            proto[method] = function (this: ComponentNode, cmd: CommandArgs & { duration?: number } = {}): Command<Record<string, unknown>> {
                const duration = cmd.duration ?? 0;
                const timeline = makeTimeline({}, duration, cmd.easing, nodeView(this, this));
                const piece = (entry as CommandFn)(timeline, snapshot(this._view), this._commandChildren());
                return commandOf(this as never, piece, duration, cmd.easing);
            };
        } else {
            const { args: declared, run, easing: ownEasing } = entry as { args: readonly string[] | StateSpec; run?: CommandFn; easing?: EasingFunction };
            if (Array.isArray(declared)) {
                const names = declared as readonly string[];
                for (const name of names) {
                    if (!entries.has(name) && !builtIn.has(name)) throw new TypeError(`${s.key}.${key}: args names "${name}", which is no entry.`);
                }
                // Each arg is its entry: what a host shows for it is what the entry means.
                args = names.map((name) => ({ key: name, ...(entries.get(name)?.editor ?? builtIn.get(name)?.editor ?? {}) }));
                proto[method] = function (this: Node, cmd: CommandArgs & { duration?: number } = {}) {
                    const data = argsRecord(cmd.data, names);
                    const stated: Record<string, unknown> = {};
                    for (const name of names) if (data[name] !== undefined) stated[name] = data[name];
                    return settling(this.to({ data: stated as never, duration: cmd.duration ?? 0, easing: cmd.easing ?? ownEasing }));
                };
            } else {
                const own = declared as StateSpec;
                args = Object.entries(own).map(([k, e]) => {
                    const def = defOf(e);
                    return { key: k, default: isTypeLike(e) ? factoryDefault(def) : e, ...def.editor };
                });
                proto[method] = function (this: ComponentNode, cmd: CommandArgs & { duration?: number } = {}) {
                    const duration = cmd.duration ?? 0;
                    const easing = cmd.easing ?? ownEasing;
                    const timeline = makeTimeline(resolveArgs(own, cmd.data), duration, easing, nodeView(this, this));
                    const piece = run!(timeline, snapshot(this._view), this._commandChildren());
                    return commandOf(this as never, piece, duration, easing);
                };
            }
        }
        command({ key, ...(args ? { args } : {}), ...(entrance ? { entrance } : {}) })(proto, method);
    }

    if (s.renamed || s.deprecated || s.migrate) {
        declarePropEvolution(Generated, { renamed: s.renamed ?? {}, deprecated: s.deprecated ?? {}, migrate: s.migrate ?? {} });
    }
    node({ key: s.key })(Generated as never);
    return componentValue(s.key, Generated as unknown as new (props?: Record<string, unknown>) => object);
}

/** A rename lands on an entry from a key that is none; a deprecation and a hook name what is there to evolve. */
function checkEvolution(spec: CoreSpec, isEntry: (key: string) => boolean): void {
    for (const [from, to] of Object.entries(spec.renamed ?? {})) {
        if (isEntry(from)) throw new TypeError(`${spec.key}: "renamed.${from}" is still an entry; a renamed key must be gone.`);
        if (!isEntry(to)) throw new TypeError(`${spec.key}: "renamed.${from}" names "${to}", which is no entry.`);
    }
    for (const key of Object.keys(spec.deprecated ?? {})) {
        if (!isEntry(key)) throw new TypeError(`${spec.key}: "deprecated.${key}" names no entry.`);
    }
    for (const key of Object.keys(spec.migrate ?? {})) {
        if (!isEntry(key) && !Object.hasOwn(spec.renamed ?? {}, key)) {
            throw new TypeError(`${spec.key}: "migrate.${key}" names neither an entry nor a renamed key.`);
        }
    }
}

/** Remove the generated override of `name`, wherever between the class and its base it sits. */
function deleteUpTo(proto: Record<string, unknown>, name: string): void {
    for (let at: Record<string, unknown> | null = proto; at; at = Object.getPrototypeOf(at) as Record<string, unknown> | null) {
        if (Object.prototype.hasOwnProperty.call(at, name)) {
            delete at[name];
            return;
        }
    }
}

/**
 * What a factory hands back: call it (`Rect({...})`) or `new` it, either way a
 * node of the generated class, which is also what `instanceof` tests.
 */
export function componentValue(key: string, Generated: new (props?: Record<string, unknown>) => object): object {
    const make = function (props?: object) {
        return new Generated(props as Record<string, unknown>);
    };
    make.prototype = Generated.prototype;
    Object.defineProperty(make, "name", { value: Generated.name });
    return Object.assign(make, {
        key,
        node: Generated,
        is: (child: unknown) => nodeOfView(child as never) instanceof Generated,
    });
}

function pascal(key: string): string {
    return key.replace(/(^|[-_ ])(\w)/g, (_, _sep, c: string) => c.toUpperCase());
}

/** Whether `node` is of `rule`: a component, or a whole tree by name. */
function matches(node: Node, rule: unknown): boolean {
    return typeof rule === "string"
        ? node.dimension === rule
        : node instanceof (rule as { node: abstract new (...args: never[]) => unknown }).node;
}

function namesOf(rules: readonly unknown[]): string {
    const names = rules.map((rule) => (typeof rule === "string" ? `any ${rule.toUpperCase()} node` : (rule as { node: { name: string } }).node.name));
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** One document arg: the bare value from a paint command, or the args record from the registry. */
function argsRecord(data: unknown, names: readonly string[]): Record<string, unknown> {
    if (names.length === 1) {
        const plain = typeof data === "object" && data !== null && !Array.isArray(data) && Object.getPrototypeOf(data) === Object.prototype;
        if (!(plain && names[0] in (data as object))) return { [names[0]]: data };
    }
    return (data ?? {}) as Record<string, unknown>;
}

function resolveArgs(spec: StateSpec, data: unknown): Record<string, unknown> {
    const given = (data ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key in spec) {
        const def = defOf(spec[key]);
        const value = given[key] === undefined ? factoryDefault(def) : given[key];
        out[key] = def.mapper ? def.mapper(value) : value;
    }
    return out;
}

function declareEntry(assets: AssetScope, kind: string, value: unknown): void {
    if (value === undefined || value === null || value === "") return;
    switch (kind) {
        case "fills": return assets.fill(value as FillResolved[]);
        case "strokes": for (const stroke of value as StrokeResolved[]) assets.fill(stroke.fill); return;
        case "shadows": for (const shadow of value as ShadowResolved[]) assets.fill(shadow.fill); return;
        case "image": return assets.image(value as string);
        case "video": return assets.video(value as string);
        case "font": return assets.font(value as string);
    }
}

/** One wrapper per load function: the scope warns when a key's second declaration hands it a different one. */
const tasks = new WeakMap<() => Promise<unknown>, () => Promise<void | Disposer>>();

function taskOf(load: () => Promise<unknown>): () => Promise<void | Disposer> {
    let task = tasks.get(load);
    if (!task) {
        task = async () => {
            const loaded = await load();
            return typeof loaded === "function" ? (loaded as Disposer) : undefined;
        };
        tasks.set(load, task);
    }
    return task;
}

function loaderOf(assets: AssetScope): Loader {
    return {
        font: (family, weight) => assets.font(family, weight),
        image: (src) => assets.image(src),
        video: (src, trim) => assets.video(src, trim),
        task: (key, load, options) => assets.loader(key, taskOf(load), { gate: options?.before === "layout" ? "layout" : "render" }),
        fill: (fills) => assets.fill(fills),
    };
}
