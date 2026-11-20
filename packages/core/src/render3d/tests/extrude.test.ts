import { describe, expect, it } from "vitest";
import { evaluateExtrude, extrudeRings, extrudeShapes, triangulate } from "../extrude";
import { geometryBounds3D } from "../bounds3d";
import type { BufferGeometry3D } from "../geometry";

const SQUARE = "M -1 -1 L 1 -1 L 1 1 L -1 1 Z";
const HOLE = "M -0.5 -0.5 L -0.5 0.5 L 0.5 0.5 L 0.5 -0.5 Z";
const CIRCLE = "M 1 0 A 1 1 0 1 1 -1 0 A 1 1 0 1 1 1 0 Z";

/** The summed area of the triangles whose normal faces `z` (+1 the back cap, -1 the front). */
function capArea(g: BufferGeometry3D, z: number): number {
    const p = g.position, ix = g.index!;
    let total = 0;
    for (let t = 0; t < ix.length; t += 3) {
        const [a, b, c] = [ix[t], ix[t + 1], ix[t + 2]];
        const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1];
        const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1];
        const nz = ux * vy - uy * vx;
        const flat = p[a * 3 + 2] === p[b * 3 + 2] && p[b * 3 + 2] === p[c * 3 + 2];
        if (flat && Math.sign(nz) === z) total += Math.abs(nz) / 2;
    }
    return total;
}

describe("evaluateExtrude", () => {
    it("caps an outline front and back, wound to face out", () => {
        const g = evaluateExtrude({ type: "extrude", path: SQUARE, depth: 2 });
        expect(capArea(g, 1)).toBeCloseTo(4, 9);
        expect(capArea(g, -1)).toBeCloseTo(4, 9);
        expect(geometryBounds3D({ type: "extrude", path: SQUARE, depth: 2 })).toEqual({ min: { x: -1, y: -1, z: 0 }, max: { x: 1, y: 1, z: 2 } });
    });

    it("leaves a contour inside another open, whichever way either is wound", () => {
        for (const hole of [HOLE, "M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 L -0.5 0.5 Z"]) {
            const g = evaluateExtrude({ type: "extrude", path: `${SQUARE} ${hole}`, depth: 1 });
            expect(capArea(g, 1)).toBeCloseTo(3, 9);
            expect(capArea(g, -1)).toBeCloseTo(3, 9);
        }
    });

    it("turns the walls of an outline outward and the walls of a hole inward", () => {
        const g = evaluateExtrude({ type: "extrude", path: `${SQUARE} ${HOLE}`, depth: 1 });
        const p = g.position, n = g.normal!;
        for (let v = 0; v < p.length / 3; v++) {
            if (Math.abs(n[v * 3 + 2]) > 0.5) continue;
            const x = p[v * 3], y = p[v * 3 + 1], radial = x * n[v * 3] + y * n[v * 3 + 1];
            const outerWall = Math.max(Math.abs(x), Math.abs(y)) > 0.75;
            expect(outerWall ? radial > 0 : radial < 0).toBe(true);
        }
    });

    it("draws a curve smooth, its wall normals pointing straight out", () => {
        const g = evaluateExtrude({ type: "extrude", path: CIRCLE, depth: 1, segments: 24 });
        const p = g.position, n = g.normal!;
        for (let v = 0; v < p.length / 3; v++) {
            if (Math.abs(n[v * 3 + 2]) > 0.5) continue;
            const r = Math.hypot(p[v * 3], p[v * 3 + 1]);
            expect(n[v * 3] * (p[v * 3] / r) + n[v * 3 + 1] * (p[v * 3 + 1] / r)).toBeGreaterThan(0.99);
        }
        expect(capArea(g, 1)).toBeCloseTo(Math.PI, 1);
    });

    it("rounds the rims with a bevel: wider by its size, longer by its thickness both ways", () => {
        const geometry = { type: "extrude", path: SQUARE, depth: 1, bevel: { size: 0.2, thickness: 0.3, segments: 4 } } as const;
        const g = evaluateExtrude(geometry);
        let min = Infinity, max = -Infinity, wide = 0;
        for (let v = 0; v < g.position.length / 3; v++) {
            min = Math.min(min, g.position[v * 3 + 2]);
            max = Math.max(max, g.position[v * 3 + 2]);
            wide = Math.max(wide, g.position[v * 3]);
        }
        expect([min, max]).toEqual([-0.3, 1.3].map((z) => expect.closeTo(z, 6)));
        expect(wide).toBeCloseTo(1.2, 6);
        expect(geometryBounds3D(geometry)).toEqual({ min: { x: -1.2, y: -1.2, z: -0.3 }, max: { x: 1.2, y: 1.2, z: 1.3 } });
    });

    it("triangulates a concave outline with two holes into exactly its area", () => {
        const star = Array.from({ length: 10 }, (_, i) => {
            const r = i % 2 ? 0.45 : 1, a = Math.PI / 2 + (i * Math.PI) / 5;
            return { x: r * Math.cos(a), y: r * Math.sin(a) };
        });
        const tris = triangulate(star, []);
        expect(tris).toHaveLength(8 * 3);
        const rings = extrudeRings(`${SQUARE} M -0.8 -0.8 L -0.8 -0.2 L -0.2 -0.2 L -0.2 -0.8 Z M 0.2 0.2 L 0.2 0.8 L 0.8 0.8 L 0.8 0.2 Z`, 12);
        const [shape] = extrudeShapes(rings);
        expect(shape.holes).toHaveLength(2);
        const pts = [...shape.outer, ...shape.holes.flat()];
        const ix = triangulate(shape.outer, shape.holes);
        let total = 0;
        for (let t = 0; t < ix.length; t += 3) {
            const [a, b, c] = [pts[ix[t]], pts[ix[t + 1]], pts[ix[t + 2]]];
            const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
            expect(cross).toBeGreaterThanOrEqual(0);
            total += cross / 2;
        }
        expect(total).toBeCloseTo(4 - 0.36 - 0.36, 9);
    });

    it("keeps an island inside a hole as a solid of its own", () => {
        const rings = extrudeRings(`${SQUARE} ${HOLE} M -0.2 -0.2 L 0.2 -0.2 L 0.2 0.2 L -0.2 0.2 Z`, 12);
        expect(extrudeShapes(rings).map((s) => s.holes.length).sort()).toEqual([0, 1]);
    });

    it("hands back the same buffer for the same outline", () => {
        expect(evaluateExtrude({ type: "extrude", path: SQUARE })).toBe(evaluateExtrude({ type: "extrude", path: SQUARE }));
        expect(evaluateExtrude({ type: "extrude", path: "" }).position).toHaveLength(0);
    });
});
