import type { NodeTypeDescriptor } from "./node-descriptor";

/** Symbol under which `node` metadata is stored on a class prototype. */
export const NODE_META = Symbol("nodeMeta");

/**
 * Declare a node class's document key — and nothing else.
 *
 * **It does not register.** Registration happens when the class is handed to a
 * `Registry` (`new Engine(platform, { nodes: [Blob] })`), because a registry is
 * a value an engine owns rather than a table the module graph writes into. A
 * declaration that registered made the *order modules happened to be imported in*
 * part of the engine's state: whichever host loaded first won the key, a second
 * engine in the same process inherited a vocabulary it never asked for, and a
 * class that was merely imported was already registered whether or not anything
 * meant to offer it.
 *
 * What is left is a declaration, read back by {@link getNodeDescriptor}. A
 * component factory makes it for the class it generates (`component2d({ key })`);
 * a hand-written class makes it itself:
 *
 * ```ts
 * class Blob extends Node2D<BlobProps> {
 *     declare readonly wobble: number;
 *     wobbleTo(args: CommandArgs<{ wobble: number }>) { … }
 * }
 * declareMembers(Blob, {
 *     wobble: property({ default: 0.4 }),
 *     wobbleTo: command({ args: ["wobble"] }),
 * });
 * node("blob")(Blob);
 *
 * const registry = new Registry({ nodes: [Blob] });
 * // { "type": "blob", "props": { "wobble": 0.4 } }
 * ```
 *
 * The full form declares everything a host needs to *offer* the type — the
 * shelves it sits on, how it lays children out, what a freshly placed one is
 * seeded with — which is what a component package used to restate in a
 * `manifest.json` beside a class nothing checked it against:
 *
 * ```ts
 * node({
 *     key: "lineChart",
 *     forkable: true,
 *     layout: { children: "freeform", acceptsChildren: true },
 *     seed: { width: 760, height: 460 },
 * })(LineChart);
 * ```
 *
 * None of it is read while rendering — see {@link NodeTypeDescriptor}.
 *
 * **The key is written out, not taken from the class name.** A minifier is free
 * to rename `Blob` to `o`, and the key is what stored documents contain — so a
 * derived one would work in development and silently rewrite every document's
 * vocabulary in a production bundle. It is public API, and spelled like it.
 */
export function node(type: string | NodeTypeDescriptor) {
    // Deliberately looser than `NodeConstructor`, which takes a bare
    // `Record<string, unknown>`: a real node class declares its own props type,
    // and requiring assignability would reject exactly the classes this exists
    // for.
    return function <T extends new (...args: never[]) => object>(ctor: T): T {
        const descriptor: NodeTypeDescriptor = typeof type === "string" ? { key: type } : type;
        (ctor.prototype as Record<symbol, unknown>)[NODE_META] = descriptor;
        return ctor;
    };
}

/**
 * What `node` declared on this exact class, or `undefined`.
 *
 * Own prototype only, deliberately: a subclass inherits its parent's methods but
 * not its identity, and a `Card extends Rect` that answered to `"rect"` would
 * collide with the real one the moment both were registered.
 */
export function getNodeDescriptor(ctor: new (...args: never[]) => object): NodeTypeDescriptor | undefined {
    const proto = ctor.prototype as Record<symbol, unknown> | undefined;
    if (!proto || !Object.prototype.hasOwnProperty.call(proto, NODE_META)) return undefined;
    return proto[NODE_META] as NodeTypeDescriptor;
}
