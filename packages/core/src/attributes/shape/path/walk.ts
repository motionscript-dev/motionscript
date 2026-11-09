/**
 * From a `d` string to the normal form: the scanner, the parser, the one pen
 * walk, and everything that reads a {@link PathSegment} once it exists.
 *
 * There were **seven** pen walks — one each in `bounds`, `length`, `dash`,
 * `sampler`, `subpath`, `morph` and the editor's vector model — and they
 * disagreed. Four forgot that `Z` returns the cursor to the contour's start, so
 * a relative command after a close resolved against the wrong point. Three kept
 * a single slot for the control point an `S`/`T` reflects, so a `T` following a
 * `C` reflected a cubic's control as if it were a quadratic's. One handled arcs
 * exactly, one as a subdivided chord, one as a single chord, one by dropping
 * them, and one by aborting the parse.
 *
 * Everything downstream takes {@link PathContour}s from here.
 */
import { Vector2 } from "@/attributes/layout/vector2";
import { PathCommand, PathData } from "@/render/descriptors/path";
import {
    arcAxisAngles, arcContainsAngle, arcParams, arcPointAtAngle, arcSweepToCubics,
    cubicExtrema, cubicPoint, distance, extractCubicRange, extractQuadRange,
    lerpVector2, lineToCubic, quadExtrema, quadPoint, quadToCubic,
} from "./bezier";
import type { Extents } from "@/layout/bounds";
import type { ArcParams, Cubic, PathContour, PathSegment } from "./types";

/** The incremental scanner {@link parseCommands} drives. */
interface PathScanner {
    atEnd(): boolean;
    /** The next command letter, consumed, or `null` if a number comes first. */
    takeLetter(): string | null;
    /** Whether a number follows — i.e. whether a coordinate run continues. */
    hasNumber(): boolean;
    takeNumber(): number | null;
    /** A single-character `0`/`1` arc flag, consumed, or `null`. */
    takeFlag(): 0 | 1 | null;
}

/**
 * The one `d`-string scanner.
 *
 * There were two: a regex split (`/([MmLlHhVvCcSsQqTtAaZz])|(-?[\d.]+(?:e[-+]?\d+)?)/`)
 * and a hand-rolled one in the editor model. They accepted different languages —
 * the regex reads `.5.5` as a single token and `parseFloat` then silently keeps
 * only the first half, so `M .5.5` parsed as a move to an undefined y.
 *
 * **It scans on demand rather than tokenizing up front**, because SVG's grammar
 * is not context-free: an arc's `largeArc` and `sweep` are single *characters*,
 * and the spec lets them run together with what follows. A real icon writes
 * `A9.564 9.564 0 0112 6.844`, where `0112` is the flag `0`, the flag `1`, and
 * the coordinate `12` — a number scanner with no idea what it is reading takes
 * it for one number and puts the arc's endpoint 100 units away. Both parsers
 * this replaces had that bug.
 *
 * Deliberately forgiving otherwise. This value comes out of a database column
 * that a previous version of an app — or an author pasting a path in — may have
 * written, and a strict scanner's answer to a malformed tail is to throw away
 * geometry that was rendering fine a moment ago. So a token it can't read ends
 * the scan and keeps everything before it, which degrades to "the shape is
 * missing its last curve" instead of "the node is empty".
 */

/**
 * Every command letter, including the arcs.
 *
 * `A`/`a` were absent from the editor model's copy of this list, which made its
 * scanner stop dead at the first arc — so a pasted icon (arcs are how every icon
 * set draws a rounded join) lost everything from that point on. The arc is
 * dropped at the *model* boundary now, where it is a deliberate conversion to
 * cubics, rather than here where it was a silent truncation.
 */
const COMMAND_LETTERS = "MmLlHhVvCcSsQqTtAaZz";

function isSeparator(ch: string): boolean {
    return ch === " " || ch === "," || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
}

function createPathScanner(data: string): PathScanner {
    let i = 0;

    const skip = () => {
        while (i < data.length && isSeparator(data[i])) i++;
    };

    const scanNumber = (): number | null => {
        skip();
        const start = i;
        if (data[i] === "+" || data[i] === "-") i++;
        while (i < data.length && isDigit(data[i])) i++;
        if (data[i] === ".") {
            i++;
            while (i < data.length && isDigit(data[i])) i++;
        }
        if (data[i] === "e" || data[i] === "E") {
            const mark = i;
            i++;
            if (data[i] === "+" || data[i] === "-") i++;
            if (i < data.length && isDigit(data[i])) {
                while (i < data.length && isDigit(data[i])) i++;
            } else {
                i = mark;
            }
        }
        if (i === start) return null;
        const value = Number(data.slice(start, i));
        if (!Number.isFinite(value)) {
            i = start;
            return null;
        }
        return value;
    };

    return {
        atEnd: () => {
            skip();
            return i >= data.length;
        },
        takeLetter: () => {
            skip();
            if (i < data.length && COMMAND_LETTERS.includes(data[i])) return data[i++];
            return null;
        },
        hasNumber: () => {
            skip();
            if (i >= data.length) return false;
            const ch = data[i];
            return isDigit(ch) || ch === "." || ch === "+" || ch === "-";
        },
        takeNumber: scanNumber,
        takeFlag: () => {
            skip();
            // One character, no sign and no decimal point — that is the whole
            // grammar for a flag, and reading it as a number is the bug.
            if (data[i] === "0") { i++; return 0; }
            if (data[i] === "1") { i++; return 1; }
            return null;
        },
    };
}

export function lineSegment(from: Vector2, to: Vector2): PathSegment {
    return { kind: "line", from, to };
}

export function quadSegment(from: Vector2, c: Vector2, to: Vector2): PathSegment {
    return { kind: "quad", from, c, to };
}

export function cubicSegment(from: Vector2, c1: Vector2, c2: Vector2, to: Vector2): PathSegment {
    return { kind: "cubic", from, c1, c2, to };
}

/**
 * An arc, or the line it degenerates to.
 *
 * A zero radius or coincident endpoints make the endpoint→center conversion
 * divide by zero, and the SVG spec says both draw as a straight line — so the
 * substitution happens here rather than in each of the four places that would
 * otherwise have to guard.
 */
export function arcSegment(
    from: Vector2, to: Vector2,
    rx: number, ry: number, rotation: number, largeArc: 0 | 1, sweep: 0 | 1,
): PathSegment {
    if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) {
        return lineSegment(from, to);
    }
    return { kind: "arc", from, to, rx, ry, rotation, largeArc, sweep };
}

/** The ellipse an arc segment names. Cheap, but not free — hoist it in a loop. */
export function segmentArc(segment: PathSegment & { kind: "arc" }): ArcParams {
    return arcParams(
        segment.from, segment.to,
        segment.rx, segment.ry, segment.rotation, segment.largeArc, segment.sweep,
    );
}

/** The point at parameter `t` (0..1). */
export function segmentPointAt(segment: PathSegment, t: number): Vector2 {
    switch (segment.kind) {
        case "line": return lerpVector2(segment.from, segment.to, t);
        case "quad": return quadPoint(segment.from, segment.c, segment.to, t);
        case "cubic": return cubicPoint(segment.from, segment.c1, segment.c2, segment.to, t);
        case "arc": {
            const arc = segmentArc(segment);
            return arcPointAtAngle(arc, arc.theta1 + t * arc.dtheta);
        }
    }
}

function boxOf(points: Vector2[]): Extents {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

/**
 * The segment's tight box — its own extrema, solved, not its control hull.
 *
 * Closed form on every kind, so this stays cheap enough for `measure()`. The
 * control hull can sit a long way outside the curve: `size` used it
 * and a hugging `Path` was correspondingly too big, while an arc — whose hull it
 * had no way to compute at all — was measured across its chord and came back
 * flat on one axis.
 */
export function segmentBounds(segment: PathSegment): Extents {
    switch (segment.kind) {
        case "line":
            return boxOf([segment.from, segment.to]);
        case "quad": {
            const at = (t: number) => quadPoint(segment.from, segment.c, segment.to, t);
            return boxOf([
                segment.from, segment.to,
                ...quadExtrema(segment.from.x, segment.c.x, segment.to.x).map(at),
                ...quadExtrema(segment.from.y, segment.c.y, segment.to.y).map(at),
            ]);
        }
        case "cubic": {
            const at = (t: number) => cubicPoint(segment.from, segment.c1, segment.c2, segment.to, t);
            return boxOf([
                segment.from, segment.to,
                ...cubicExtrema(segment.from.x, segment.c1.x, segment.c2.x, segment.to.x).map(at),
                ...cubicExtrema(segment.from.y, segment.c1.y, segment.c2.y, segment.to.y).map(at),
            ]);
        }
        case "arc": {
            const arc = segmentArc(segment);
            const points: Vector2[] = [segment.from, segment.to];
            const angles = arcAxisAngles(arc);
            for (const theta of [...angles.x, ...angles.y]) {
                if (arcContainsAngle(arc, theta)) points.push(arcPointAtAngle(arc, theta));
            }
            return boxOf(points);
        }
    }
}

/** The segment as cubics. Exact for every kind but `arc`. */
export function segmentCubics(segment: PathSegment): Cubic[] {
    switch (segment.kind) {
        case "line": return [lineToCubic(segment.from, segment.to)];
        case "quad": return [quadToCubic(segment.from, segment.c, segment.to)];
        case "cubic": return [{ p0: segment.from, c1: segment.c1, c2: segment.c2, p1: segment.to }];
        case "arc": {
            const arc = segmentArc(segment);
            const cubics = arcSweepToCubics(arc, arc.theta1, arc.theta1 + arc.dtheta);
            return cubics.length > 0 ? cubics : [lineToCubic(segment.from, segment.to)];
        }
    }
}

/**
 * The sub-range `t0..t1` as commands, with no leading move.
 *
 * A sub-range of an arc is still an arc, so it stays one rather than being
 * refitted — the old trim approximated it with cubics through sampled points
 * using a *tangent* formula, which was wrong on top of being lossy.
 */
export function segmentSplit(segment: PathSegment, t0: number, t1: number): PathCommand[] {
    switch (segment.kind) {
        case "line": {
            const p = lerpVector2(segment.from, segment.to, t1);
            return [{ type: "L", x: p.x, y: p.y }];
        }
        case "quad": {
            const sub = extractQuadRange(segment.from, segment.c, segment.to, t0, t1);
            return [{ type: "Q", x1: sub.cp.x, y1: sub.cp.y, x: sub.to.x, y: sub.to.y }];
        }
        case "cubic": {
            const sub = extractCubicRange(segment.from, segment.c1, segment.c2, segment.to, t0, t1);
            return [{ type: "C", x1: sub.cp1.x, y1: sub.cp1.y, x2: sub.cp2.x, y2: sub.cp2.y, x: sub.to.x, y: sub.to.y }];
        }
        case "arc": {
            const arc = segmentArc(segment);
            const a0 = arc.theta1 + t0 * arc.dtheta;
            const a1 = arc.theta1 + t1 * arc.dtheta;
            const to = arcPointAtAngle(arc, a1);
            return [{
                type: "A",
                rx: arc.rx, ry: arc.ry, rotation: segment.rotation,
                largeArc: (Math.abs(a1 - a0) > Math.PI ? 1 : 0) as 0 | 1,
                sweep: segment.sweep,
                x: to.x, y: to.y,
            }];
        }
    }
}

/**
 * The closing line of a closed contour, when it has any length.
 *
 * Every walk this replaced synthesized this the same way, so one synthesis
 * reproduces all of them.
 */
export function closingSegment(contour: PathContour): PathSegment | null {
    if (!contour.closed || contour.segments.length === 0) return null;
    const end = contour.segments[contour.segments.length - 1].to;
    if (Math.abs(end.x - contour.start.x) < 1e-9 && Math.abs(end.y - contour.start.y) < 1e-9) return null;
    return lineSegment(end, contour.start);
}

/** Every segment of a contour, the implied closing line included. */
export function contourSegments(contour: PathContour): PathSegment[] {
    const closing = closingSegment(contour);
    return closing ? [...contour.segments, closing] : contour.segments;
}

/** The union of every segment's box, or `null` when there is no geometry at all. */
export function contourBounds(contours: PathContour[]): Extents | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let seen = false;
    const include = (box: Extents) => {
        seen = true;
        if (box.minX < minX) minX = box.minX;
        if (box.minY < minY) minY = box.minY;
        if (box.maxX > maxX) maxX = box.maxX;
        if (box.maxY > maxY) maxY = box.maxY;
    };
    for (const contour of contours) {
        // A lone `M` still occupies a point. The closing line joins two points
        // already counted, so it never widens the box.
        if (contour.segments.length === 0) {
            include({ minX: contour.start.x, minY: contour.start.y, maxX: contour.start.x, maxY: contour.start.y });
            continue;
        }
        for (const segment of contour.segments) include(segmentBounds(segment));
    }
    return seen ? { minX, minY, maxX, maxY } : null;
}

/** Straight-line distance between a segment's endpoints — its chord. */
export function segmentChord(segment: PathSegment): number {
    return distance(segment.from, segment.to);
}

/**
 * Parses a `d` string into commands, **as written** — relative stays relative,
 * shorthands stay short, arcs stay arcs.
 *
 * Normalizing here would throw away the one thing a caller might still want the
 * original for (round-tripping a stored string), and {@link contours} resolves
 * all of it one step later anyway.
 */
export function parseCommands(d: string): PathCommand[] {
    const scan = createPathScanner(d);
    const commands: PathCommand[] = [];
    let letter: string | null = null;

    while (!scan.atEnd()) {
        const next = scan.takeLetter();
        if (next !== null) {
            letter = next;
        } else if (letter === null) {
            // Numbers before any command: nothing says what they mean.
            return commands;
        } else if (letter === "M") {
            // The pair after an `M` is an implicit `L` — the one case where a
            // coordinate run continues as a *different* command than its letter.
            letter = "L";
        } else if (letter === "m") {
            letter = "l";
        } else if (letter === "Z" || letter === "z") {
            // `Z` takes no arguments, so a number after one is a malformed
            // string rather than a repeat.
            return commands;
        }

        const upper = letter.toUpperCase();
        const rel = letter !== upper;

        if (upper === "Z") {
            commands.push({ type: "Z" });
            continue;
        }

        // `null` anywhere below means the string ran out or turned to garbage
        // mid-command; the partial command is dropped and the rest kept.
        const n = (count: number): number[] | null => {
            const out: number[] = [];
            for (let i = 0; i < count; i++) {
                const value = scan.takeNumber();
                if (value === null) return null;
                out.push(value);
            }
            return out;
        };

        switch (upper) {
            case "M": case "L": case "T": {
                const a = n(2);
                if (!a) return commands;
                const type = upper === "M" ? "M" : upper === "L" ? "L" : "T";
                commands.push({ type: (rel ? type.toLowerCase() : type) as never, x: a[0], y: a[1] });
                break;
            }
            case "H": {
                const a = n(1);
                if (!a) return commands;
                commands.push({ type: rel ? "h" : "H", x: a[0] });
                break;
            }
            case "V": {
                const a = n(1);
                if (!a) return commands;
                commands.push({ type: rel ? "v" : "V", y: a[0] });
                break;
            }
            case "C": {
                const a = n(6);
                if (!a) return commands;
                commands.push({ type: rel ? "c" : "C", x1: a[0], y1: a[1], x2: a[2], y2: a[3], x: a[4], y: a[5] });
                break;
            }
            case "S": case "Q": {
                const a = n(4);
                if (!a) return commands;
                commands.push(upper === "S"
                    ? { type: rel ? "s" : "S", x2: a[0], y2: a[1], x: a[2], y: a[3] }
                    : { type: rel ? "q" : "Q", x1: a[0], y1: a[1], x: a[2], y: a[3] });
                break;
            }
            case "A": {
                // The flags are read as single characters, not numbers — see
                // `createPathScanner`.
                const radii = n(3);
                if (!radii) return commands;
                const largeArc = scan.takeFlag();
                const sweep = scan.takeFlag();
                if (largeArc === null || sweep === null) return commands;
                const end = n(2);
                if (!end) return commands;
                commands.push({
                    type: rel ? "a" : "A",
                    rx: radii[0], ry: radii[1], rotation: radii[2],
                    largeArc, sweep,
                    x: end[0], y: end[1],
                });
                break;
            }
            default:
                // An unknown letter: stop rather than guess how many numbers it eats.
                return commands;
        }

        if (!scan.hasNumber() && scan.atEnd()) break;
    }
    return commands;
}

/** Coerce loose {@link PathData} into commands. Nullish is an empty path, not a throw. */
export function commands(d: PathData | null | undefined): PathCommand[] {
    if (d == null) return [];
    return typeof d === "string" ? parseCommands(d) : d;
}

/**
 * Contours already walked, keyed by the value they were walked from.
 *
 * `Path.measure` and `Text.measure` re-walk the same `d` every layout pass, and
 * a string key hits by value while an authored `PathCommand[]` hits by
 * reference — so a static path is walked once and a tweened one, whose array is
 * fresh each frame, misses exactly as `morph.ts`'s plan cache does. Bounded and
 * insertion-ordered, so those fresh arrays age out instead of accumulating.
 *
 * The cached list is shared, so treat what comes back as read-only.
 */
const CONTOUR_CACHE = new Map<PathData, PathContour[]>();
const CONTOUR_CACHE_MAX = 32;

/**
 * Resolves commands into absolute contours of typed segments.
 *
 * The three things every previous walk had to get right, in one place: relative
 * commands resolve against the pen, `Z` returns the pen to the contour's start,
 * and `S`/`T` reflect from **separate** cubic and quadratic slots, each cleared
 * by a command of the other kind.
 */
export function contours(d: PathData | null | undefined): PathContour[] {
    if (d == null) return [];
    const cached = CONTOUR_CACHE.get(d);
    if (cached) return cached;
    const walked = walkCommands(commands(d));
    if (CONTOUR_CACHE.size >= CONTOUR_CACHE_MAX) {
        CONTOUR_CACHE.delete(CONTOUR_CACHE.keys().next().value!);
    }
    CONTOUR_CACHE.set(d, walked);
    return walked;
}

/** {@link contours} without the memo — the walk itself. */
export function walkCommands(list: PathCommand[]): PathContour[] {
    const out: PathContour[] = [];

    let current: PathContour | null = null;
    let cursor: Vector2 = { x: 0, y: 0 };
    let contourStart: Vector2 = { x: 0, y: 0 };
    let prevCubicCp: Vector2 | null = null;
    let prevQuadCp: Vector2 | null = null;

    // Returns rather than assigning, so the compiler can still see that `current`
    // is non-null after a call — a closure that assigned it would defeat that.
    const open = (at: Vector2): PathContour => {
        const contour: PathContour = { start: at, segments: [], closed: false };
        out.push(contour);
        contourStart = at;
        return contour;
    };
    const push = (segment: PathSegment) => {
        // A drawing command before any `M` starts a contour where the pen is,
        // which is the origin. Malformed, but recoverable, and every previous
        // walk did the same.
        if (!current) current = open(cursor);
        current.segments.push(segment);
    };

    for (const cmd of list) {
        const rel = cmd.type !== cmd.type.toUpperCase();
        const abs = (x: number, y: number): Vector2 =>
            rel ? { x: cursor.x + x, y: cursor.y + y } : { x, y };

        let cubicCp: Vector2 | null = null;
        let quadCp: Vector2 | null = null;

        switch (cmd.type) {
            case "M": case "m": {
                const to = abs(cmd.x, cmd.y);
                current = open(to);
                cursor = to;
                break;
            }
            case "L": case "l": {
                const to = abs(cmd.x, cmd.y);
                push(lineSegment(cursor, to));
                cursor = to;
                break;
            }
            case "H": case "h": {
                const to = { x: rel ? cursor.x + cmd.x : cmd.x, y: cursor.y };
                push(lineSegment(cursor, to));
                cursor = to;
                break;
            }
            case "V": case "v": {
                const to = { x: cursor.x, y: rel ? cursor.y + cmd.y : cmd.y };
                push(lineSegment(cursor, to));
                cursor = to;
                break;
            }
            case "C": case "c": {
                const c1 = abs(cmd.x1, cmd.y1);
                const c2 = abs(cmd.x2, cmd.y2);
                const to = abs(cmd.x, cmd.y);
                push(cubicSegment(cursor, c1, c2, to));
                cursor = to;
                cubicCp = c2;
                break;
            }
            case "S": case "s": {
                const c1 = prevCubicCp
                    ? { x: 2 * cursor.x - prevCubicCp.x, y: 2 * cursor.y - prevCubicCp.y }
                    : cursor;
                const c2 = abs(cmd.x2, cmd.y2);
                const to = abs(cmd.x, cmd.y);
                push(cubicSegment(cursor, c1, c2, to));
                cursor = to;
                cubicCp = c2;
                break;
            }
            case "Q": case "q": {
                const cp = abs(cmd.x1, cmd.y1);
                const to = abs(cmd.x, cmd.y);
                push(quadSegment(cursor, cp, to));
                cursor = to;
                quadCp = cp;
                break;
            }
            case "T": case "t": {
                // Annotated because `quadCp` feeds `prevQuadCp` feeds this — a
                // real cycle for inference, unlike `S`, whose slot takes `c2`.
                const cp: Vector2 = prevQuadCp
                    ? { x: 2 * cursor.x - prevQuadCp.x, y: 2 * cursor.y - prevQuadCp.y }
                    : cursor;
                const to = abs(cmd.x, cmd.y);
                push(quadSegment(cursor, cp, to));
                cursor = to;
                quadCp = cp;
                break;
            }
            case "A": case "a": {
                const to = abs(cmd.x, cmd.y);
                push(arcSegment(cursor, to, cmd.rx, cmd.ry, cmd.rotation, cmd.largeArc, cmd.sweep));
                cursor = to;
                break;
            }
            case "Z": case "z": {
                if (current) {
                    current.closed = true;
                    // The closing line is implied by `closed`, not stored — a
                    // stored one would be a zero-length segment whenever the
                    // contour already ends where it started, which is most of
                    // the time.
                    current = null;
                }
                cursor = contourStart;
                break;
            }
        }

        // Only a curve leaves a control point behind. Anything else clears both,
        // which is what makes an `S` after a line start from the cursor rather
        // than from a curve three commands back.
        prevCubicCp = cubicCp;
        prevQuadCp = quadCp;
    }

    return out;
}

/** The tight box, or `null` for a path with no geometry at all. */
export function bounds(d: PathData | null | undefined): Extents | null {
    return contourBounds(contours(d));
}

/** {@link bounds} as a size. An empty path is `0 x 0` rather than `null`. */
export function size(d: PathData | null | undefined): { width: number; height: number } {
    const box = bounds(d);
    if (!box) return { width: 0, height: 0 };
    return { width: box.maxX - box.minX, height: box.maxY - box.minY };
}
