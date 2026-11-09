import { type LineState, type Vector2, withLineDescriptor } from "@motionscript/core";
import { ShapeGeometry } from "./base";

type LineGeo = { points: Vector2[]; radius: number; closed: boolean };

function buildLineSvg(points: Vector2[], radius: number, closed: boolean): string {
    if (points.length === 0) return "M 0 0";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    const r = Math.max(0, radius);
    const parts: string[] = [];
    const count = points.length;
    const dir = (a: Vector2, b: Vector2) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        return len > 0 ? { dx: dx / len, dy: dy / len, len } : { dx: 0, dy: 0, len: 0 };
    };
    if (r === 0) {
        parts.push(`M ${points[0].x} ${points[0].y}`);
        for (let i = 1; i < count; i++) parts.push(`L ${points[i].x} ${points[i].y}`);
    } else {
        const endIdx = closed ? count : count - 1;
        for (let i = 0; i <= endIdx; i++) {
            const prev = points[(i - 1 + count) % count];
            const curr = points[i % count];
            const next = points[(i + 1) % count];
            if (!closed && i === 0) {
                parts.push(`M ${curr.x} ${curr.y}`);
                continue;
            }
            if (!closed && i === count - 1) {
                parts.push(`L ${curr.x} ${curr.y}`);
                continue;
            }
            const dIn = dir(prev, curr), dOut = dir(curr, next);
            const cutIn = Math.min(r, dIn.len / 2), cutOut = Math.min(r, dOut.len / 2);
            const inX = curr.x - dIn.dx * cutIn, inY = curr.y - dIn.dy * cutIn;
            const outX = curr.x + dOut.dx * cutOut, outY = curr.y + dOut.dy * cutOut;
            parts.push(`${i === 0 && closed ? "M" : "L"} ${inX} ${inY}`);
            parts.push(`Q ${curr.x} ${curr.y} ${outX} ${outY}`);
        }
    }
    if (closed) parts.push("Z");
    return parts.join(" ");
}

/**
 * A polyline (open or closed) through `points`, each corner optionally rounded
 * by cutting back along both edges and joining with a quadratic (the cut
 * clamped to half the edge, so it never overshoots).
 */
export class LineGeometry extends ShapeGeometry<LineState, LineGeo> {
    protected resolveState(state: Partial<LineState>): LineState {
        return withLineDescriptor(state);
    }

    protected computeGeometry(): LineGeo {
        const { points, radius, closed } = this.fullState;
        return { points, radius, closed };
    }

    buildSVGPath(geo: LineGeo): string {
        return buildLineSvg(geo.points, geo.radius, geo.closed);
    }
}
