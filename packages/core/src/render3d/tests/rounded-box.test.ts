import { describe, expect, it } from 'vitest';
import { evaluateRoundedBox, type RoundedBoxOptions } from '@/render3d/rounded-box';

const options = (overrides: Partial<RoundedBoxOptions> = {}): RoundedBoxOptions => ({
    width: 2, height: 2, depth: 2, radius: 0.5, segments: [1, 1, 1], ...overrides,
});

/** Position i as a plain triple. */
const vertex = (buffer: ArrayLike<number>, i: number): [number, number, number] =>
    [buffer[i * 3], buffer[i * 3 + 1], buffer[i * 3 + 2]];

/** The patch count the module documents: 6 faces, 12 edges, 8 corners. */
const PATCHES = { face: 6, edge: 12, corner: 8 };

/** The arc resolution the module derives: clamp(round(radius / maxHalf * 40), 3, 16). */
const arcFor = (radius: number, maxHalf: number): number =>
    Math.max(3, Math.min(16, Math.round((radius / maxHalf) * 40)));

describe('evaluateRoundedBox', () => {
    it('returns a static buffer geometry with typed arrays', () => {
        const geometry = evaluateRoundedBox(options());
        expect(geometry.type).toBe('buffer');
        expect(geometry.staticData).toBe(true);
        expect(geometry.position).toBeInstanceOf(Float32Array);
        expect(geometry.normal).toBeInstanceOf(Float32Array);
        expect(geometry.uv).toBeInstanceOf(Float32Array);
        expect(geometry.index).toBeInstanceOf(Uint32Array);
    });

    it('keeps the attribute arrays the same length per vertex, and every index in range', () => {
        const { position, normal, uv, index } = evaluateRoundedBox(options({ segments: [2, 3, 4] }));
        const count = position.length / 3;
        expect(Number.isInteger(count)).toBe(true);
        expect(normal!.length).toBe(count * 3);
        expect(uv!.length).toBe(count * 2);
        expect(index!.length % 3).toBe(0);
        for (let i = 0; i < index!.length; i++) {
            expect(index![i]).toBeGreaterThanOrEqual(0);
            expect(index![i]).toBeLessThan(count);
        }
    });

    it('counts vertices as 26 patches: faces by segments, edges and corners by the derived arc', () => {
        // radius 0.5 on a unit-half box: round(0.5 / 1 * 40) = 20, capped at 16.
        const radius = 0.5;
        const half = 1;
        const arc = arcFor(radius, half);
        expect(arc).toBe(16);

        const [sx, sy, sz] = [2, 3, 4];
        const { position } = evaluateRoundedBox(options({ radius, segments: [sx, sy, sz] }));

        // Face on axis a is (segments[(a+1)%3] + 1) * (segments[(a+2)%3] + 1), twice per axis.
        const faces = 2 * ((sy + 1) * (sz + 1) + (sz + 1) * (sx + 1) + (sx + 1) * (sy + 1));
        // Each of the four edges of an axis is (arc + 1) * (segments[axis] + 1).
        const edges = 4 * (arc + 1) * ((sx + 1) + (sy + 1) + (sz + 1));
        const corners = PATCHES.corner * (arc + 1) * (arc + 1);

        expect(position.length / 3).toBe(faces + edges + corners);
    });

    it('derives the arc count from the radius relative to the box, between 3 and 16', () => {
        const vertices = (radius: number, size = 2) =>
            evaluateRoundedBox(options({ width: size, height: size, depth: size, radius })).position.length / 3;
        const expected = (radius: number, half: number) => {
            const arc = arcFor(radius, half);
            return 6 * 4 + 12 * (arc + 1) * 2 + PATCHES.corner * (arc + 1) ** 2;
        };

        // A barely rounded edge gets the minimum (3), a nearly spherical one the cap (16).
        expect(arcFor(0.01, 1)).toBe(3);
        expect(vertices(0.01)).toBe(expected(0.01, 1));
        expect(arcFor(0.2, 1)).toBe(8);
        expect(vertices(0.2)).toBe(expected(0.2, 1));
        expect(vertices(1)).toBe(expected(1, 1));
    });

    it('winds every triangle to face along the vertex normal', () => {
        const geometry = evaluateRoundedBox(options({ width: 2, height: 3, depth: 4, radius: 0.4, segments: [2, 2, 2] }));
        const { position, normal, index } = geometry;
        let checked = 0;

        for (let t = 0; t < index!.length; t += 3) {
            const [a, b, c] = [index![t], index![t + 1], index![t + 2]];
            const pa = vertex(position, a);
            const pb = vertex(position, b);
            const pc = vertex(position, c);
            const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
            const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
            const face = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ];
            // Compare against the average of the three vertex normals.
            const n = [0, 1, 2].map((k) => (normal![a * 3 + k] + normal![b * 3 + k] + normal![c * 3 + k]) / 3);
            const facing = face[0] * n[0] + face[1] * n[1] + face[2] * n[2];
            expect(facing).toBeGreaterThan(0);
            checked++;
        }
        expect(checked).toBeGreaterThan(100);
    });

    it('emits unit normals', () => {
        const { normal } = evaluateRoundedBox(options({ radius: 0.3, segments: [2, 2, 2] }));
        for (let i = 0; i < normal!.length / 3; i++) {
            expect(Math.hypot(...vertex(normal!, i))).toBeCloseTo(1, 5);
        }
    });

    it('keeps every vertex inside the box and puts the extremes exactly on its faces', () => {
        const { position } = evaluateRoundedBox(options({ width: 2, height: 4, depth: 6, radius: 0.5 }));
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < position.length / 3; i++) {
            const p = vertex(position, i);
            for (let k = 0; k < 3; k++) {
                lo[k] = Math.min(lo[k], p[k]);
                hi[k] = Math.max(hi[k], p[k]);
            }
        }
        expect(lo.map((v) => +v.toFixed(5))).toEqual([-1, -2, -3]);
        expect(hi.map((v) => +v.toFixed(5))).toEqual([1, 2, 3]);
    });

    it('rounds the corners: no vertex sits at a corner of the bounding box', () => {
        const { position } = evaluateRoundedBox(options({ radius: 0.5 }));
        for (let i = 0; i < position.length / 3; i++) {
            const [x, y, z] = vertex(position, i);
            expect(Math.hypot(x, y, z)).toBeLessThan(Math.hypot(1, 1, 1) - 1e-3);
        }
    });

    it('with a radius of zero builds only the six flat faces, with the face normals', () => {
        const { position, normal, index } = evaluateRoundedBox(options({ radius: 0, segments: [1, 1, 1] }));
        expect(position.length / 3).toBe(6 * 4);
        expect(index!.length / 3).toBe(6 * 2);

        // Every vertex sits on a corner of the box.
        for (let i = 0; i < position.length / 3; i++) {
            for (const component of vertex(position, i)) expect(Math.abs(component)).toBeCloseTo(1, 6);
        }
        // Normals are axis-aligned unit vectors.
        for (let i = 0; i < normal!.length / 3; i++) {
            const n = vertex(normal!, i).map(Math.abs);
            expect(n.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
        }
    });

    it('treats a negative radius as zero', () => {
        const flat = evaluateRoundedBox(options({ radius: 0 }));
        const negative = evaluateRoundedBox(options({ radius: -2 }));
        expect(Array.from(negative.position)).toEqual(Array.from(flat.position));
    });

    it('clamps the radius to the smallest half-extent', () => {
        const clamped = evaluateRoundedBox(options({ width: 4, height: 1, depth: 4, radius: 100 }));
        const exact = evaluateRoundedBox(options({ width: 4, height: 1, depth: 4, radius: 0.5 }));
        expect(Array.from(clamped.position)).toEqual(Array.from(exact.position));
        expect(Array.from(clamped.index!)).toEqual(Array.from(exact.index!));
    });

    it('subdivides the flat faces by segments, which is what a displacement map reads', () => {
        const coarse = evaluateRoundedBox(options({ segments: [1, 1, 1] })).position.length;
        const fine = evaluateRoundedBox(options({ segments: [4, 4, 4] })).position.length;
        expect(fine).toBeGreaterThan(coarse);
    });

    it('drops the degenerate triangles of a collapsed axis instead of emitting an undefined normal', () => {
        // A zero-depth box: both z faces coincide and the edge patches along z collapse.
        const geometry = evaluateRoundedBox(options({ depth: 0, radius: 0 }));
        const { position, normal, index } = geometry;
        for (let i = 0; i < normal!.length; i++) expect(Number.isFinite(normal![i])).toBe(true);
        for (let i = 0; i < position.length; i++) expect(Number.isFinite(position[i])).toBe(true);

        for (let t = 0; t < index!.length; t += 3) {
            const [a, b, c] = [index![t], index![t + 1], index![t + 2]];
            const pa = vertex(position, a);
            const pb = vertex(position, b);
            const pc = vertex(position, c);
            const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
            const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
            const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            expect(Math.hypot(...cross)).toBeGreaterThan(1e-9);
        }
        // Only the two big faces survive with area.
        expect(index!.length / 3).toBe(4);
    });

    it('survives a box collapsed on every axis without producing triangles or NaN', () => {
        const geometry = evaluateRoundedBox(options({ width: 0, height: 0, depth: 0, radius: 0 }));
        expect(geometry.index!.length).toBe(0);
        for (let i = 0; i < geometry.uv!.length; i++) expect(Number.isFinite(geometry.uv![i])).toBe(true);
    });

    it('projects box UVs onto the faces: 0..1 across a face, centred at 0.5', () => {
        const { position, normal, uv } = evaluateRoundedBox(options({ radius: 0, segments: [1, 1, 1] }));
        // The +Z face (normal 0,0,1): u runs along X and v along Y.
        for (let i = 0; i < position.length / 3; i++) {
            const n = vertex(normal!, i);
            if (n[2] !== 1) continue;
            const p = vertex(position, i);
            // axis 2 -> u = axis 0 (x), v = axis 1 (y)
            expect(uv![i * 2]).toBeCloseTo(0.5 + p[0] / 2, 6);
            expect(uv![i * 2 + 1]).toBeCloseTo(0.5 + p[1] / 2, 6);
        }
        for (let i = 0; i < uv!.length; i++) {
            expect(uv![i]).toBeGreaterThanOrEqual(-1e-6);
            expect(uv![i]).toBeLessThanOrEqual(1 + 1e-6);
        }
    });

    it('is deterministic: the same options build identical buffers', () => {
        const a = evaluateRoundedBox(options({ segments: [2, 2, 2] }));
        const b = evaluateRoundedBox(options({ segments: [2, 2, 2] }));
        expect(Array.from(a.position)).toEqual(Array.from(b.position));
        expect(Array.from(a.index!)).toEqual(Array.from(b.index!));
    });
});
