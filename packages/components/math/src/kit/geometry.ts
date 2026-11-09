import type { Extents, PathCommand, Vector2 } from "@motionscript/sdk";

/**
 * Runs of pixel points as path commands. Commands are y-up like every other
 * `Graphics2D` op (only an SVG `d` string is y-down), so nothing is flipped here.
 */
export function runsToPath(runs: readonly (readonly Vector2[])[], closed = false): PathCommand[] {
    const out: PathCommand[] = [];
    for (const run of runs) {
        if (run.length < 2) continue;
        out.push({ type: "M", x: run[0].x, y: run[0].y });
        for (let i = 1; i < run.length; i++) out.push({ type: "L", x: run[i].x, y: run[i].y });
        if (closed) out.push({ type: "Z" });
    }
    return out;
}

export function boundsOfRuns(runs: readonly (readonly Vector2[])[]): Extents | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const run of runs) {
        if (run.length < 2) continue;
        for (const p of run) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
    }
    return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/** `area` grown by `margin` on every side. */
export function inflate(area: Extents, margin: number): Extents {
    return { minX: area.minX - margin, minY: area.minY - margin, maxX: area.maxX + margin, maxY: area.maxY + margin };
}

export function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

/** `data` without the arguments a command was not given, which arrive as `undefined` and are not destinations. */
export function stated<T extends object>(data: T | undefined): Partial<T> {
    const out: Partial<T> = {};
    if (!data) return out;
    for (const key of Object.keys(data) as (keyof T)[]) {
        if (data[key] !== undefined) out[key] = data[key];
    }
    return out;
}
