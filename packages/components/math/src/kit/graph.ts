import {
    createContext,
    Types,
    type ChildView,
    type EntryOptions,
    type NodeView,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Context as _Context,
} from "@motionscript/sdk";
import { PIXEL_MAP, type CoordinateMap } from "./coords";
import { CURVE_KEYS, isCurve, type CurveValues } from "./curve";

/**
 * What a coordinate system hands the plots and marks inside it: the map it was
 * last laid out on, the curves it holds by id, and, under a plot, that plot.
 * Inherited once, so it is a live object the system's layout keeps current.
 */
export interface GraphPlane {
    readonly map: CoordinateMap;
    readonly curves: ReadonlyMap<string, CurveValues>;
    /** The curve a mark rides when it names none: the plot it sits in. */
    readonly enclosing: CurveValues | null;
}

/** The plane of the nearest coordinate system: what a plot is laid out on. */
export const SYSTEM = createContext<GraphPlane | null>(null, "mathSystem");
/** The plane under a plot: the system's, riding that plot. */
export const PLOT = createContext<GraphPlane | null>(null, "mathPlot");

type Inherited = { readonly private: true };

/** A plot's plane: the system it sits in, `null` outside one. */
export const SYSTEM_ENTRY = Types.custom<GraphPlane | null, GraphPlane | null, Inherited>(null, {
    private: true,
    inherit: (use) => use(SYSTEM),
});

/** A mark's plane: the plot or the system that lays it out, `null` outside both. */
export const PLANE_ENTRY = Types.custom<GraphPlane | null, GraphPlane | null, Inherited>(null, {
    private: true,
    inherit: (use) => use(PLOT) ?? use(SYSTEM),
});

/** A reference to the plot a mark reads, by id: a host offers the plots. */
export const PLOT_REF = Types.custom<string, NodeView | null, EntryOptions & { readonly nodeTypes: readonly string[] }>("", { kind: "nodeRef", nodeTypes: ["functionPlot"], animatable: false });

const NO_CURVES: ReadonlyMap<string, CurveValues> = new Map();

class SystemPlane implements GraphPlane {
    map: CoordinateMap = PIXEL_MAP;
    curves: ReadonlyMap<string, CurveValues> = NO_CURVES;
    readonly enclosing = null;
}

class PlotPlane implements GraphPlane {
    constructor(readonly parent: GraphPlane | null, readonly enclosing: CurveValues) { }

    get map(): CoordinateMap {
        return this.parent?.map ?? PIXEL_MAP;
    }

    get curves(): ReadonlyMap<string, CurveValues> {
        return this.parent?.curves ?? NO_CURVES;
    }
}

const systems = new WeakMap<object, SystemPlane>();
const plots = new WeakMap<object, PlotPlane>();

/** The plane a system provides, one per system: its `layout` writes the map and the curves into it. */
export function systemPlane(state: object): SystemPlane {
    let plane = systems.get(state);
    if (!plane) systems.set(state, (plane = new SystemPlane()));
    return plane;
}

/** Lay `plane` out on `map`, holding the curves among `children`. */
export function settle(plane: SystemPlane, map: CoordinateMap, children: readonly ChildView[]): void {
    plane.map = map;
    const curves = new Map<string, CurveValues>();
    collectCurves(children, curves);
    plane.curves = curves;
}

/** The plane a plot provides the marks inside it, one per plot and system. */
export function plotPlane(plot: CurveValues, parent: GraphPlane | null): GraphPlane {
    let plane = plots.get(plot);
    if (!plane || plane.parent !== parent) plots.set(plot, (plane = new PlotPlane(parent, plot)));
    return plane;
}

/**
 * The curve a mark reads: the one `on` names in its system, or, naming none or
 * one the system does not hold, the plot it sits in. `on` as the mark's own
 * fields read a reference (a view) or its holder's layout does (an id). Outside
 * any system a named curve is read wherever it is.
 */
export function curveFor(plane: GraphPlane | null, on: unknown, enclosing = true): CurveValues | null {
    if (!plane) return isCurve(on) ? on.state : null;
    const id = refId(on);
    return (id === "" ? undefined : plane.curves.get(id)) ?? (enclosing ? plane.enclosing : null);
}

/** The id a reference holds, read as an id or as a view of the node. */
export function refId(on: unknown): string {
    if (typeof on === "string") return on;
    if (typeof on === "object" && on !== null && typeof (on as { id?: unknown }).id === "string") return (on as { id: string }).id;
    return "";
}

function collectCurves(children: readonly ChildView[], into: Map<string, CurveValues>): void {
    for (const child of children) {
        if (child.id !== "" && CURVE_KEYS.includes(child.key)) into.set(child.id, child.state as unknown as CurveValues);
        collectCurves(child.children, into);
    }
}
