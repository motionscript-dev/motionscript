import { PathCommand } from "./path";
import type { PathState } from "./path";

/**
 * A full or partial revolution of an ellipse, in the same **y-up** space the
 * commands themselves are authored in (`y = 100` is 100px *above* the centre,
 * matching a node's `x`/`y`). Angles are degrees from 3 o'clock, positive
 * counter-clockwise — the vocabulary the `Ellipse` node already uses.
 */
export interface EllipseArc {
    /** Centre. Both default to the origin. */
    x?: number;
    y?: number;
    width: number;
    /** Defaults to `width`, i.e. a circle. */
    height?: number;
    /** Where on the perimeter the curve starts. */
    startAngle?: number;
    /** Degrees travelled; negative goes clockwise. Past ±360 it keeps looping. */
    sweep?: number;
}

export class PathBuilder {
    private _cmds: PathCommand[] = [];
    private _x = 0;
    private _y = 0;
    private _startX = 0;
    private _startY = 0;
    private _open = false;

    moveTo(x: number, y: number): this {
        this._cmds.push({ type: "M", x, y });
        this._startX = x;
        this._startY = y;
        return this._at(x, y);
    }

    lineTo(x: number, y: number): this {
        this._cmds.push({ type: "L", x, y });
        return this._at(x, y);
    }

    bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
        this._cmds.push({ type: "C", x1, y1, x2, y2, x, y });
        return this._at(x, y);
    }

    quadraticCurveTo(x1: number, y1: number, x: number, y: number): this {
        this._cmds.push({ type: "Q", x1, y1, x, y });
        return this._at(x, y);
    }

    /** The raw SVG arc command: an elliptical arc to (`x`, `y`), picked out of the four candidates by `largeArc`/`sweep`. */
    arcTo(rx: number, ry: number, rotation: number, largeArc: 0 | 1, sweep: 0 | 1, x: number, y: number): this {
        this._cmds.push({ type: "A", rx, ry, rotation, largeArc, sweep, x, y });
        return this._at(x, y);
    }

    /**
     * An **open** elliptical arc: the perimeter of {@link EllipseArc} from
     * `startAngle` through `sweep` degrees.
     *
     * Continues the current subpath — a straight line joins the pen's position
     * to the arc's start when the two differ — so `moveTo(...).arc(...)` is one
     * unbroken curve, which is what a `moveTo` command following the path needs.
     * A new `M` there would be a subpath break the walk teleports across.
     *
     * ```ts
     * new PathBuilder().arc({ x: 0, y: 0, width: 400, startAngle: 180, sweep: -180 });
     * ```
     */
    arc(arc: EllipseArc): this {
        const { cx, cy, rx, ry, from, sweep } = resolveArc(arc);
        const start = pointOn(cx, cy, rx, ry, from);
        if (!this._open) this.moveTo(start.x, start.y);
        else if (start.x !== this._x || start.y !== this._y) this.lineTo(start.x, start.y);
        return this._sweep(cx, cy, rx, ry, from, sweep);
    }

    /**
     * A **closed** subpath tracing an ellipse — the shape form of {@link arc}.
     *
     * A `sweep` short of a full turn closes across the chord back to the start;
     * for a pie wedge or an annular sector, that is an `Ellipse` node's `ratio`.
     */
    ellipse(arc: EllipseArc): this {
        const { cx, cy, rx, ry, from, sweep } = resolveArc(arc);
        const start = pointOn(cx, cy, rx, ry, from);
        this.moveTo(start.x, start.y);
        this._sweep(cx, cy, rx, ry, from, sweep);
        return this.close();
    }

    close(): this {
        this._cmds.push({ type: "Z" });
        return this._at(this._startX, this._startY);
    }

    toCommands(): PathCommand[] {
        return [...this._cmds];
    }

    toPathState(partial: Omit<Partial<PathState>, "data"> = {}): Partial<PathState> {
        return { ...partial, data: this._cmds };
    }

    /** Record where the pen ended up, so {@link arc} knows whether it has to join up to its start. */
    private _at(x: number, y: number): this {
        this._x = x;
        this._y = y;
        this._open = true;
        return this;
    }

    /**
     * Emit the arc as segments of at most a quarter turn. One `A` command cannot
     * express a full revolution at all (its endpoints would coincide, leaving the
     * arc undefined) and grows imprecise well before that, so the split is what
     * makes `sweep` a real angle rather than a value capped just under 360.
     */
    private _sweep(cx: number, cy: number, rx: number, ry: number, from: number, sweep: number): this {
        if (sweep === 0) return this;
        const steps = Math.ceil(Math.abs(sweep) / 90);
        const step = sweep / steps;
        const direction = sweep > 0 ? 1 : 0;
        for (let i = 1; i <= steps; i++) {
            const p = pointOn(cx, cy, rx, ry, from + step * i);
            this.arcTo(rx, ry, 0, 0, direction, p.x, p.y);
        }
        return this;
    }
}

function resolveArc(arc: EllipseArc): { cx: number; cy: number; rx: number; ry: number; from: number; sweep: number } {
    return {
        cx: arc.x ?? 0,
        cy: arc.y ?? 0,
        rx: arc.width / 2,
        ry: (arc.height ?? arc.width) / 2,
        from: arc.startAngle ?? 0,
        sweep: arc.sweep ?? 360,
    };
}

function pointOn(cx: number, cy: number, rx: number, ry: number, angle: number): { x: number; y: number } {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
}
