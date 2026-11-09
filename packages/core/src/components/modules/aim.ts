import { lerpVector2, type Vector2 } from "@/attributes/layout/vector2";
import { Node2D } from "@/components/trees/2d/node2d";
import type { Node } from "@/components/trees/node/node";
import type { RenderContext2D, Values } from "@/components/factory/api";
import { commandsFor } from "@/components/factory/commands-for";
import { Types } from "@/components/factory/types";
import { internalsOf, nodeOfNodeView } from "@/components/factory/views";

/** Where a 2D camera looks: a point, a zoom and a heading, or a node below it to follow. */
export const state = {
    zoom: Types.number(1, { min: 0.01, step: 0.1, unit: "×" }),
    lookAt: Types.custom<Vector2>({ x: 0, y: 0 }, { lerp: lerpVector2, kind: "vector2", properties: { x: { kind: "number" }, y: { kind: "number" } } }),
    heading: Types.number(0, { step: 1, unit: "°" }),
    follow: Types.nodeRef(),
};

export const commands = commandsFor(state, {
    zoomTo: { args: ["zoom"] },
    panTo: { args: ["lookAt"] },
    headingTo: { args: ["heading"] },
});

type AimState = Values<typeof state>;

/** The point the camera centres on: `lookAt`, offset from the followed node when there is one below it. */
export function aim(ctx: RenderContext2D, s: AimState): Vector2 {
    const target = s.follow;
    if (!target) return s.lookAt;
    const node = nodeOfNodeView(target);
    if (!(node instanceof Node2D) || !within(node, internalsOf(ctx).host)) return s.lookAt;
    const at = target.frame;
    return { x: at.x + s.lookAt.x, y: at.y + s.lookAt.y };
}

/** The children, through this camera. */
export function camera(ctx: RenderContext2D, s: AimState): void {
    ctx.camera({ lookAt: aim(ctx, s), zoom: s.zoom, heading: s.heading });
}

function within(node: Node, ancestor: Node): boolean {
    for (let at = node.parent; at; at = at.parent) if (at === ancestor) return true;
    return false;
}
