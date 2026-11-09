import type { ChildPlane, ChildView, Placement2D, Size2D, Vector2 } from "@motionscript/sdk";
import type { CoordinateMap } from "./coords";
import { boundsOfRuns } from "./geometry";
import type { GraphPlane } from "./graph";
import { markRuns } from "./mark";

/** Where a child that sits somewhere other than its own `x`/`y` is (a point riding a curve), given its own `x`/`y`. */
export type Anchor = (x: number, y: number) => Vector2;

const anchors: { readonly is: (child: ChildView) => boolean; readonly anchor: (state: never, plane: GraphPlane) => Anchor | null }[] = [];

/** `component`, declared to sit at `anchor` of its own `x`/`y` on a graph. Hand back the component. */
export function anchored<C extends { is(child: ChildView): boolean }>(component: C, anchor: (state: never, plane: GraphPlane) => Anchor | null): C {
    anchors.push({ is: (child) => component.is(child), anchor });
    return component;
}

/**
 * Lay `children` out on `map`, for whichever node holds them: a coordinate
 * system, or a plot holding the marks that read it. A mark goes on its ink;
 * anything else keeps its own size and has its `x`/`y` read as graph
 * coordinates. `origin` is the holder's own centre in the map's pixels (y-up),
 * since a child's box is placed from there.
 */
export function placeOnMap(children: readonly ChildView[], map: CoordinateMap, origin: Vector2, room: Size2D, plane: GraphPlane): Placement2D[] {
    return children.map((child) => {
        const runs = markRuns(child, map, plane);
        if (runs) {
            const ink = boundsOfRuns(runs);
            const cx = ink ? (ink.minX + ink.maxX) / 2 : origin.x;
            const cy = ink ? (ink.minY + ink.maxY) / 2 : origin.y;
            return {
                x: cx - origin.x,
                y: cy - origin.y,
                width: ink ? ink.maxX - ink.minX : 0,
                height: ink ? ink.maxY - ink.minY : 0,
                plane: markPlane(map, cx, cy),
            };
        }
        const size = child.measure({ width: room.width, height: room.height });
        const entry = anchors.find((a) => a.is(child));
        const anchor = entry ? (entry.anchor as (state: unknown, plane: GraphPlane) => Anchor | null)(child.state, plane) : null;
        // Its box is centred on the map's own centre, so its offset from there is its point.
        return { x: -origin.x, y: -origin.y, width: size.width, height: size.height, plane: pointPlane(map, anchor) };
    });
}

/** The plane of a child that is not there yet, under a holder centred on `origin`: where a host would drop one. */
export function openPlane(map: CoordinateMap, origin: Vector2): ChildPlane {
    return {
        toOffset: (x, y) => {
            const at = map.toPoint(x, y);
            return { x: at.x - origin.x, y: at.y - origin.y };
        },
        toCoords: (x, y) => map.toCoords(x + origin.x, y + origin.y),
    };
}

function pointPlane(map: CoordinateMap, anchor: Anchor | null): ChildPlane {
    const point: Vector2 = { x: 0, y: 0 };
    return {
        toOffset: (x, y) => {
            const at = anchor?.(x, y);
            return at ? map.toPoint(at.x, at.y, point) : map.toPoint(x, y, point);
        },
        toCoords: (x, y) => map.toCoords(x, y),
    };
}

// A mark reads its own `x`/`y` as it draws, so its holder adds nothing; a drag still answers in graph units.
function markPlane(map: CoordinateMap, cx: number, cy: number): ChildPlane {
    const none: Vector2 = { x: 0, y: 0 };
    return {
        toOffset: () => none,
        toCoords: (x, y) => map.toCoords(cx + x, cy + y),
    };
}
