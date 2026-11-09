import {
    Graphics2D,
    insetsOps,
    Paint,
    provides,
    type ChildPlane,
    type ChildView,
    type Extents,
    type InsetsResolved,
    type Placement2D,
    type Provided,
    type RenderContext,
    type Shadow,
    type Fill,
    type Size2D,
    type Vector2,
} from "@motionscript/sdk";
import type { CoordinateMap } from "./coords";
import { settle, SYSTEM, systemPlane } from "./graph";
import { openPlane, placeOnMap } from "./place";

/**
 * What a coordinate system shares: a node whose children sit in its graph
 * coordinates. A child's `x`/`y` are in the system's units and the child keeps
 * its own size, so anything can be put on a graph: a dot, a label, an image. A
 * mark is drawn through the system's map instead and laid out on its ink.
 *
 * The system's `stroke` is its axis line (so `endCap` is the tip) and its `fill`
 * the backdrop. Ticks, grid and labels are drawing ops, never child nodes: a
 * document's children would otherwise share their indices with them.
 */

const CENTRE: Vector2 = { x: 0, y: 0 };

/** What a system's helpers read of its state. */
export interface SystemState {
    readonly padding: InsetsResolved;
    readonly fill: Fill;
    readonly shadow: Shadow;
    readonly clip: boolean;
}

/** How a system's graph values land on its plot area. */
export type MapFor<S> = (area: Extents, state: S) => CoordinateMap;

/** The plot area: the box less its padding, y-up from the box's centre. */
export function plotArea(size: Size2D, padding: InsetsResolved): Extents {
    const inner = insetsOps.insetBounds(size.width, size.height, padding);
    return {
        minX: inner.x - inner.width / 2,
        maxX: inner.x + inner.width / 2,
        minY: -inner.y - inner.height / 2,
        maxY: -inner.y + inner.height / 2,
    };
}

/** A system's map at a laid-out `size`. */
export function systemMap<S extends SystemState>(size: Size2D, state: S, mapFor: MapFor<S>): CoordinateMap {
    return mapFor(plotArea(size, state.padding), state);
}

/** A system is the size it is given: its children are placed in it, not measured into it. */
export function systemSize(state: SystemState): Size2D {
    const { left, right, top, bottom } = state.padding;
    return { width: left + right, height: top + bottom };
}

/** What a system hands its subtree: its plane, which its layout keeps current. */
export function systemProvides(state: object): readonly Provided[] {
    return [provides(SYSTEM, systemPlane(state))];
}

/** Lay a system's children out on its map. */
export function systemLayout<S extends SystemState>(size: Size2D, state: S, children: readonly ChildView[], mapFor: MapFor<S>): Placement2D[] {
    const map = systemMap(size, state, mapFor);
    const plane = systemPlane(state);
    settle(plane, map, children);
    const inner = insetsOps.insetBounds(size.width, size.height, state.padding);
    return placeOnMap(children, map, CENTRE, inner, plane);
}

/** Where a child dropped on a system would sit. */
export function systemOpenPlane<S extends SystemState>(size: Size2D, state: S, mapFor: MapFor<S>): ChildPlane {
    return openPlane(systemMap(size, state, mapFor), CENTRE);
}

/**
 * A system's paint: the backdrop, then the furniture under its children, kept
 * in the plot area where the map spills from it, then the children, confined
 * to the plot area when `clip` is set. The stroke is the axis line, drawn with
 * the furniture: painted after the children it would land over them.
 */
export function drawSystem(ctx: RenderContext, state: SystemState, map: CoordinateMap, furniture: (map: CoordinateMap) => Graphics2D[]): void {
    const { width, height } = ctx.size;
    const { minX, minY, maxX, maxY } = map.area;
    const area = new Graphics2D().rect({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY });
    ctx.inFront(() => {
        ctx.draw(new Graphics2D().rect({ x: 0, y: 0, width, height }).shadow(state.shadow).fill(state.fill));
        const parts = furniture(map);
        if (map.spills) ctx.clip(area, () => ctx.draw(parts));
        else ctx.draw(parts);
    });
    // No shape of its own to paint here; the plot area is what clips the children and what picking tests.
    Paint.draw(ctx, state as unknown as Paint.PaintState, null, { clipShape: area });
}
