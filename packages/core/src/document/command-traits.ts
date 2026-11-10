import { Node } from "@/components/trees/node/node";
import { expressionOps } from "./expression/ops";
import { Registry, type NodeConstructor } from "./registry";
import type { CommandSpec, NodeSpec } from "./types";
import { ROOT_NODE_ID } from "./types";

/**
 * What a command can do to the tree around it, read off the document and the
 * registry without building anything.
 *
 * Only the library's own implementations are described: a command resolving to a
 * component's method could do anything, so it is `known: false` and assumed to
 * read and write layout.
 */
export interface CommandTraits {
    scope: "node" | "variable";
    /** Resolves to the library's own implementation, so the rules below hold for it. */
    known: boolean;
    lifecycle: boolean;
    /** Building it can read a laid-out box, so it must be built against a settled tree. */
    readsLayout: boolean;
    /** Running it can change what layout computes. */
    writesLayout: boolean;
}

/** The nine named alignment props, which position a node against its own laid-out box. */
export const ALIGNMENT_KEYS: readonly string[] = [
    "center", "topLeft", "topRight", "bottomLeft", "bottomRight",
    "topCenter", "bottomCenter", "centerLeft", "centerRight",
];

const SKIPPED: CommandTraits = { scope: "node", known: true, lifecycle: false, readsLayout: false, writesLayout: false };

/**
 * How a document command resolves, as `ClipTimeline._buildPlaced` resolves it,
 * and what it does — or `null` when it resolves to nothing (compiling it throws).
 * One the build skips — aimed at a placeholder, or unpublished by its target's
 * type — writes nothing, which is known.
 * `target` is the command's target row; for `targetId: null` a document with no
 * explicit root row may pass `undefined`.
 */
export function commandTraits(registry: Registry, spec: CommandSpec, target: NodeSpec | undefined): CommandTraits | null {
    const lifecycle = LIFECYCLE.has(spec.type);
    const global = registry.command(spec.type);
    if (global?.scope === "variable") {
        const known = VARIABLE_COMMANDS.has(spec.type);
        return { scope: "variable", known, lifecycle, readsLayout: !known, writesLayout: false };
    }

    const row = target ?? (spec.targetId === null ? DEFAULT_ROOT : undefined);
    const record = row ? registry.node(row.type) : undefined;
    if (!row) return null;
    if (!record) return registry.strict ? null : SKIPPED;

    let chain: readonly string[] | undefined;
    if (global) {
        chain = GLOBAL_NODE_COMMANDS[spec.type];
        if (chain && typeof methodOf(record.ctor, chain[0]) !== "function") return null;
    } else {
        const entry = record.commands.get(spec.type);
        if (!entry) return registry.strict ? null : SKIPPED;
        // A method published under a core command's key is not the core command.
        chain = entry.method === spec.type ? NODE_COMMANDS[spec.type] : undefined;
    }

    const known = !lifecycle && chain !== undefined && implementsCore(record.ctor, chain);
    if (!known) return { scope: "node", known, lifecycle, readsLayout: true, writesLayout: true };

    const args = spec.args ?? {};
    const props = row.props ?? {};
    const written = writtenKeys(spec.type, args);
    return {
        scope: "node",
        known,
        lifecycle,
        readsLayout: readsLayout(spec.type, args, props, written),
        writesLayout: written === undefined || written.some((key) => !isLayoutNeutralProp(registry, row.type, key)),
    };
}

/**
 * Whether a command with these traits, built, may be held at its end values once
 * finished instead of run (`settled-index.ts`): the library's own implementation
 * of a command whose `at` reads only what it captured when built. Expression args
 * bind live values, so they keep it running. A component's own commands are
 * marked by the factory instead, from their pieces.
 */
export function holdsWhenFinished(traits: CommandTraits | null, spec: CommandSpec): boolean {
    return traits !== null && traits.known && !traits.lifecycle && HELD.has(spec.type)
        && expressionOps.collect(spec.args ?? {}, "").length === 0;
}

/**
 * The node ids a command's args name through a `nodeRef` argument — the nodes
 * whose boxes it may read when it is built, beside its own target.
 */
export function commandNodeRefs(registry: Registry, spec: CommandSpec, target: NodeSpec | undefined): string[] {
    const global = registry.command(spec.type);
    const row = target ?? (spec.targetId === null ? DEFAULT_ROOT : undefined);
    const descriptors = global
        ? (global.scope === "node" ? global.args : undefined)
        : row ? registry.node(row.type)?.commands.get(spec.type)?.args : undefined;
    const refs: string[] = [];
    for (const descriptor of descriptors ?? []) {
        const value = spec.args?.[descriptor.key];
        if (descriptor.kind === "nodeRef" && typeof value === "string" && value !== "") refs.push(value);
    }
    return refs;
}

/** Whether `type` hands its descendants a context of its own. */
export function isContextProvider(registry: Registry, type: string): boolean {
    const ctor = registry.node(type)?.ctor;
    return ctor !== undefined && methodOf(ctor, "provideContext") !== methodOf(Node, "provideContext");
}

/**
 * Whether an authored value holds an expression reading another node's prop
 * (`[card.x]`), at any depth. An unparsable one counts: it fails the build anyway.
 */
export function hasNodeRef(value: unknown): boolean {
    for (const site of expressionOps.collect(value, "")) {
        const parsed = expressionOps.tryParse(site.source);
        if ("error" in parsed || parsed.expression.refs.some((ref) => ref.includes("."))) return true;
    }
    return false;
}

/**
 * Whether writing `key` on a node of `type` leaves every laid-out box unchanged.
 *
 * Every node's placement is applied after layout; past that, answered only for
 * the library's own classes, since a custom node may lay itself out from anything.
 */
export function isLayoutNeutralProp(registry: Registry, type: string, key: string): boolean {
    const record = registry.node(type);
    if (!record) return false;
    // Sound has no box, and the 2D walk skips an audio child.
    if (record.descriptor.dimension === "audio") return true;
    if (isPlacementProp(registry, type, key)) return true;
    return coreLibrary().ctors.has(record.ctor) && NEUTRAL_KEYS.has(key);
}

/** Whether `key` is placement every node of `type` holds as a plain slot, read only once a frame is drawn. */
export function isPlacementProp(registry: Registry, type: string, key: string): boolean {
    const dimension = registry.node(type)?.descriptor.dimension;
    return dimension === "3d" ? PLACEMENT_3D.has(key) : dimension === "2d" && PLACEMENT_2D.has(key);
}

/**
 * Whether a new `key` on `row` can be written onto its live node as a fresh
 * build would set it: placement, on a row with no prop its node turns into
 * placement when built (`topLeft` binds `x` and `y`).
 */
export function writesPlacementInPlace(registry: Registry, row: NodeSpec, key: string): boolean {
    const dimension = registry.node(row.type)?.descriptor.dimension;
    const sugar = dimension === "3d" ? PLACEMENT_SUGAR_3D : PLACEMENT_SUGAR_2D;
    return isPlacementProp(registry, row.type, key) && !Object.keys(row.props).some((prop) => sugar.has(prop));
}

const LIFECYCLE = new Set(["removeChildAt", "addChildAt", "reparent"]);

const VARIABLE_COMMANDS = new Set(["variableTo", "variableSet"]);

// Known commands that are pure functions of `t`. A new one joins once `held-class-commands.test.ts` covers it.
const HELD = new Set([
    "to", "set", "moveTo", "fadeTo", "rotateTo", "scaleTo", "layoutTo", "effectTo", "pulse", "wiggle",
    "fillTo", "strokeTo", "shadowTo", "overlayTo", "progressTo", "zoomTo", "panTo", "headingTo",
    "variableTo", "variableSet",
]);

const NEUTRAL_KEYS = new Set([
    "x", "y", "rotation", "scale", "opacity", "fill", "stroke", "shadow", "overlay",
    "effects", "blend", "transformOrigin", "zoom", "lookAt", "heading",
]);

const PLACEMENT_2D = new Set(["x", "y", "rotation", "scale", "opacity"]);

const PLACEMENT_3D = new Set(["x", "y", "z", "rotationX", "rotationY", "rotationZ", "scaleX", "scaleY", "scaleZ"]);

const PLACEMENT_SUGAR_2D = new Set([
    "center", "topLeft", "topRight", "bottomLeft", "bottomRight", "topCenter", "bottomCenter", "centerLeft", "centerRight",
]);

const PLACEMENT_SUGAR_3D = new Set(["position", "rotation", "scale"]);

const DEFAULT_ROOT: NodeSpec = { id: ROOT_NODE_ID, type: "canvas2d", parentId: null, layerOrder: 0, props: {} };

// Each command's behaviour, as the methods on its target it runs through. A class
// overriding any of them is running something else under the command's name.
const TO = ["to", "_prepareStep", "_writeProp"];
const PAINT = ["command", "set", "_writeProp"];

const GLOBAL_NODE_COMMANDS: Readonly<Record<string, readonly string[]>> = {
    to: TO,
    set: ["set", "_writeProp"],
    save: ["save"],
    fillTo: ["fillTo", ...PAINT],
    overlayTo: ["overlayTo", ...PAINT],
    strokeTo: ["strokeTo", ...PAINT],
    shadowTo: ["shadowTo", ...PAINT],
};

const NODE_COMMANDS: Readonly<Record<string, readonly string[]>> = {
    ...GLOBAL_NODE_COMMANDS,
    restore: ["restore", "_prepareStep", "_writeProp"],
    fadeTo: ["fadeTo", ...TO],
    rotateTo: ["rotateTo", ...TO],
    scaleTo: ["scaleTo", ...TO],
    layoutTo: ["layoutTo", ...TO],
    effectTo: ["effectTo", ...TO],
    progressTo: ["progressTo", ...TO],
    pulse: ["pulse", ...PAINT],
    wiggle: ["wiggle", ...PAINT],
    flash: ["flash", ...PAINT],
    moveTo: ["moveTo", ...TO, "command", "set"],
    zoomTo: ["zoomTo", ...TO],
    panTo: ["panTo", ...TO],
    headingTo: ["headingTo", ...TO],
    countTo: ["countTo", ...TO],
    append: ["append", ...TO],
    prepend: ["prepend", ...TO],
    // Plays its node's sound: scheduled ahead of time, writing nothing.
    play: ["play"],
};

/** Named commands' writes. `to`/`set` write their args; absent means "anything". */
const WRITES: Readonly<Record<string, readonly string[]>> = {
    fadeTo: ["opacity"],
    rotateTo: ["rotation"],
    scaleTo: ["scale"],
    layoutTo: ["width", "height", "padding"],
    effectTo: ["effects"],
    progressTo: ["start", "end"],
    pulse: ["scale"],
    wiggle: ["rotation"],
    flash: ["start", "end"],
    moveTo: ["x", "y"],
    zoomTo: ["zoom"],
    panTo: ["lookAt"],
    headingTo: ["heading"],
    fillTo: ["fill"],
    overlayTo: ["overlay"],
    strokeTo: ["stroke"],
    shadowTo: ["shadow"],
    play: [],
};

/** What a known command reads `from` — every command but the stamps. */
const READS_FROM = new Set(Object.keys(NODE_COMMANDS).filter((type) => type !== "set" && type !== "save"));

function readsLayout(
    type: string,
    args: Record<string, unknown>,
    props: Record<string, unknown>,
    written: readonly string[] | undefined,
): boolean {
    // Resolved against the node's own box the moment the step is prepared.
    if (hasAlignmentKey(args)) return true;
    // Aimed at another node's box.
    if (type === "moveTo" && typeof args.target === "string" && args.target !== "") return true;
    // An alignment-authored node's x/y are bindings over its box, and a node-ref
    // expression may read another node's (`[card.x]` on an aligned card); taking a
    // `from`, or a snapshot, evaluates them.
    const aligned = hasAlignmentKey(props);
    const refBound = nodeRefKeys(props);
    if (type === "save" || type === "restore") return aligned || refBound.size > 0;
    if (!READS_FROM.has(type)) return false;
    const touched = type === "append" || type === "prepend" ? ["text"] : type === "countTo" ? ["value"] : written ?? [];
    return touched.some((key) => refBound.has(key) || (aligned && (key === "x" || key === "y")));
}

function writtenKeys(type: string, args: Record<string, unknown>): readonly string[] | undefined {
    const named = WRITES[type];
    if (named) return named;
    if (type !== "to" && type !== "set") return undefined;
    const keys: string[] = [];
    for (const key of Object.keys(args)) {
        if (key === "size") keys.push("width", "height");
        else if (type === "to" && key === "pivot") keys.push("transformOrigin");
        else if (type === "to" && ALIGNMENT_KEYS.includes(key)) keys.push("x", "y", "transformOrigin");
        else keys.push(key);
    }
    return keys;
}

function hasAlignmentKey(values: Record<string, unknown>): boolean {
    return ALIGNMENT_KEYS.some((key) => values[key] !== undefined);
}

const REF_KEYS = new WeakMap<object, ReadonlySet<string>>();

/** The top-level props of a row whose authored value reads another node. */
function nodeRefKeys(props: Record<string, unknown>): ReadonlySet<string> {
    let keys = REF_KEYS.get(props);
    if (!keys) {
        const found = new Set<string>();
        for (const key of Object.keys(props)) {
            if (hasNodeRef(props[key])) found.add(key);
        }
        REF_KEYS.set(props, (keys = found));
    }
    return keys;
}

function methodOf(ctor: abstract new (...args: never[]) => unknown, name: string): unknown {
    return (ctor.prototype as Record<string, unknown>)[name];
}

const KNOWN = new WeakMap<object, Map<readonly string[], boolean>>();

function implementsCore(ctor: NodeConstructor, chain: readonly string[]): boolean {
    let byChain = KNOWN.get(ctor);
    if (!byChain) KNOWN.set(ctor, (byChain = new Map()));
    let known = byChain.get(chain);
    if (known === undefined) {
        // A method the class lacks entirely is not an override of one.
        known = chain.every((name) => {
            const impl = methodOf(ctor, name);
            return impl === undefined || coreImplementations(name).has(impl);
        });
        byChain.set(chain, known);
    }
    return known;
}

interface CoreLibrary {
    ctors: ReadonlySet<NodeConstructor>;
    methods: Map<string, ReadonlySet<unknown>>;
}

let core: CoreLibrary | null = null;

function coreLibrary(): CoreLibrary {
    if (!core) {
        // A registry seeds itself with exactly what the library ships, so a fresh one is that list.
        const seeded = new Registry();
        core = { ctors: new Set(seeded.nodeKeys().map((key) => seeded.node(key)!.ctor)), methods: new Map() };
    }
    return core;
}

/** Every body the library's classes give `name`, base classes included. */
function coreImplementations(name: string): ReadonlySet<unknown> {
    const library = coreLibrary();
    let impls = library.methods.get(name);
    if (!impls) {
        const found = new Set<unknown>();
        for (const ctor of library.ctors) {
            for (let proto = ctor.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
                const own = Object.getOwnPropertyDescriptor(proto, name);
                if (own && typeof own.value === "function") found.add(own.value);
            }
        }
        library.methods.set(name, (impls = found));
    }
    return impls;
}
