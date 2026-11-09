import { Node } from "./node";

/**
 * What an editor says about one node, as against what the document says.
 *
 * Neither of these is a prop. They are not authored values, they do not tween,
 * they are not part of the scene's meaning — an exported frame is the same
 * whether or not the person who made it had a layer folded away. They are the
 * editor's view of the tree, so they arrive on the side and are applied over it.
 */
export interface NodeEditorState {
    /**
     * Hide the node and everything under it: no paint, no pick, and no layout
     * slot — a hidden child of a row gives up its cell and its gap, the way
     * `display: none` does rather than `visibility: hidden`.
     *
     * The node **stays in the tree**. Dropping it instead would renumber every
     * later sibling's structural path, which is what a host's boxes, its
     * lifespans and its picking are all keyed on.
     */
    hidden?: boolean;
    /**
     * Take the node out of reach of the pointer while leaving the picture
     * untouched — Figma's padlock.
     *
     * Not the opposite of {@link hidden} and not a weaker form of it. A locked
     * node still draws, still lays out, and still confines its children; what it
     * declines is being the *answer* to a pick. Its children stay pickable,
     * because locking a group is about the group.
     */
    locked?: boolean;
}

/**
 * Editor state for a whole tree, keyed by {@link Node.key}.
 *
 * A record rather than a list: the walk that applies it asks once per node, and
 * a host with a thousand-node scene should not pay a scan for each.
 */
export type NodeEditorStates = Record<string, NodeEditorState>;

/**
 * Push `states` onto the tree under `root`.
 *
 * Resolved onto the nodes rather than consulted from them, so `render` and the
 * pick walk read a local field instead of probing a record they would first have
 * to reach the scene to find. Called once per frame from `ClipInstance.attach`, which
 * is after the tree is built and before it is laid out — a node that appeared
 * this frame therefore gets its state on the same frame it appears.
 *
 * A node with no `key`, or a key the record does not mention, is reset rather
 * than left alone: the record is the whole truth about editor state, so a key
 * dropped from it is a node unhidden.
 */
export function applyEditorStates(root: Node, states: NodeEditorStates | undefined): void {
    const walk = (node: Node): void => {
        const state = node.key !== undefined ? states?.[node.key] : undefined;
        node._setEditorState(state?.hidden === true, state?.locked === true);
        for (const child of node._allChildren) walk(child);
    };
    walk(root);
}
