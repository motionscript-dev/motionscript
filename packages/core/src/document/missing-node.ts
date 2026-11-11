import { getPropertyMeta } from "@/attributes/properties/decorator";
import { component2d } from "@/components/factory/component2d";
import { component3d } from "@/components/factory/component3d";
import { componentAudio } from "@/components/factory/component-audio";
import type { Node, NodeDimension } from "@/components/trees/node/node";
import type { NodeSpec } from "./types";

/**
 * What a build puts where a row names a type its registry lacks: a node that keeps the row's id, placement and
 * children and draws nothing itself, so one unknown type costs one node, not the clip, and an editor still
 * shows the row where it was. None of these is registered, so no document can name one.
 */

export interface MissingNodeInfo {
    type: string;
    props: Readonly<Record<string, unknown>>;
}

const MissingNode2D = component2d({ key: "missingNode2d" });
const MissingNode3D = component3d({ key: "missingNode3d" });
const MissingNodeAudio = componentAudio({ key: "missingNodeAudio" });

type PlaceholderCtor = new (props?: Record<string, unknown>) => Node;

const PLACEHOLDERS: Record<NodeDimension, PlaceholderCtor> = {
    "2d": MissingNode2D.node as unknown as PlaceholderCtor,
    "3d": MissingNode3D.node as unknown as PlaceholderCtor,
    audio: MissingNodeAudio.node as unknown as PlaceholderCtor,
};

/** Placement it keeps; nothing that would draw or composite. */
const DRAWS = new Set(["effects", "blend", "clip", "shadow"]);

const KEPT = Object.fromEntries(Object.entries(PLACEHOLDERS).map(([dimension, ctor]) => [
    dimension,
    new Set(getPropertyMeta(Object.create(ctor.prototype) as object).map((m) => m.key).filter((key) => !DRAWS.has(key))),
])) as unknown as Record<NodeDimension, ReadonlySet<string>>;

const MISSING = new WeakMap<Node, MissingNodeInfo>();

/** Stands in for every placeholder's class when a build compares a live node's class with its row's. */
export const MISSING_TYPE: unique symbol = Symbol("missingNodeType");

/** @internal A placeholder for `spec`, in `dimension`, taking what it can of `props` (the literal half of the row's). */
export function missingNode(dimension: NodeDimension, spec: NodeSpec, props: Record<string, unknown>): Node {
    const node = new PLACEHOLDERS[dimension]({
        ...placeholderProps(dimension, props),
        id: spec.id,
        ...(spec.key !== undefined && { key: spec.key }),
    });
    MISSING.set(node, { type: spec.type, props: spec.props });
    return node;
}

/** @internal Of a props bag, what a placeholder of `dimension` takes. */
export function placeholderProps(dimension: NodeDimension, props: Record<string, unknown>): Record<string, unknown> {
    const kept = KEPT[dimension];
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) if (kept.has(key)) out[key] = value;
    return out;
}

/** So a host can mark the row and keep its props for when the type is back. */
export function missingNodeOf(node: Node): MissingNodeInfo | undefined {
    return MISSING.get(node);
}
