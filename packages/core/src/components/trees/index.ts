// The two halves of the tree: the dimension-agnostic base, and its 2D side.
export * from "./node/node";
export * from "./2d/node2d";
export type { NodeTime } from "./node/node-time";
// The per-frame subtree traversals the runtime drives. Free functions rather
// than node methods — see the module docblock.
/** @internal */ export { primeMotionTree, sampleTree } from "./node/node-walk";
export { applyEditorStates } from "./node/node-editor-state";

export type { NodeEditorState, NodeEditorStates } from "./node/node-editor-state";
export * from "./root/canvas2d-node";

// The node types themselves are components (`components/builtins/*`), their props types beside them.
// Audio — the third tree: a bus groups, a sound plays.
export * from "./audio";

// 3D
export * from "./three/node3d";
