import { nodePath } from "@/project/tree";
import type { AssetScope } from "@/assets/scope";
import type { Node } from "./node";

/**
 * The subtree traversals the runtime drives, as free functions over a {@link Node}:
 * what is left on `Node` is what a node *is*, and what is here is what the engine
 * *does to* one. Every walk stops at an unmounted node — see {@link Node.mounted}.
 *
 * @internal
 */

/**
 * Declare one node's own assets — never its children's, so each node's
 * declarations stay attributable to it.
 */
export function declareNode(node: Node, scope: AssetScope): void {
    node.declareAssets(scope);
}

/** {@link declareNode} over `root` and every mounted descendant, in every dimension. */
export function declareTree(root: Node, scope: AssetScope): void {
    if (!root.mounted) return;
    declareNode(root, scope);
    const children = root._allChildren;
    for (let i = 0; i < children.length; i++) declareTree(children[i], scope);
}

/**
 * Visit `root` and every mounted descendant with its structural path.
 *
 * Indexed over every dimension's children, so a path does not shift when a sibling
 * of another dimension comes or goes the way a filtered `children` index would.
 */
export function forEachOwner(root: Node, visit: (node: Node, path: string) => void): void {
    visitOwners(root, "", visit);
}

function visitOwners(node: Node, path: string, visit: (node: Node, path: string) => void): void {
    if (!node.mounted) return;
    visit(node, path);
    const children = node._allChildren;
    for (let i = 0; i < children.length; i++) visitOwners(children[i], nodePath(path, i), visit);
}

/**
 * Bind `node` with `host`'s catalog, context and clock without adopting it — what a
 * runtime passes as `AssetDeclaration`'s `bindSubtree` for a `Tex.surface` source.
 */
export function bindDetached(host: Node, node: Node): void {
    (host as unknown as { attachDetached(node: Node): void }).attachDetached(node);
}

/**
 * Sample every node's derived render state (currently motion) for this frame.
 *
 * Normally done by `attach` as it advances the clock; this is the seam for the
 * priming path, which needs the same state seeded without moving time (see
 * `StateEvaluator.resetSlot`).
 */
export function sampleTree(node: Node): void {
    node._sample();
    for (const child of node.children) sampleTree(child);
}

/**
 * Record the subtree's current positions as the motion history's previous frame,
 * stamped `at`, deriving no velocity.
 *
 * The driven path calls this with the props evaluated one frame back, so the
 * {@link sampleTree} that follows measures against the timeline rather than
 * against wherever the playhead happened to be.
 */
export function primeMotionTree(node: Node, at: number): void {
    node._primeMotion(at);
    for (const child of node.children) primeMotionTree(child, at);
}
