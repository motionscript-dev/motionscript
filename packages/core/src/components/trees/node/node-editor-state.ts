import { Node } from "./node";

/** What an editor says about one node, as against the document. Neither field is a prop (not authored, no tweening, not part of the scene's meaning: an exported frame is the same whether or not a layer was folded away); they arrive on the side and are applied over the tree. */
export interface NodeEditorState {
    /** Hides the node and everything under it: no paint, no pick, no layout slot (a hidden child of a row gives up its cell and gap, like `display: none`). The node **stays in the tree**, since dropping it would renumber later siblings' structural paths, which a host's boxes, lifespans and picking are keyed on. */
    hidden?: boolean;
    /** Takes the node out of reach of the pointer, picture untouched (Figma's padlock). Not a weaker {@link hidden}: a locked node still draws, lays out and confines its children, and only declines being the answer to a pick. Its children stay pickable, as locking a group is about the group. */
    locked?: boolean;
}

/** Editor state for a whole tree, keyed by {@link Node.key}; a record so the applying walk's per-node ask isn't a scan. */
export type NodeEditorStates = Record<string, NodeEditorState>;

/** Pushes `states` onto the tree under `root`, resolved onto the nodes so `render` and the pick walk read a local field. Called once per frame from `ClipInstance.attach` (after the tree is built, before layout), so a node appearing this frame gets its state this frame. A node with no `key`, or an unmentioned one, is reset: the record is the whole truth, so a dropped key is an unhidden node. */
export function applyEditorStates(root: Node, states: NodeEditorStates | undefined): void {
    const walk = (node: Node): void => {
        const state = node.key !== undefined ? states?.[node.key] : undefined;
        node._setEditorState(state?.hidden === true, state?.locked === true);
        for (const child of node._allChildren) walk(child);
    };
    walk(root);
}
