import { type CornerStyle, type PolygonState, type PolygramState, withPolygonDescriptor, withPolygramDescriptor } from "@motionscript/core";
import { type Bounds, cornerCommandsFromCut, ShapeGeometry } from "./base";

type PolygonGeo = {
    cx: number; cy: number;
    rx: number; ry: number;
    sides: number;
    /** Polygram only: the inner vertices' radius, as a fraction of the outer. */
    ratio: number;
    cornerRadius: number;
    cornerStyle: CornerStyle;
};

/**
 * Vertices on an ellipse from the top, clockwise. `rounded(i)` says which
 * vertices `cornerRadius` rounds; each is cut back along both edges, clamped
 * so neighbouring corners never overrun half the edge they share.
 */
function buildSvg(verts: [number, number][], g: PolygonGeo, rounded: (i: number) => boolean): string {
    if (g.cornerRadius <= 0) {
        const parts = verts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`);
        parts.push("Z");
        return parts.join(" ");
    }
    const n = verts.length;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
        const curr = verts[i];
        if (!rounded(i)) {
            parts.push(`${parts.length === 0 ? "M" : "L"} ${curr[0]} ${curr[1]}`);
            continue;
        }
        const prev = verts[(i - 1 + n) % n], next = verts[(i + 1) % n];
        const a0x = prev[0] - curr[0], a0y = prev[1] - curr[1];
        const len0 = Math.hypot(a0x, a0y);
        const u0x = a0x / len0, u0y = a0y / len0;
        const a1x = next[0] - curr[0], a1y = next[1] - curr[1];
        const len1 = Math.hypot(a1x, a1y);
        const u1x = a1x / len1, u1y = a1y / len1;
        const cosAngle = Math.max(-1, Math.min(1, u0x * u1x + u0y * u1y));
        const tanHalf = Math.tan(Math.acos(cosAngle) / 2);
        const t = Math.min(g.cornerRadius / tanHalf, Math.min(len0, len1) / 2);
        const r = t * tanHalf;
        parts.push(`${parts.length === 0 ? "M" : "L"} ${curr[0] + u0x * t} ${curr[1] + u0y * t}`);
        parts.push(cornerCommandsFromCut(curr[0], curr[1], u0x, u0y, u1x, u1y, t, r, g.cornerStyle));
    }
    parts.push("Z");
    return parts.join(" ");
}

const bounds = (g: PolygonGeo): Bounds => ({ left: g.cx - g.rx, top: g.cy - g.ry, right: g.cx + g.rx, bottom: g.cy + g.ry });

/** A regular polygon inscribed in the box's ellipse, starting at the top vertex. */
export class PolygonGeometry extends ShapeGeometry<PolygonState, PolygonGeo> {
    protected resolveState(state: Partial<PolygonState>): PolygonState {
        return withPolygonDescriptor(state);
    }

    protected computeGeometry(): PolygonGeo {
        const s = this.fullState;
        return {
            cx: s.x, cy: s.y, rx: s.width / 2, ry: s.height / 2,
            sides: Math.max(3, Math.round(s.sides)), ratio: 1,
            cornerRadius: s.cornerRadius, cornerStyle: s.cornerStyle,
        };
    }

    buildSVGPath(g: PolygonGeo): string {
        const step = (2 * Math.PI) / g.sides;
        const verts: [number, number][] = [];
        for (let i = 0; i < g.sides; i++) {
            const a = -Math.PI / 2 + i * step;
            verts.push([g.cx + g.rx * Math.cos(a), g.cy + g.ry * Math.sin(a)]);
        }
        return buildSvg(verts, g, () => true);
    }

    override computeBounds(g: PolygonGeo): Bounds {
        return bounds(g);
    }
}

/** A star: outer vertices alternating with inner ones at `ratio`; only the outer (convex) ones are rounded. */
export class PolygramGeometry extends ShapeGeometry<PolygramState, PolygonGeo> {
    protected resolveState(state: Partial<PolygramState>): PolygramState {
        return withPolygramDescriptor(state);
    }

    protected computeGeometry(): PolygonGeo {
        const s = this.fullState;
        return {
            cx: s.x, cy: s.y, rx: s.width / 2, ry: s.height / 2,
            sides: Math.max(3, Math.round(s.sides)), ratio: Math.max(0, Math.min(1, s.ratio)),
            cornerRadius: s.cornerRadius, cornerStyle: s.cornerStyle,
        };
    }

    buildSVGPath(g: PolygonGeo): string {
        const step = Math.PI / g.sides;
        const verts: [number, number][] = [];
        for (let i = 0; i < g.sides * 2; i++) {
            const a = -Math.PI / 2 + i * step;
            const r = i % 2 === 0 ? 1 : g.ratio;
            verts.push([g.cx + g.rx * r * Math.cos(a), g.cy + g.ry * r * Math.sin(a)]);
        }
        return buildSvg(verts, g, (i) => i % 2 === 0);
    }

    override computeBounds(g: PolygonGeo): Bounds {
        return bounds(g);
    }
}
