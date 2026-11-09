import type { Registry } from "./registry";
import { ROOT_NODE_ID, type NodeSpec } from "./types";

/**
 * Where a node type may go, read off the registry without building anything:
 * the answer a host needs before it offers a type under a parent, accepts a
 * drop, or lets an assistant create a row.
 *
 * Four things decide it. A parent that takes no children takes none. The two
 * trees do not mix: a `Node3D` lives under a Canvas 3D or another 3D node, and
 * nothing else does. A type that names where it goes ({@link
 * NodeTypeDescriptor.within}) goes only there, and a {@link
 * NodeTypeDescriptor.closed} parent takes only the types that name it. Those
 * are about the parent; {@link NodeTypeDescriptor.beside} is about the
 * siblings, and is kept apart because a host can meet it by adding one.
 *
 * Only a leaf is enforced when a document is built: a component declaring
 * `allowedChildren: []` throws on a child. A node in any other wrong place
 * builds and, as a rule, draws nothing; this says why.
 */

/** Why a node of a type is not where it can work. */
export type PlacementIssue =
    /** The parent takes no children. */
    | { kind: "leaf"; parent: string }
    /** A 3D node outside a 3D tree, or anything else inside one. */
    | { kind: "dimension"; parent: string | null }
    /** It goes inside one of `within`, and the parent is none of them. */
    | { kind: "within"; within: readonly string[] }
    /** The parent takes only the types that name it. */
    | { kind: "closed"; parent: string }
    /** It needs one of `beside` under the same parent, and there is none. */
    | { kind: "beside"; beside: readonly string[] };

export interface PlacementOptions {
    /**
     * A host's own sense of one type standing for another, beside the
     * registry's: a copy of a component it made under a new key is still that
     * component to whatever goes inside it.
     */
    isA?: (type: string, name: string) => boolean;
}

/** The one core type whose children are of the other dimension. */
const CANVAS_3D = "canvas3d";

/** Whether `type` is `name`, or is built on it through `parentKey`. */
export function nodeTypeIsA(registry: Registry, type: string, name: string): boolean {
    const seen = new Set<string>();
    for (let at: string | undefined = type; at !== undefined && !seen.has(at); at = registry.describe(at)?.parentKey) {
        if (at === name) return true;
        seen.add(at);
    }
    return false;
}

function among(registry: Registry, type: string, names: readonly string[], options: PlacementOptions): boolean {
    return names.some((name) => nodeTypeIsA(registry, type, name) || options.isA?.(type, name) === true);
}

/**
 * Why a node of `child` cannot go directly inside one of `parent`, or `null`
 * when it can. A `null` parent is the document's own root, which is 2D and
 * names nothing.
 */
export function parentIssue(
    registry: Registry,
    child: string,
    parent: string | null,
    options: PlacementOptions = {},
): PlacementIssue | null {
    const own = registry.describe(child);
    const holder = parent === null ? undefined : registry.describe(parent);
    if (parent !== null && (holder?.layout?.acceptsChildren === false || holder?.holds?.length === 0)) return { kind: "leaf", parent };

    const within = own?.within ?? [];
    if (within.length > 0 && (parent === null || !among(registry, parent, within, options))) {
        return { kind: "within", within };
    }
    if (parent !== null && holder?.closed === true && !among(registry, parent, within, options)) {
        return { kind: "closed", parent };
    }

    const inThree = parent !== null && (holder?.dimension === "3d" || holder?.holds?.includes("3d") === true || among(registry, parent, [CANVAS_3D], options));
    if ((own?.dimension === "3d") !== inThree) return { kind: "dimension", parent };
    return null;
}

/** The sibling `child` needs that `siblings`, the types already under its parent, do not include; `null` when it needs none or has one. */
export function siblingIssue(
    registry: Registry,
    child: string,
    siblings: readonly string[],
    options: PlacementOptions = {},
): PlacementIssue | null {
    const beside = registry.describe(child)?.beside ?? [];
    if (beside.length === 0 || siblings.some((type) => among(registry, type, beside, options))) return null;
    return { kind: "beside", beside };
}

/**
 * Every node of `nodes` that is not where its type says it goes, by id, with
 * the first reason. A node of an unregistered type is left out: that is a build
 * error, and says so itself.
 */
export function placementIssues(
    registry: Registry,
    nodes: readonly Pick<NodeSpec, "id" | "type" | "parentId">[],
    options: PlacementOptions = {},
): Map<string, PlacementIssue> {
    // A document may write its stage as a row or leave it out: either way its children's parent is the root.
    const parentOf = (node: Pick<NodeSpec, "parentId">) => (node.parentId === ROOT_NODE_ID ? null : node.parentId);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const children = new Map<string | null, string[]>();
    for (const node of nodes) {
        if (node.id === ROOT_NODE_ID) continue;
        const under = children.get(parentOf(node));
        if (under) under.push(node.type);
        else children.set(parentOf(node), [node.type]);
    }
    const issues = new Map<string, PlacementIssue>();
    for (const node of nodes) {
        if (node.id === ROOT_NODE_ID || !registry.hasNode(node.type)) continue;
        const parentId = parentOf(node);
        const parentType = parentId === null ? null : (byId.get(parentId)?.type ?? null);
        const issue =
            parentIssue(registry, node.type, parentType, options) ??
            siblingIssue(registry, node.type, without(children.get(parentId) ?? [], node.type), options);
        if (issue) issues.set(node.id, issue);
    }
    return issues;
}

// The node's own type once: a second area is a sibling of the first, the first is not its own.
function without(types: readonly string[], own: string): string[] {
    const at = types.indexOf(own);
    return at === -1 ? [...types] : [...types.slice(0, at), ...types.slice(at + 1)];
}
