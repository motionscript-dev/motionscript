import { describe, expect, it } from "vitest";
import type { PathData } from "../../../doc";
import { PathBuilder } from "../../../doc";
import { arcTo, parseSvgPath } from "../../svg-path";
import { EllipseGeometry } from "../ellipse";
import { RectGeometry } from "../rect";
import type { ShapeGeometry } from "../base";

/** Deterministic, so a failure reproduces from its seed. */
function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Values that print in every form a number can take: exponents both ways, −0, long fractions. */
function awkward(rand: () => number): number {
    const pick = rand();
    if (pick < 0.1) return -0;
    if (pick < 0.2) return (rand() - 0.5) * 1e-8;
    if (pick < 0.25) return (rand() - 0.5) * 1e22;
    if (pick < 0.4) return Math.round((rand() - 0.5) * 400);
    return (rand() - 0.5) * 400;
}

/** What the adapter drew from before: the SVG string, parsed. */
const parsed = <G>(shape: ShapeGeometry<any, G>): PathData | null => {
    const svg = shape.buildSVGPath(shape.geometry);
    return svg ? parseSvgPath(svg) : null;
};

const bits = (d: PathData | null) => d && { verbs: [...d.verbs], points: [...new Uint32Array(d.points.buffer)] };

function rectState(rand: () => number): Record<string, unknown> {
    const radius = rand() < 0.4 ? 0 : rand() < 0.5 ? awkward(rand) : { topLeft: awkward(rand), topRight: rand() * 30, bottomRight: 0, bottomLeft: rand() * 80 };
    return {
        x: awkward(rand), y: awkward(rand), width: Math.abs(awkward(rand)), height: Math.abs(awkward(rand)),
        cornerRadius: radius, cornerStyle: rand() < 0.3 ? "angled" : "rounded",
    };
}

function ellipseState(rand: () => number): Record<string, unknown> {
    return {
        x: awkward(rand), y: awkward(rand), width: Math.abs(awkward(rand)), height: Math.abs(awkward(rand)),
        ...(rand() < 0.5 && { sweep: rand() < 0.2 ? -270 : awkward(rand) }),
        ...(rand() < 0.5 && { startAngle: awkward(rand) }),
        ...(rand() < 0.5 && { ratio: rand() < 0.2 ? 1 : rand() }),
    };
}

describe("a shape outline written straight into path data", () => {
    it("is bit for bit the parsed SVG string, for rects and ellipses", () => {
        const rand = random(7);
        for (let i = 0; i < 4000; i++) {
            const shape: ShapeGeometry<any, any> = i % 2 === 0 ? new RectGeometry(rectState(rand) as never) : new EllipseGeometry(ellipseState(rand) as never);
            expect(bits(shape.buildPathData(shape.geometry)), JSON.stringify(shape.fullState)).toEqual(bits(parsed(shape)));
        }
    });

    it("takes the string route for a number the string cannot carry", () => {
        for (const bad of [NaN, Infinity, -Infinity]) {
            const rect = new RectGeometry({ x: bad, y: 0, width: 10, height: 10 } as never);
            const ellipse = new EllipseGeometry({ x: 0, y: 0, width: bad, height: 10 } as never);
            expect(bits(rect.buildPathData(rect.geometry))).toEqual(bits(parsed(rect)));
            expect(bits(ellipse.buildPathData(ellipse.geometry))).toEqual(bits(parsed(ellipse)));
        }
    });

    it("is nothing for an empty outline", () => {
        const ring = new EllipseGeometry({ x: 0, y: 0, width: 10, height: 10, ratio: 1 } as never);
        expect(ring.buildSVGPath(ring.geometry)).toBe("");
        expect(ring.buildPathData(ring.geometry)).toBeNull();
    });

    it("keeps the SVG string as it was", () => {
        const rect = new RectGeometry({ x: 0, y: 0, width: 20, height: 10, cornerRadius: 2 } as never);
        expect(rect.buildSVGPath(rect.geometry)).toBe("M -8 -5 L 8 -5 A 2 2 0 0 1 10 -3 L 10 3 A 2 2 0 0 1 8 5 L -8 5 A 2 2 0 0 1 -10 3 L -10 -3 A 2 2 0 0 1 -8 -5 Z");
        // A radius that is not a number still rounds its corners, as `radius <= 0` never held for it.
        const unset = new RectGeometry({ x: 0, y: 0, width: 2, height: 2, cornerRadius: NaN } as never);
        expect(unset.buildSVGPath(unset.geometry)).toBe("M -1 -1 L 1 -1 A NaN NaN 0 0 1 NaN NaN L 1 1 A NaN NaN 0 0 1 NaN NaN L -1 1 A NaN NaN 0 0 1 NaN NaN L -1 -1 A NaN NaN 0 0 1 NaN NaN Z");
        const donut = new EllipseGeometry({ x: 0, y: 0, width: 4, height: 2, ratio: 0.5 } as never);
        expect(donut.buildSVGPath(donut.geometry)).toBe("M -2 0 A 2 1 0 1 0 2 0 A 2 1 0 1 0 -2 0 Z M -1 0 A 1 0.5 0 1 1 1 0 A 1 0.5 0 1 1 -1 0 Z");
    });

    it("turns arcs into the same cubics as before", () => {
        const rand = random(7);
        let h = 0x811c9dc5;
        for (let i = 0; i < 5000; i++) {
            const b = new PathBuilder().moveTo((rand() - 0.5) * 500, (rand() - 0.5) * 500);
            arcTo(b, (rand() - 0.5) * 500, (rand() - 0.5) * 500, rand() < 0.05 ? 0 : rand() * 300, rand() * 300, rand() < 0.5 ? 0 : rand() * 6, rand() < 0.5, rand() < 0.5, (rand() - 0.5) * 500, (rand() - 0.5) * 500);
            const d = b.build();
            for (const v of d.verbs) h = Math.imul(h ^ v, 0x01000193);
            for (const v of new Uint32Array(d.points.buffer)) h = Math.imul(h ^ v, 0x01000193);
        }
        expect((h >>> 0).toString(16)).toBe("968875b2");
    });
});
