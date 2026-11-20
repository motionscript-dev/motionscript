import { contours, segmentPointAt } from "@/attributes/shape/path/walk";
import type { PathCommand, PathData } from "@/render/descriptors/path";
import { resolveBevel3D, type BufferGeometry3D, type ExtrudeGeometry3D } from "./geometry";
import { segmentsOf } from "./segments";

/**
 * An {@link ExtrudeGeometry3D} as vertex buffers, three's `ExtrudeGeometry` in shape: the outline lies in the XY plane
 * as written (y up), the solid runs from z 0 to `depth` (default 1), a bevel rounds both rims outward by its `size`
 * and past both caps by its `thickness`, and curves flatten into `segments` steps (default 12). A contour inside an
 * odd number of others is a hole, whatever its winding. Walls are smooth across a turn under 30° and creased past it.
 * In core so a renderer only writes the buffer, and memoised by value, since a renderer asks every frame.
 */
export function evaluateExtrude(geometry: ExtrudeGeometry3D): BufferGeometry3D {
    const path = pathDataOf(geometry.path);
    const key = JSON.stringify([path, geometry.depth, geometry.segments, geometry.bevel]);
    const kept = MEMO.get(key);
    if (kept) return kept;
    const built = build(path, geometry);
    if (MEMO.size >= MEMO_MAX) MEMO.delete(MEMO.keys().next().value!);
    MEMO.set(key, built);
    return built;
}

const MEMO = new Map<string, BufferGeometry3D>();
const MEMO_MAX = 64;

/** The flat outline as data: a `PathBuilder` gives its commands. */
export function pathDataOf(path: ExtrudeGeometry3D["path"]): PathData {
    const builder = path as { toCommands?: () => PathCommand[] };
    return typeof builder.toCommands === "function" ? builder.toCommands() : (path as PathData);
}

type P = { x: number; y: number };

/** Each closed contour of `path` as points, curves flattened into `steps` each, with repeats and a closing duplicate dropped. */
export function extrudeRings(path: PathData, steps: number): P[][] {
    const rings: P[][] = [];
    for (const contour of contours(path)) {
        const points: P[] = [contour.start];
        for (const segment of contour.segments) {
            if (segment.kind === "line") points.push(segment.to);
            else for (let i = 1; i <= steps; i++) points.push(segmentPointAt(segment, i / steps));
        }
        const ring: P[] = [];
        for (const p of points) {
            const last = ring[ring.length - 1];
            if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) ring.push({ x: p.x, y: p.y });
        }
        while (ring.length > 1 && Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y) <= 1e-9) ring.pop();
        if (ring.length >= 3 && Math.abs(area(ring)) > 1e-12) rings.push(ring);
    }
    return rings;
}

function area(ring: readonly P[]): number {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
    return a / 2;
}

function inside(p: P, ring: readonly P[]): boolean {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
}

/** The solids: each outer ring (counter-clockwise) with the holes directly inside it (clockwise). */
export function extrudeShapes(rings: readonly P[][]): { outer: P[]; holes: P[][] }[] {
    const depth = rings.map((ring, i) => rings.filter((other, j) => j !== i && inside(ring[0], other)).length);
    const shapes = new Map<number, { outer: P[]; holes: P[][] }>();
    rings.forEach((ring, i) => {
        if (depth[i] % 2 === 0) shapes.set(i, { outer: area(ring) > 0 ? [...ring] : [...ring].reverse(), holes: [] });
    });
    rings.forEach((ring, i) => {
        if (depth[i] % 2 === 0) return;
        // The innermost solid holding it: the container one level out.
        const parent = rings.findIndex((other, j) => j !== i && depth[j] === depth[i] - 1 && inside(ring[0], other));
        shapes.get(parent)?.holes.push(area(ring) < 0 ? [...ring] : [...ring].reverse());
    });
    return [...shapes.values()];
}

const cross = (a: P, b: P, c: P) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (a: P, b: P) => Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12;

function inTriangle(p: P, a: P, b: P, c: P): boolean {
    return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

/**
 * Triangles over `points` (counter-clockwise), indices into `outer` then each hole in turn. Holes are bridged into
 * the outline from their rightmost vertex to the first vertex visible along +x, then the one polygon is ear-clipped.
 */
export function triangulate(outer: readonly P[], holes: readonly P[][]): number[] {
    const points: P[] = [...outer];
    let polygon = outer.map((_, i) => i);
    const placed = holes.map((hole) => {
        const start = points.length;
        points.push(...hole);
        return hole.map((_, i) => start + i);
    }).sort((a, b) => Math.max(...b.map((i) => points[i].x)) - Math.max(...a.map((i) => points[i].x)));
    for (const hole of placed) polygon = bridge(points, polygon, hole);
    return clip(points, polygon);
}

function bridge(points: readonly P[], polygon: number[], hole: number[]): number[] {
    let m = 0;
    for (let i = 1; i < hole.length; i++) if (points[hole[i]].x > points[hole[m]].x) m = i;
    const M = points[hole[m]];
    let best = Infinity, at = -1;
    for (let i = 0; i < polygon.length; i++) {
        const a = points[polygon[i]], b = points[polygon[(i + 1) % polygon.length]];
        if ((a.y > M.y) === (b.y > M.y)) continue;
        const x = a.x + ((M.y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (x >= M.x && x < best) {
            best = x;
            at = a.x > b.x ? i : (i + 1) % polygon.length;
        }
    }
    if (at < 0) return polygon;
    // A reflex vertex inside the triangle to the ray's hit would block the bridge: take the one nearest the ray.
    const I = { x: best, y: M.y };
    const P0 = points[polygon[at]];
    let pick = at, angle = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const v = points[polygon[i]];
        if (i === at || same(v, M)) continue;
        const prev = points[polygon[(i - 1 + polygon.length) % polygon.length]], next = points[polygon[(i + 1) % polygon.length]];
        if (cross(prev, v, next) > 0) continue;
        const tri = M.y <= P0.y ? inTriangle(v, M, I, P0) : inTriangle(v, M, P0, I);
        if (!tri) continue;
        const a = Math.abs(Math.atan2(v.y - M.y, v.x - M.x));
        if (a < angle) { angle = a; pick = i; }
    }
    const loop = [...hole.slice(m), ...hole.slice(0, m), hole[m]];
    return [...polygon.slice(0, pick + 1), ...loop, ...polygon.slice(pick)];
}

function clip(points: readonly P[], polygon: number[]): number[] {
    const out: number[] = [];
    const v = [...polygon];
    let i = 0, stalled = 0;
    while (v.length > 3 && stalled <= v.length) {
        const n = v.length;
        const ia = v[(i + n - 1) % n], ib = v[i % n], ic = v[(i + 1) % n];
        const a = points[ia], b = points[ib], c = points[ic];
        let ear = cross(a, b, c) > 1e-14;
        if (ear) {
            for (const j of v) {
                const p = points[j];
                if (j === ia || j === ib || j === ic || same(p, a) || same(p, b) || same(p, c)) continue;
                if (inTriangle(p, a, b, c)) { ear = false; break; }
            }
        }
        if (ear) {
            out.push(ia, ib, ic);
            v.splice(i % n, 1);
            stalled = 0;
            continue;
        }
        if (Math.abs(cross(a, b, c)) <= 1e-14) {
            // A vertex on a straight run or a doubled bridge point adds no area: drop it.
            v.splice(i % n, 1);
            stalled = 0;
            continue;
        }
        i = (i + 1) % v.length;
        stalled++;
    }
    if (v.length === 3 && cross(points[v[0]], points[v[1]], points[v[2]]) > 0) out.push(v[0], v[1], v[2]);
    return out;
}

/** A ring's miter at each vertex (the step that moves both edges out by one), and whether the outline turns there by under 30°. */
function miters(ring: readonly P[]): { m: P[]; smooth: boolean[] } {
    const n = ring.length;
    const normal = (a: P, b: P): P => {
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        return { x: dy / l, y: -dx / l };
    };
    const m: P[] = [], smooth: boolean[] = [];
    for (let i = 0; i < n; i++) {
        const n0 = normal(ring[(i - 1 + n) % n], ring[i]), n1 = normal(ring[i], ring[(i + 1) % n]);
        const bx = n0.x + n1.x, by = n0.y + n1.y, bl = Math.hypot(bx, by) || 1;
        const cos = (bx / bl) * n1.x + (by / bl) * n1.y;
        const scale = 1 / Math.max(0.25, cos);
        m.push({ x: (bx / bl) * scale, y: (by / bl) * scale });
        smooth.push(n0.x * n1.x + n0.y * n1.y > Math.cos(Math.PI / 6));
    }
    return { m, smooth };
}

function build(path: PathData, g: ExtrudeGeometry3D): BufferGeometry3D {
    const [steps] = segmentsOf(g.segments, [12]);
    const depth = g.depth ?? 1;
    const bevel = resolveBevel3D(g.bevel);
    // Each layer is how far the outline is pushed out and at what z, front to back.
    const layers: { out: number; z: number }[] = [];
    if (bevel) {
        const n = Math.max(1, Math.round(bevel.segments));
        const ring = (k: number) => ({
            out: bevel.size * Math.sin((k / n) * Math.PI / 2) + bevel.offset,
            z: bevel.thickness * Math.cos((k / n) * Math.PI / 2),
        });
        for (let k = 0; k < n; k++) layers.push({ out: ring(k).out, z: -ring(k).z });
        layers.push({ out: bevel.size + bevel.offset, z: 0 }, { out: bevel.size + bevel.offset, z: depth });
        for (let k = n - 1; k >= 0; k--) layers.push({ out: ring(k).out, z: depth + ring(k).z });
    } else {
        layers.push({ out: 0, z: 0 }, { out: 0, z: depth });
    }

    const position: number[] = [], uv: number[] = [], index: number[] = [];
    const group: number[] = [];
    const fixed: (readonly [number, number, number] | null)[] = [];
    let groups = 0;
    const vertex = (x: number, y: number, z: number, u: number, v: number, g: number | readonly [number, number, number]): number => {
        position.push(x, y, z);
        uv.push(u, v);
        if (typeof g === "number") { group.push(g); fixed.push(null); } else { group.push(-1); fixed.push(g); }
        return position.length / 3 - 1;
    };

    for (const shape of extrudeShapes(extrudeRings(path, steps))) {
        const rings = [shape.outer, ...shape.holes];
        const cuts = rings.map(miters);
        const at = (r: number, i: number, out: number): P => {
            const p = rings[r][i], m = cuts[r].m[i];
            return { x: p.x + m.x * out, y: p.y + m.y * out };
        };

        // The caps, triangulated once over the base outline and laid on the outermost layers.
        const tris = triangulate(shape.outer, shape.holes);
        const flat = rings.flatMap((ring, r) => ring.map((_, i) => [r, i] as const));
        for (const [layer, facing] of [[layers[0], -1], [layers[layers.length - 1], 1]] as const) {
            const base = position.length / 3;
            for (const [r, i] of flat) {
                const p = at(r, i, layer.out);
                vertex(p.x, p.y, layer.z, p.x, p.y, [0, 0, facing]);
            }
            for (let t = 0; t < tris.length; t += 3) {
                if (facing > 0) index.push(base + tris[t], base + tris[t + 1], base + tris[t + 2]);
                else index.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
            }
        }

        // The walls: a vertex per point per layer, doubled at a crease, and a seam at the first point for the texture.
        rings.forEach((ring, r) => {
            const n = ring.length;
            const lengths = [0];
            for (let i = 1; i <= n; i++) lengths.push(lengths[i - 1] + Math.hypot(ring[i % n].x - ring[i - 1].x, ring[i % n].y - ring[i - 1].y));
            const smooth = cuts[r].smooth;
            // Per layer and point: the vertex starting the next edge and the one ending the previous.
            const starts: number[][] = [], ends: number[][] = [];
            layers.forEach((layer, l) => {
                const s: number[] = [], e: number[] = [];
                for (let i = 0; i <= n; i++) {
                    const k = i % n;
                    const p = at(r, k, layer.out);
                    const g0 = groups + (l * n + k) * 2;
                    const startGroup = smooth[k] ? g0 : g0 + 1;
                    if (i < n) s.push(vertex(p.x, p.y, layer.z, lengths[i], layer.z, startGroup));
                    if (i > 0) e.push(vertex(p.x, p.y, layer.z, lengths[i], layer.z, g0));
                }
                starts.push(s);
                ends.push(e);
            });
            groups += layers.length * n * 2;
            for (let l = 0; l + 1 < layers.length; l++) {
                for (let i = 0; i < n; i++) {
                    const a = starts[l][i], b = ends[l][i], c = ends[l + 1][i], d = starts[l + 1][i];
                    index.push(a, b, c, a, c, d);
                }
            }
        });
    }

    // Normals: area-weighted face normals summed per smoothing group; a cap's is its own.
    const sums = new Float64Array(groups * 3);
    for (let t = 0; t < index.length; t += 3) {
        const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
        const ux = position[b * 3] - position[a * 3], uy = position[b * 3 + 1] - position[a * 3 + 1], uz = position[b * 3 + 2] - position[a * 3 + 2];
        const vx = position[c * 3] - position[a * 3], vy = position[c * 3 + 1] - position[a * 3 + 1], vz = position[c * 3 + 2] - position[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const v of [a, b, c]) {
            const gi = group[v];
            if (gi < 0) continue;
            sums[gi * 3] += nx; sums[gi * 3 + 1] += ny; sums[gi * 3 + 2] += nz;
        }
    }
    const normal = new Float32Array(position.length);
    for (let v = 0; v < group.length; v++) {
        const f = fixed[v];
        if (f) { normal.set(f, v * 3); continue; }
        const gi = group[v];
        const x = sums[gi * 3], y = sums[gi * 3 + 1], z = sums[gi * 3 + 2];
        const l = Math.hypot(x, y, z) || 1;
        normal[v * 3] = x / l; normal[v * 3 + 1] = y / l; normal[v * 3 + 2] = z / l;
    }
    return {
        type: "buffer",
        position: new Float32Array(position),
        normal,
        uv: new Float32Array(uv),
        index: new Uint32Array(index),
        staticData: true,
    };
}
