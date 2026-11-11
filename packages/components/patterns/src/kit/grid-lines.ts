import { strokeOps, type PathCommand, type Stroke, type StrokeProp, type StrokeResolved } from "@motionscript/sdk";

/** A grid extent on one axis: lines tile within `[min, max]`, on a lattice that starts at `anchor`. */
export interface GridAxis {
    min: number;
    max: number;
    /** Spacing between adjacent (minor) lines. */
    step: number;
    /** Pan offset in pixels. */
    offset: number;
    /**
     * Where the lattice starts: a line sits at `anchor + n * step`, and the tile
     * index `n` that decides which lines are major counts from there. Omitted it is
     * 0, the world origin, which a camera-following grid keeps. A grid with a box of
     * its own sets it to `min`, so the box's edges are lines whatever the cell count.
     */
    anchor?: number;
}

/** Where each line sits, split into major (division) and minor (subdivision) lines. Vertical lines run `top` to `bottom`, horizontal ones `left` to `right`. */
interface GridLines {
    top: number;
    bottom: number;
    left: number;
    right: number;
    verticalMajor: number[];
    verticalMinor: number[];
    horizontalMajor: number[];
    horizontalMinor: number[];
}

/**
 * The cross-axis spans and the major/minor line positions per axis. Spans are
 * grown by `overscan` so a thick line slides out under the clip instead of
 * popping, and snapped outward so a line's start stays fixed as the camera pans
 * (a dashed stroke anchored to it would otherwise crawl). `cycle`, the dash
 * period, snaps the span to whole dash cycles too, so every parallel line is the
 * same length and the renderer's per-path dash-fit is a no-op.
 */
export function gridLines(
    x: GridAxis,
    y: GridAxis,
    subdivisions: number,
    overscan: number,
    cycle = 0,
): GridLines {
    const verticalMajor: number[] = [];
    const verticalMinor: number[] = [];
    const horizontalMajor: number[] = [];
    const horizontalMinor: number[] = [];

    const top = snapSpan(y.min - overscan, y.step, y.offset, cycle, Math.floor);
    const bottom = snapSpan(y.max + overscan, y.step, y.offset, cycle, Math.ceil);
    const left = snapSpan(x.min - overscan, x.step, x.offset, cycle, Math.floor);
    const right = snapSpan(x.max + overscan, x.step, x.offset, cycle, Math.ceil);

    addTiledLines(x.min, x.max, x.step, x.offset, subdivisions, overscan, (px, isMajor) => {
        (isMajor ? verticalMajor : verticalMinor).push(px);
    }, x.anchor);
    addTiledLines(y.min, y.max, y.step, y.offset, subdivisions, overscan, (py, isMajor) => {
        (isMajor ? horizontalMajor : horizontalMinor).push(py);
    }, y.anchor);

    return { top, bottom, left, right, verticalMajor, verticalMinor, horizontalMajor, horizontalMinor };
}

/**
 * The lines as one multi-subpath path per group (major, minor), so each stroke
 * paints as a union with no destructive boolean op, which would erase open lines.
 * For solid strokes; dashed strokes that must stay world-locked draw per line from
 * {@link gridLines}.
 */
export function gridLinePaths(
    x: GridAxis,
    y: GridAxis,
    subdivisions: number,
    overscan: number,
): { major: PathCommand[]; minor: PathCommand[] } {
    const g = gridLines(x, y, subdivisions, overscan);
    const major: PathCommand[] = [];
    const minor: PathCommand[] = [];
    for (const px of g.verticalMajor) major.push({ type: "M", x: px, y: g.top }, { type: "L", x: px, y: g.bottom });
    for (const px of g.verticalMinor) minor.push({ type: "M", x: px, y: g.top }, { type: "L", x: px, y: g.bottom });
    for (const py of g.horizontalMajor) major.push({ type: "M", x: g.left, y: py }, { type: "L", x: g.right, y: py });
    for (const py of g.horizontalMinor) minor.push({ type: "M", x: g.left, y: py }, { type: "L", x: g.right, y: py });
    return { major, minor };
}

// Snaps `pos` outward to a stable world position, since the renderer anchors dash
// phase to the subpath start. It snaps to the line lattice (`n*step + offset`), or
// to the dash lattice (`n*cycle`, anchored to world 0) when a `cycle` is given.
// The lattice is the one about 0 whatever an axis's `anchor`: a span only has to
// reach past the edge.
function snapSpan(pos: number, step: number, offset: number, cycle: number, round: (n: number) => number): number {
    if (cycle > 0) return round(pos / cycle) * cycle;
    if (step <= 0) return pos;
    return round((pos - offset) / step) * step + offset;
}

/**
 * Emits every line position in `[min, max]` (grown by `overscan`) for spacing
 * `step`, panned by `offset`. The line at tile index `n`, counted from `anchor`,
 * is major when `n` is a multiple of `subdivisions`; `n` is relative to the
 * un-panned lattice, so classification stays stable as the grid scrolls.
 */
export function addTiledLines(
    min: number,
    max: number,
    step: number,
    offset: number,
    subdivisions: number,
    overscan: number,
    emit: (pos: number, isMajor: boolean) => void,
    anchor = 0,
): void {
    if (step <= 0) return;
    // First/last tile index whose panned position is within the overscanned
    // [min, max]. A small epsilon keeps a line that lands exactly on an edge (an
    // anchor at `min`, or a world lattice that reaches it) from being dropped by FP error.
    const eps = step * 1e-6;
    const startN = Math.ceil((min - overscan - offset - anchor - eps) / step);
    const endN = Math.floor((max + overscan - offset - anchor + eps) / step);
    for (let n = startN; n <= endN; n++) {
        const pos = anchor + n * step + offset;
        const isMajor = ((n % subdivisions) + subdivisions) % subdivisions === 0;
        emit(pos, isMajor);
    }
}

/** Largest layer weight, to overscan the tiling so a thick line stays drawn until fully off the area. */
export function maxWeight(strokes: StrokeResolved[]): number {
    let max = 0;
    for (const s of strokes) if (s.weight > max) max = s.weight;
    return max;
}

/** Every layer centred: grid lines are open paths, so inside/outside alignment means nothing. Makes explicit what the renderer does and ignores any author `align`. */
export function centered(strokes: StrokeResolved[]): StrokeResolved[] {
    return strokes.map(s => (s.align === 0 ? s : { ...s, align: 0 }));
}

/** The default minor-line stroke is the major one with every fill's opacity scaled by `factor`. */
export function dimStroke(strokes: StrokeResolved[], factor: number): StrokeResolved[] {
    return strokeOps.resolve(strokes.map(s => ({
        ...s,
        fill: s.fill.map(f => ({ ...f, opacity: (f.opacity ?? 1) * factor })),
    })) as unknown as StrokeProp[]);
}

const SUB_STROKES = new WeakMap<object, StrokeResolved[]>();

/**
 * The minor-line stroke of a pattern built with a `stroke` and no `subStroke`:
 * the major one at half opacity, when it was built with minor lines. Read off
 * what the pattern was built with (`given`), so it is not kept in step with a
 * stroke written later.
 */
export function defaultSubStroke(given: Readonly<Record<string, unknown>>): StrokeResolved[] {
    let sub = SUB_STROKES.get(given);
    if (!sub) {
        const stroke = valueOf(given.stroke) as Stroke | undefined;
        const subdivisions = (valueOf(given.subdivisions) as number | undefined) ?? 1;
        sub = stroke !== undefined && subdivisions > 1 ? dimStroke(strokeOps.resolve(stroke), 0.5) : [];
        SUB_STROKES.set(given, sub);
    }
    return sub;
}

/** A prop as given, a binding read once. */
function valueOf(prop: unknown): unknown {
    return typeof prop === "function" ? (prop as () => unknown)() : prop;
}
