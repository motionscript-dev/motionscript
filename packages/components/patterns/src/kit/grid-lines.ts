import { strokeOps, type PathCommand, type Stroke, type StrokeProp, type StrokeResolved } from "@motionscript/sdk";

/**
 * Shared geometry for line grids. Both {@link LineGridPattern} (a fixed grid filling
 * its layout rect) and {@link GridPattern} (an infinite grid tiled across the
 * camera's visible region) build the same multi-subpath line paths from these
 * helpers — they differ only in how the extent and step are chosen.
 *
 * Lines are tiled by the minor step and panned by an origin offset: every
 * position within the extent (grown by `overscan` so thick lines clip out
 * smoothly) is emitted regardless of the offset, so the area always stays full
 * and animating the offset scrolls the grid. The lattice starts at the axis's
 * `anchor` (the world origin unless it says otherwise). A tile whose index
 * aligns to the division grid is major; the rest are minor. Each is built as a
 * single multi-subpath path so the trailing stroke paints every line as one
 * union with no destructive boolean op (which would erase the open lines).
 */

/** A grid extent on one axis: lines tile within `[min, max]`, on a lattice that starts at `anchor`. */
export interface GridAxis {
    /** Minimum coordinate (typically negative). */
    min: number;
    /** Maximum coordinate. */
    max: number;
    /** Spacing between adjacent (minor) lines. */
    step: number;
    /** Pan offset in pixels along this axis. */
    offset: number;
    /**
     * Where the lattice starts: a line sits at `anchor + n * step`, and the tile
     * index `n` that decides which lines are major counts from there. Omitted it is 0, the
     * world origin, which is what a grid that follows a camera keeps. A grid with a box of its
     * own sets it to `min`, so the box's edges are lines whatever the count of cells.
     */
    anchor?: number;
}

/** The resolved grid: where each line sits and how far it runs. Vertical lines
 * sit at x = `verticalX[i]` and run from `top` to `bottom`; horizontal lines sit
 * at y = `horizontalY[i]` and run from `left` to `right`. Positions are split
 * into major (division) and minor (subdivision) lines. */
export interface GridLines {
    /** y-extent every vertical line spans. */
    top: number;
    bottom: number;
    /** x-extent every horizontal line spans. */
    left: number;
    right: number;
    verticalMajor: number[];
    verticalMinor: number[];
    horizontalMajor: number[];
    horizontalMinor: number[];
}

/**
 * Resolve the grid for the given per-axis extents: the cross-axis span and the
 * major/minor line positions on each axis. Vertical lines span the full y
 * extent; horizontal lines span the full x extent. Both spans are grown by
 * `overscan` so a thick line slides out under the clip instead of popping, and
 * snapped outward to the grid so the endpoints sit on stable world positions
 * (a line's start stays fixed as the camera pans, so a dashed stroke anchored to
 * it doesn't crawl).
 *
 * `cycle` (the dash period, when dashed) snaps the cross-axis span to a whole
 * number of dash cycles too, so each parallel line is the same dash-aligned
 * length and the renderer's per-path dash-fit becomes a no-op (no per-frame
 * resizing of the dashes as lines enter and leave view).
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

    // Span each line across the cross axis, snapped outward to the grid (and to
    // the dash cycle when dashed) so the endpoints sit on stable world positions.
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
 * Build the grid lines as multi-subpath path commands, split into the major
 * (division) lines and the minor (subdivision) lines, for the given per-axis
 * extents. Every line in a group shares one stroke (drawn as one union path), so
 * this is the path for solid strokes; dashed strokes that must stay world-locked
 * draw per line from {@link gridLines} instead.
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

// Snap `pos` outward to a stable world position so a dashed line's start stays
// fixed as the viewport moves (the renderer anchors dash phase to the subpath
// start). Snap to the grid line lattice (`n*step + offset`); when a dash `cycle`
// is given, snap to the dash lattice instead (`n*cycle`, anchored to world 0) so
// every parallel line is the same whole number of cycles long and the renderer's
// per-path dash-fit stays a no-op. `round` is `Math.floor` to snap below, `ceil`
// to snap above. The lattice is the one about 0 whatever an axis's `anchor`: a span
// only has to reach past the edge, and a line's ends stay where they always were.
function snapSpan(pos: number, step: number, offset: number, cycle: number, round: (n: number) => number): number {
    if (cycle > 0) return round(pos / cycle) * cycle;
    if (step <= 0) return pos;
    return round((pos - offset) / step) * step + offset;
}

/**
 * Emit every grid line position in `[min, max]` (grown by `overscan` on each
 * end) for a grid of spacing `step`, panned by `offset` px. Without panning the
 * lattice starts at `anchor` (0 unless given) and its tile indices count outward
 * from there; the line at tile index `n` is major when `n` is a multiple of
 * `subdivisions`. The pan shifts each position by `offset` while keeping the
 * area full, so `n` is taken relative to the un-panned lattice (offset folded
 * out) to keep classification stable as it scrolls.
 *
 * A fixed grid anchors at `min`, so its first line is on the box's edge and the
 * last is too whenever the extent is a whole number of steps. An infinite grid
 * keeps the default, so its lines stay on the world's lattice.
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
    // [min, max]. Positions are `anchor + n*step + offset` (n=0 sits on the
    // anchor). A small epsilon keeps a line that lands exactly on an edge (an
    // anchor at `min`, or a world lattice that reaches it) from being dropped by FP error.
    const eps = step * 1e-6;
    const startN = Math.ceil((min - overscan - offset - anchor - eps) / step);
    const endN = Math.floor((max + overscan - offset - anchor + eps) / step);
    for (let n = startN; n <= endN; n++) {
        const pos = anchor + n * step + offset;
        // mod that stays non-negative for negative n.
        const isMajor = ((n % subdivisions) + subdivisions) % subdivisions === 0;
        emit(pos, isMajor);
    }
}

/** Largest stroke weight across the layers of a resolved stroke array. Used to
 * overscan the tiling so a thick line stays drawn until fully off the area. */
export function maxWeight(strokes: StrokeResolved[]): number {
    let max = 0;
    for (const s of strokes) if (s.weight > max) max = s.weight;
    return max;
}

/** Force every layer of a resolved stroke array to centered alignment. Grid
 * lines are open paths, not a closed region, so inside/outside alignment is
 * meaningless — they always straddle their position. (Open paths are already
 * stroked centered by the renderer; this makes the intent explicit and ignores
 * any author `align`.) */
export function centered(strokes: StrokeResolved[]): StrokeResolved[] {
    return strokes.map(s => (s.align === 0 ? s : { ...s, align: 0 }));
}

/** Copy a resolved stroke array with every fill layer's opacity scaled by
 * `factor`. Used to derive the default minor-line stroke from the major one.
 * Every resolved fill carries an `opacity` field, so this is type-uniform. */
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

/** A prop as it stood when given: a binding read once. */
function valueOf(prop: unknown): unknown {
    return typeof prop === "function" ? (prop as () => unknown)() : prop;
}
