import type { PathCommand, Vector2 } from "@motionscript/sdk";
import { add, between, heading } from "./follow";

/** How far a quarter circle's control points sit along its tangents, as a share of its radius. */
const QUARTER = 0.5523;

/**
 * A curly brace from `from` to `to`, bulging toward `out` (a unit vector) and
 * `reach` deep at its tip: what a brace node draws, and a sample space beside
 * its parts. Path commands, y-up.
 */
export function braceOutline(from: Vector2, to: Vector2, out: Vector2, reach: number): PathCommand[] {
    const { unit, length } = heading(from, to);
    if (length === 0) return [];
    const r = Math.min(reach / 2, length / 4);
    const mid = between(from, to);
    const lift = (p: Vector2, k: number) => add(p, out, k * r);
    const along = (p: Vector2, k: number) => add(p, unit, k * r);
    const h = QUARTER;
    const curve = (c1: Vector2, c2: Vector2, end: Vector2): PathCommand => ({
        type: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y,
    });
    const a = lift(along(from, 1), 1);
    const b = lift(along(mid, -1), 1);
    const tip = lift(mid, 2);
    const c = lift(along(mid, 1), 1);
    const d = lift(along(to, -1), 1);
    return [
        { type: "M", x: from.x, y: from.y },
        curve(lift(from, h), lift(along(from, 1 - h), 1), a),
        { type: "L", x: b.x, y: b.y },
        curve(lift(along(mid, -1 + h), 1), lift(mid, 2 - h), tip),
        curve(lift(mid, 2 - h), lift(along(mid, 1 - h), 1), c),
        { type: "L", x: d.x, y: d.y },
        curve(lift(along(to, -1 + h), 1), lift(to, h), to),
    ];
}
