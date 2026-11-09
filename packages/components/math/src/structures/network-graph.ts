import {
    component2d,
    Graphics2D,
    Types,
    type Color,
    type Fill,
    type FillResolved,
    type NodeOf,
    type NormalizedColor,
    type PaintProps,
    type RenderContext,
    type ShadowResolved,
    type Size2D,
    type Stroke,
    type StrokeResolved,
    type Values,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
} from "@motionscript/sdk";
import { createBoundedCache } from "../kit/cache";
import { listed, PAINT, PAINT_COMMANDS, painted } from "../kit/component";
import { drawLabels, loadFormulas, type Label } from "../kit/furniture";
import { lerpPartFills, partPaint, readPartFills, withPartFill, type PartFill, type PartFillResolved } from "../kit/part-fills";
import { GRAPH_LAYOUTS, layOut, type GraphEdge, type GraphLayout } from "./graph-layout";

/** A vertex placed by hand, in the graph's box from -1 to 1 each way, y up. */
export interface GraphPosition {
    vertex: string;
    x: number;
    y: number;
}

export interface NetworkGraphProps extends PaintProps {
    vertices?: string[];
    edges?: GraphEdge[];
    directed?: boolean;
    arrangement?: GraphLayout;
    root?: string;
    positions?: GraphPosition[];
    vertexRadius?: number;
    vertexStroke?: Stroke;
    labels?: boolean;
    labelSize?: number;
    labelColor?: Color;
    fontFamily?: string;
    partFills?: PartFill[];
}

// Every list keeps each entry as it was written, a blank or a repeat included, so
// an editor showing the list shows the row it just added. What is drawn skips
// what is not complete yet (`names`, `links`).

function readVertices(value: readonly unknown[] | undefined): string[] {
    return (Array.isArray(value) ? value : []).map((name) => String(name ?? ""));
}

// An edge reads from `{ from, to }` or a pair, so a list written by hand is as good as one from a table.
function readEdges(value: readonly unknown[] | undefined): GraphEdge[] {
    return (Array.isArray(value) ? value : []).map((edge) => {
        const [from, to] = Array.isArray(edge) ? edge : [(edge as GraphEdge)?.from, (edge as GraphEdge)?.to];
        return { from: String(from ?? ""), to: String(to ?? "") };
    });
}

function readPositions(value: readonly GraphPosition[] | undefined): GraphPosition[] {
    const at = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
    return (Array.isArray(value) ? value : []).map((entry) => ({ vertex: String(entry?.vertex ?? ""), x: at(entry?.x), y: at(entry?.y) }));
}

/** How far a directed edge and the one back between the same two vertices bow apart, as a share of their length. */
const BOW = 0.12;

const NUL = String.fromCharCode(0);

const state = {
    ...PAINT,
    vertices: Types.custom<string[]>([], { resolve: readVertices, animatable: false, kind: "vector" }),
    edges: Types.custom<GraphEdge[]>([], { resolve: readEdges, animatable: false, kind: "vector" }),
    /** Draw each edge as an arrow from its `from` to its `to`. */
    directed: Types.boolean(false, { animatable: false }),
    arrangement: listed(GRAPH_LAYOUTS, "circular", { animatable: false }),
    /** The vertex a tree hangs from; left empty, the first. */
    root: Types.text("", { animatable: false }),
    /** Vertices placed by hand, whatever the layout says, in the box from -1 to 1 each way. */
    positions: Types.custom<GraphPosition[]>([], { resolve: readPositions, animatable: false, kind: "vector" }),
    vertexRadius: Types.number(18, { min: 0, unit: "px" }),
    vertexStroke: Types.stroke([]),
    labels: Types.boolean(true, { animatable: false }),
    labelSize: Types.number(18, { min: 1, unit: "px" }),
    labelColor: Types.color("#111827"),
    fontFamily: Types.text("", { animatable: false }),
    /** Paints for a vertex by its name, or an edge written `a-b`, over the graph's own. */
    partFills: Types.custom<PartFill[], PartFillResolved[]>([], { resolve: readPartFills, lerp: lerpPartFills, kind: "vector" }),
    /** The arrangement an `arrangeTo` is leaving, and how far it is towards the new one. */
    layoutFrom: Types.text("", { private: true }),
    layoutMix: Types.number(1, { private: true }),
};

/** What a graph is drawn from: its own entries, as its fields and its node both read them. */
export type GraphValues = Values<typeof state>;

/**
 * Vertices and the edges between them, arranged by a rule: in a circle, by
 * springs, as a tree from `root`, or in a grid. Its `fill` is the vertices and
 * its `stroke` the edges, with an arrowhead each when `directed`. `arrangeTo`
 * moves every vertex to where another rule places it; `partFillTo` paints a
 * vertex, or an edge written `a-b`. (`layout` is every node's own box.)
 */
export const NetworkGraph = component2d({
    key: "networkGraph",
    state,
    defaults: {
        fill: "#e5e7eb",
        stroke: { weight: 3, fill: "#9ca3af", align: "center", cap: "round" },
    },
    load: (loader, s) => {
        if (s.fontFamily !== "") loader.font(s.fontFamily);
        if (s.labels) loadFormulas(loader, names(s));
    },
    commands: {
        ...PAINT_COMMANDS,
        /** Move every vertex to where another arrangement places it. */
        arrangeTo: {
            // No default: one left out keeps the arrangement the graph has.
            args: { arrangement: listed(GRAPH_LAYOUTS, undefined) },
            run: (timeline, s) => {
                const from = s.arrangement;
                const to = timeline.args.arrangement ?? from;
                return timeline.animate((t) => ({ arrangement: to, layoutFrom: from, layoutMix: t }));
            },
        },
        /** Paint one part of the graph: a vertex by its name, or an edge written `a-b`. */
        partFillTo: {
            args: { part: Types.text(""), fill: Types.custom<Fill>("#facc15", { kind: "fills" }) },
            run: (timeline, s) => {
                const { part, fill } = timeline.args;
                if (!part || fill == null) return timeline.tween({});
                return timeline.tween({ partFills: withPartFill(s.partFills, { part, fill }) });
            },
        },
    },
    render: (ctx, s) => painted(ctx, () => drawGraph(ctx, s)),
});

export type NetworkGraph = NodeOf<typeof NetworkGraph>;

/** Where each vertex is drawn in a graph of `size`, in pixels from its centre, y up. */
export function vertexPoints(graph: GraphValues, size: Size2D): Map<string, Vector2> {
    const room = graph.vertexRadius + Math.max(2, graph.labelSize * 0.2);
    const halfX = Math.max(0, size.width / 2 - room);
    const halfY = Math.max(0, size.height / 2 - room);
    const to = placed(graph, graph.arrangement);
    const from = graph.layoutMix < 1 && graph.layoutFrom !== "" ? placed(graph, graph.layoutFrom as GraphLayout) : null;
    const t = graph.layoutMix;
    const out = new Map<string, Vector2>();
    for (const [name, p] of to) {
        const q = from?.get(name) ?? p;
        out.set(name, { x: (q.x + (p.x - q.x) * t) * halfX, y: (q.y + (p.y - q.y) * t) * halfY });
    }
    return out;
}

function drawGraph(ctx: RenderContext, graph: GraphValues): void {
    const points = vertexPoints(graph, ctx.size);
    if (points.size === 0) return;
    const parts = new Map((graph.partFills as PartFillResolved[]).map((entry) => [entry.part, entry]));
    drawEdges(ctx, graph, points, parts);
    drawVertices(ctx, graph, points, parts);
}

// Two layouts are held at once while one becomes the other, and a scene may hold several graphs.
const layouts = createBoundedCache<Map<string, Vector2>>(32);

/** Each vertex's place under `layout`, from -1 to 1, a hand-placed one where it is. */
function placed(graph: GraphValues, layout: GraphLayout): Map<string, Vector2> {
    const vertices = names(graph);
    const edges = links(graph);
    const key = [layout, graph.root, vertices.join(NUL), JSON.stringify(edges), JSON.stringify(graph.positions)].join("|");
    let at = layouts.get(key);
    if (!at) {
        at = layOut(layout, vertices, edges, graph.root.trim());
        for (const { vertex, x, y } of graph.positions) {
            const name = vertex.trim();
            if (at.has(name)) at.set(name, { x, y });
        }
        layouts.set(key, at);
    }
    return at;
}

function drawEdges(ctx: RenderContext, graph: GraphValues, points: Map<string, Vector2>, parts: Map<string, PartFillResolved>): void {
    const stroke = graph.stroke as StrokeResolved[];
    if (stroke.length === 0) return;
    const r = graph.vertexRadius;
    const all = links(graph);
    const pairs = new Set(all.map(({ from, to }) => `${from}${NUL}${to}`));
    const plain = new Graphics2D();
    let drawnPlain = false;
    for (const { from, to } of all) {
        const a = points.get(from);
        const b = points.get(to);
        if (!a || !b) continue;
        const run = from === to ? loop(a, r) : edge(a, b, r, graph.directed && pairs.has(`${to}${NUL}${from}`) ? BOW : 0);
        if (run.length < 2) continue;
        const paint = parts.get(`${from}-${to}`) ?? (graph.directed ? undefined : parts.get(`${to}-${from}`));
        const own = graph.directed || paint !== undefined;
        const g = own ? new Graphics2D() : plain;
        g.line({ points: run, radius: 0, start: graph.start, end: graph.end });
        if (!own) {
            drawnPlain = true;
            continue;
        }
        let layers = stroke;
        if (paint) layers = layers.map((layer) => ({ ...layer, fill: partPaint(layer.fill, paint) }));
        if (graph.directed && from !== to) layers = layers.map((layer) => ({ ...layer, endCap: layer.endCap ?? "triangle" }));
        ctx.draw(g.stroke(layers));
    }
    if (drawnPlain) ctx.draw(plain.stroke(stroke));
}

function drawVertices(ctx: RenderContext, graph: GraphValues, points: Map<string, Vector2>, parts: Map<string, PartFillResolved>): void {
    const r = graph.vertexRadius;
    const fill = graph.fill as FillResolved[];
    const outline = graph.vertexStroke as StrokeResolved[];
    const labels: Label[] = [];
    for (const [name, p] of points) {
        if (r > 0) {
            const paint = partPaint(fill, parts.get(name));
            const disc = new Graphics2D().ellipse({ x: p.x, y: p.y, width: r * 2, height: r * 2 });
            ctx.draw(disc.shadow(graph.shadow as ShadowResolved[]).fill(paint));
            if (outline.length > 0) ctx.draw(new Graphics2D().ellipse({ x: p.x, y: p.y, width: r * 2, height: r * 2 }).stroke(outline));
        }
        if (graph.labels) labels.push({ text: name, at: { x: p.x, y: p.y }, align: "center" });
    }
    for (const part of drawLabels(labels, { fontSize: graph.labelSize, fontFamily: graph.fontFamily, color: graph.labelColor as NormalizedColor })) {
        ctx.draw(part);
    }
}

/** The vertices drawn: each name once, trimmed, the blank ones left out. */
function names(graph: Pick<GraphValues, "vertices">): string[] {
    return [...new Set(graph.vertices.map((name) => name.trim()).filter((name) => name !== ""))];
}

/** The edges drawn: both ends named. */
function links(graph: Pick<GraphValues, "edges">): GraphEdge[] {
    return graph.edges.flatMap(({ from, to }) => {
        const a = from.trim();
        const b = to.trim();
        return a === "" || b === "" ? [] : [{ from: a, to: b }];
    });
}

/** An edge from one vertex's rim to the other's, straight or bowed to its left. */
function edge(a: Vector2, b: Vector2, r: number, bow: number): Vector2[] {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 2 * r)) return [];
    if (bow === 0) {
        const ux = dx / length;
        const uy = dy / length;
        return [{ x: a.x + ux * r, y: a.y + uy * r }, { x: b.x - ux * r, y: b.y - uy * r }];
    }
    const mid = { x: (a.x + b.x) / 2 - (dy / length) * bow * length, y: (a.y + b.y) / 2 + (dx / length) * bow * length };
    const run: Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        run.push({ x: u * u * a.x + 2 * u * t * mid.x + t * t * b.x, y: u * u * a.y + 2 * u * t * mid.y + t * t * b.y });
    }
    // Trimmed back to the rims along the curve.
    const outside = (p: Vector2, c: Vector2) => Math.hypot(p.x - c.x, p.y - c.y) >= r;
    return run.filter((p) => outside(p, a) && outside(p, b));
}

/** An edge from a vertex to itself: a small loop above it. */
function loop(c: Vector2, r: number): Vector2[] {
    const run: Vector2[] = [];
    const radius = Math.max(r * 0.8, 6);
    const cy = c.y + r + radius * 0.6;
    for (let i = 0; i <= 24; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / 24;
        const p = { x: c.x + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
        if (Math.hypot(p.x - c.x, p.y - c.y) >= r) run.push(p);
    }
    return run;
}
