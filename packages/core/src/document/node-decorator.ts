import type { NodeTypeDescriptor } from "./node-descriptor";

export const NODE_META = Symbol("nodeMeta");

/**
 * Declare a node class's document key, and nothing else. It does not register: registration happens when the
 * class is handed to a `Registry` (`new Engine(platform, { nodes: [Blob] })`), so the order modules happened
 * to be imported in is never part of engine state.
 *
 * A component factory makes this for the class it generates (`component2d({ key })`); a hand-written class
 * calls `node("blob")(Blob)` itself.
 *
 * The full form (`node({ key, forkable, layout, seed })`) declares what a host needs to offer the type; none
 * of it is read while rendering (see {@link NodeTypeDescriptor}).
 *
 * The key is written out, not taken from the class name: a minifier may rename `Blob` to `o`, and stored
 * documents contain the key, so a derived one would silently rewrite every document's vocabulary in a
 * production bundle.
 */
export function node(type: string | NodeTypeDescriptor) {
    /**
     * Looser than `NodeConstructor`: a real node class declares its own props type, and requiring assignability
     * would reject the classes this exists for.
     */
    return function <T extends new (...args: never[]) => object>(ctor: T): T {
        const descriptor: NodeTypeDescriptor = typeof type === "string" ? { key: type } : type;
        (ctor.prototype as Record<symbol, unknown>)[NODE_META] = descriptor;
        return ctor;
    };
}

/**
 * Own prototype only: a subclass inherits its parent's methods but not its identity, and a `Card extends Rect`
 * answering to `"rect"` would collide with the real one.
 */
export function getNodeDescriptor(ctor: new (...args: never[]) => object): NodeTypeDescriptor | undefined {
    const proto = ctor.prototype as Record<symbol, unknown> | undefined;
    if (!proto || !Object.prototype.hasOwnProperty.call(proto, NODE_META)) return undefined;
    return proto[NODE_META] as NodeTypeDescriptor;
}
