import type { Vector2 } from "@motionscript/sdk";

/**
 * The lines along which a function of two variables is zero, over a box of
 * graph values: marching squares, its crossings placed by linear interpolation
 * and joined end to end into runs. Points are graph coordinates.
 */
export function traceContour(
    f: (x: number, y: number) => number,
    [x0, x1]: readonly [number, number],
    [y0, y1]: readonly [number, number],
    columns: number,
    rows: number,
): Vector2[][] {
    if (!(x1 > x0) || !(y1 > y0) || columns < 1 || rows < 1) return [];
    const dx = (x1 - x0) / columns;
    const dy = (y1 - y0) / rows;
    const stride = columns + 1;
    const values = new Float64Array(stride * (rows + 1));
    for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= columns; i++) values[j * stride + i] = f(x0 + i * dx, y0 + j * dy);
    }

    // A crossing lives on a grid edge, which is its name: two cells sharing the edge share the point.
    const points = new Map<number, Vector2>();
    const edgeCount = stride * (rows + 1);
    const crossing = (i: number, j: number, vertical: boolean): number | null => {
        const a = values[j * stride + i];
        const b = vertical ? values[(j + 1) * stride + i] : values[j * stride + i + 1];
        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 === b < 0) return null;
        const key = (vertical ? edgeCount : 0) + j * stride + i;
        if (!points.has(key)) {
            const t = a / (a - b);
            points.set(key, vertical ? { x: x0 + i * dx, y: y0 + (j + t) * dy } : { x: x0 + (i + t) * dx, y: y0 + j * dy });
        }
        return key;
    };

    const next = new Map<number, number[]>();
    const join = (a: number | null, b: number | null): void => {
        if (a === null || b === null) return;
        (next.get(a) ?? next.set(a, []).get(a)!).push(b);
        (next.get(b) ?? next.set(b, []).get(b)!).push(a);
    };
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < columns; i++) {
            const bottom = crossing(i, j, false);
            const top = crossing(i, j + 1, false);
            const left = crossing(i, j, true);
            const right = crossing(i + 1, j, true);
            const found = [bottom, right, top, left].filter((edge) => edge !== null);
            if (found.length === 2) join(found[0], found[1]);
            else if (found.length === 4) {
                // A saddle: the centre's sign says which pairs of edges the curve joins.
                const centre = f(x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy);
                const corner = values[j * stride + i];
                if (centre < 0 === corner < 0) {
                    join(bottom, right);
                    join(top, left);
                } else {
                    join(bottom, left);
                    join(top, right);
                }
            }
        }
    }

    const runs: Vector2[][] = [];
    const used = new Set<number>();
    const walk = (from: number): Vector2[] => {
        const run: Vector2[] = [points.get(from)!];
        used.add(from);
        let at = from;
        for (;;) {
            const onward = (next.get(at) ?? []).find((key) => !used.has(key));
            if (onward === undefined) break;
            used.add(onward);
            run.push(points.get(onward)!);
            at = onward;
        }
        return run;
    };
    // Open runs first, from their ends, so each is one run and not two halves.
    for (const [key, links] of next) {
        if (links.length === 1 && !used.has(key)) runs.push(walk(key));
    }
    for (const key of next.keys()) {
        if (used.has(key)) continue;
        const run = walk(key);
        run.push(run[0]);
        runs.push(run);
    }
    return runs.filter((run) => run.length > 1);
}
