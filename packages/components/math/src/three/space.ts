import {
    createContext,
    Types,
    type ChildSpace3D,
    type Type,
    type Vector3,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Context as _Context,
} from "@motionscript/sdk";
import type { Interval } from "../kit/coords";

/**
 * A 3D graph's coordinates, as its axes' local space sees them. A graph is
 * right-handed with z up, and the scene has y up, so graph x, y and z run along
 * the scene's z, x and y: looked at head-on, y is to the right and z is up.
 */
export interface GraphSpace extends ChildSpace3D {
    readonly xRange: Interval;
    readonly yRange: Interval;
    readonly zRange: Interval;
    /** Changes exactly when the mapping does: what a mark's geometry is cached under. */
    readonly revision: string;
    /** A graph step as a local one: what a mark's own geometry is drawn in. */
    offset(x: number, y: number, z: number): Vector3;
}

/** The space of a box `lengths` on a side, in scene units, showing the three ranges, centred on its node. */
export function graphSpace(xRange: Interval, yRange: Interval, zRange: Interval, lengths: Vector3): GraphSpace {
    const ux = unit(xRange, lengths.x);
    const uy = unit(yRange, lengths.y);
    const uz = unit(zRange, lengths.z);
    const cx = (xRange[0] + xRange[1]) / 2;
    const cy = (yRange[0] + yRange[1]) / 2;
    const cz = (zRange[0] + zRange[1]) / 2;
    return {
        xRange,
        yRange,
        zRange,
        revision: [xRange, yRange, zRange, lengths.x, lengths.y, lengths.z].join("|"),
        toLocal: (x, y, z) => ({ x: (y - cy) * uy, y: (z - cz) * uz, z: (x - cx) * ux }),
        offset: (x, y, z) => ({ x: y * uy, y: z * uz, z: x * ux }),
    };
}

function unit([min, max]: Interval, length: number): number {
    const span = max - min;
    return span > 0 ? length / span : 0;
}

/** A 3D graph, as the marks inside it see it: its coordinates as they stand now. */
export interface Graph3D {
    space(): GraphSpace;
}

/** The graph a mark is inside: `axes3d` provides itself to everything in it. */
export const GRAPH_3D = createContext<Graph3D | null>(null, "math:graph3d");

/** The entry a mark reads its graph through, set from the nearest `axes3d` above it; `null` outside one. */
export function graphEntry(): Type<Graph3D | null, Graph3D | null, true> {
    return Types.custom<Graph3D | null, Graph3D | null, { readonly private: true }>(null, {
        private: true,
        inherit: (use) => use(GRAPH_3D),
    });
}

/** The graph space a mark with a {@link graphEntry} is drawn in, or `null` outside a graph. */
export function graphOf(mark: { readonly graph: Graph3D | null }): GraphSpace | null {
    return mark.graph?.space() ?? null;
}

/** A unit quaternion turning the scene's +y, the way a cylinder or a cone points, onto `direction`. */
export function aim(direction: Vector3): { x: number; y: number; z: number; w: number } {
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (!(length > 0)) return { x: 0, y: 0, z: 0, w: 1 };
    const dx = direction.x / length;
    const dy = direction.y / length;
    const dz = direction.z / length;
    // Straight down is the one turn with no single axis: any in the ground plane will do.
    if (dy < -1 + 1e-9) return { x: 1, y: 0, z: 0, w: 0 };
    const w = 1 + dy;
    const norm = Math.hypot(dz, dx, w);
    return { x: dz / norm, y: 0, z: -dx / norm, w: w / norm };
}
