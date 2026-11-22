import { vector2Ops, type Vector2 } from "@/attributes/layout/vector2";
import type { NodeOf } from "@/components/factory/api";
import { commandsFor } from "@/components/factory/commands-for";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import * as Flow from "@/components/modules/flow";
import type { Node2DProps } from "@/components/trees/2d/node2d";

const SPEED = { min: 0, max: 2, step: 0.01, scale: 100, unit: "%" } as const;

const state = {
    scroll: Types.custom<Vector2>({ x: 0, y: 0 }, { lerp: vector2Ops.lerp, kind: "vector2" }),
    farSpeed: Types.number(0.1, SPEED),
    nearSpeed: Types.number(1, SPEED),
    wrap: Types.oneOf(["none", "horizontal", "vertical", "both"]),
};

/** What a parallax's layers move by. */
export interface ParallaxLayers {
    scroll: Vector2;
    farSpeed: number;
    nearSpeed: number;
    wrap: "none" | "horizontal" | "vertical" | "both";
}

/** The share of `scroll` that layer `index` of `count` travels: `farSpeed` on the first (back), `nearSpeed` on the last (front). */
export function parallaxSpeed(s: Pick<ParallaxLayers, "farSpeed" | "nearSpeed">, index: number, count: number): number {
    return count > 1 ? s.farSpeed + (s.nearSpeed - s.farSpeed) * (index / (count - 1)) : s.nearSpeed;
}

/** Within half a period of 0, so a tiled layer's own copy stays near where it was placed and stays pickable. */
function wrapped(shift: number, period: number): number {
    return period >= 1 ? shift - period * Math.round(shift / period) : shift;
}

/** Its children as layers, back to front, each sliding against `scroll` by its own share: near ones travel farther. */
export const Parallax = component2d({
    key: "parallax",
    state,
    defaults: { width: "fill", height: "fill" },
    commands: commandsFor(state, { scrollTo: { args: ["scroll"] } }),
    layout: (box, s, children) => Flow.layout(box, s as unknown as Flow.FlowState, children).map((p, i) => {
        const speed = parallaxSpeed(s, i, children.length);
        const scale = Math.abs(children[i]?.state.scale ?? 1);
        let x = -s.scroll.x * speed;
        let y = -s.scroll.y * speed;
        if (s.wrap === "horizontal" || s.wrap === "both") x = wrapped(x, p.width * scale);
        if (s.wrap === "vertical" || s.wrap === "both") y = wrapped(y, p.height * scale);
        return { ...p, x: p.x + x, y: p.y + y };
    }),
    // A child not added yet joins at the front: it lands under a drop once off the front layer's shift. A laid-out
    // child's slot already carries it, and with no shift there is no plane, which keeps a host's move snapping.
    plane: (_box, s) => {
        const x = s.scroll.x * s.nearSpeed;
        const y = s.scroll.y * s.nearSpeed;
        if (x === 0 && y === 0) return null;
        return {
            toOffset: (cx: number, cy: number) => ({ x: cx - x, y: cy - y }),
            toCoords: (ox: number, oy: number) => ({ x: ox + x, y: oy + y }),
        };
    },
    render: (ctx, s) => (s.wrap === "none" ? ctx.children() : ctx.tile(s.wrap)),
});

export type Parallax = NodeOf<typeof Parallax>;

export interface ParallaxProps extends Node2DProps, ParallaxLayers {}
