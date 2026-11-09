import type { Vector2 } from "@motionscript/sdk";

/** Where a graph's vertices are placed, inside a square from -1 to 1 each way, y up. */

export type GraphLayout = "circular" | "spring" | "tree" | "grid";

export const GRAPH_LAYOUTS: readonly GraphLayout[] = ["circular", "spring", "tree", "grid"];

export interface GraphEdge {
    from: string;
    to: string;
}

/** Each vertex's place under `layout`, by name. */
export function layOut(layout: GraphLayout, vertices: readonly string[], edges: readonly GraphEdge[], root: string): Map<string, Vector2> {
    const n = vertices.length;
    if (n === 0) return new Map();
    if (n === 1) return new Map([[vertices[0], { x: 0, y: 0 }]]);
    switch (layout) {
        case "grid":
            return grid(vertices);
        case "tree":
            return fill(tree(vertices, edges, root));
        case "spring":
            return fill(spring(vertices, edges));
        default:
            return circular(vertices);
    }
}

function circular(vertices: readonly string[]): Map<string, Vector2> {
    const n = vertices.length;
    // The first at the top, the rest clockwise, as a clock is read.
    return new Map(vertices.map((name, i) => {
        const angle = Math.PI / 2 - (2 * Math.PI * i) / n;
        return [name, { x: Math.cos(angle), y: Math.sin(angle) }];
    }));
}

function grid(vertices: readonly string[]): Map<string, Vector2> {
    const columns = Math.ceil(Math.sqrt(vertices.length));
    const rows = Math.ceil(vertices.length / columns);
    const at = (i: number, count: number) => (count === 1 ? 0 : -1 + (2 * i) / (count - 1));
    return new Map(vertices.map((name, i) => [name, { x: at(i % columns, columns), y: -at(Math.floor(i / columns), rows) }]));
}

function neighbours(vertices: readonly string[], edges: readonly GraphEdge[]): Map<string, string[]> {
    const near = new Map(vertices.map((name) => [name, [] as string[]]));
    for (const { from, to } of edges) {
        if (from === to || !near.has(from) || !near.has(to)) continue;
        near.get(from)!.push(to);
        near.get(to)!.push(from);
    }
    return near;
}

/** Levels down from `root`, and across by the leaves under each, every component its own tree beside the last. */
function tree(vertices: readonly string[], edges: readonly GraphEdge[], root: string): Map<string, Vector2> {
    const near = neighbours(vertices, edges);
    const placed = new Map<string, Vector2>();
    let column = 0;
    const visit = (name: string, depth: number, seen: Set<string>): number => {
        seen.add(name);
        const children = near.get(name)!.filter((next) => !seen.has(next));
        for (const child of children) seen.add(child);
        if (children.length === 0) {
            placed.set(name, { x: column++, y: -depth });
            return placed.get(name)!.x;
        }
        const xs = children.map((child) => visit(child, depth + 1, seen));
        const x = (xs[0] + xs[xs.length - 1]) / 2;
        placed.set(name, { x, y: -depth });
        return x;
    };
    const seen = new Set<string>();
    const first = near.has(root) ? root : vertices[0];
    for (const start of [first, ...vertices]) if (!seen.has(start)) visit(start, 0, seen);
    return placed;
}

/** Edges pull and every pair pushes, from the circle, for a fixed number of cooling steps: the same answer every time. */
function spring(vertices: readonly string[], edges: readonly GraphEdge[]): Map<string, Vector2> {
    const n = vertices.length;
    const index = new Map(vertices.map((name, i) => [name, i]));
    const start = circular(vertices);
    const x = vertices.map((name) => start.get(name)!.x);
    const y = vertices.map((name) => start.get(name)!.y);
    const links = edges.flatMap(({ from, to }) => {
        const a = index.get(from);
        const b = index.get(to);
        return a === undefined || b === undefined || a === b ? [] : [[a, b] as const];
    });
    const k = Math.sqrt(4 / n);
    const steps = 160;
    for (let step = 0; step < steps; step++) {
        const dx = new Float64Array(n);
        const dy = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                let ex = x[i] - x[j];
                let ey = y[i] - y[j];
                let d = Math.hypot(ex, ey);
                // Two on one spot are parted along a fixed, if arbitrary, line.
                if (d < 1e-6) [ex, ey, d] = [1e-3 * (i - j), 1e-3, 1e-3];
                const push = (k * k) / d;
                dx[i] += (ex / d) * push;
                dy[i] += (ey / d) * push;
                dx[j] -= (ex / d) * push;
                dy[j] -= (ey / d) * push;
            }
        }
        for (const [a, b] of links) {
            const ex = x[a] - x[b];
            const ey = y[a] - y[b];
            const d = Math.max(Math.hypot(ex, ey), 1e-6);
            const pull = (d * d) / k;
            dx[a] -= (ex / d) * pull;
            dy[a] -= (ey / d) * pull;
            dx[b] += (ex / d) * pull;
            dy[b] += (ey / d) * pull;
        }
        const limit = 0.12 * (1 - step / steps);
        for (let i = 0; i < n; i++) {
            const d = Math.hypot(dx[i], dy[i]);
            if (d > 0) {
                x[i] += (dx[i] / d) * Math.min(d, limit);
                y[i] += (dy[i] / d) * Math.min(d, limit);
            }
        }
    }
    return new Map(vertices.map((name, i) => [name, { x: x[i], y: y[i] }]));
}

/** `placed` stretched to reach -1 and 1 on each axis it spreads along, and centred on the one it does not. */
function fill(placed: Map<string, Vector2>): Map<string, Vector2> {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of placed.values()) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    const scale = (v: number, lo: number, hi: number) => (hi - lo < 1e-9 ? 0 : -1 + (2 * (v - lo)) / (hi - lo));
    return new Map([...placed].map(([name, p]) => [name, { x: scale(p.x, minX, maxX), y: scale(p.y, minY, maxY) }]));
}
