import {
    Graphics2D,
    Types,
    type Fill,
    type FillResolved,
    type PaintProps,
    type RenderContext,
    type StrokeResolved,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
} from "@motionscript/sdk";
import { createBoundedCache } from "./cache";
import { omit, PAINT, PAINT_COMMANDS } from "./component";
import type { CoordinateMap } from "./coords";
import type { ExpressionScope } from "./expression";
import { fieldParams, parseField } from "./field";
import { runsToPath } from "./geometry";
import { PLANE_ENTRY } from "./graph";
import { drawMark, type MarkPaint, type MarkReading } from "./mark";
import { fillAt, lerpFillScale, readFillScale } from "./scale";
import { lerpParams, lerpSource, readSource, scopeFor, type PlotSource } from "./source";

/**
 * What a mark drawn from a vector field, `(P(x, y), Q(x, y))`, shares: arrows,
 * or the lines that follow it, all in one stroke. Without strength fills it is
 * one path in the stroke's paint; with them, what it draws is sorted by the
 * field's strength into a few shades.
 */

export interface FieldProps extends PaintProps {
    expression?: string | PlotSource;
    params?: ExpressionScope;
    strengthFills?: Fill[];
    maxMagnitude?: number;
}

/** A field's vector at a graph point, written into `out`; `false` where it has none. */
export type FieldSampler = (x: number, y: number, out: Vector2) => boolean;

/** One thing a field draws, and how strong the field is there: what it is coloured by. */
export interface FieldStroke {
    runs: Vector2[][];
    magnitude: number;
}

/** How many shades the strength fills are drawn in: each is one path. */
const SHADES = 12;

/** A field mark's entries. It is only strokes, revealed its own way: it has no fill and trims no outline. */
export const FIELD_STATE = {
    ...omit(PAINT, "fill", "start", "end"),
    expression: Types.custom<string | PlotSource, PlotSource>("", { resolve: readSource, lerp: lerpSource, kind: "fieldEquation" }),
    /** The equation's named values: any name in it that is not `x`, `y`, a function or a constant. */
    params: Types.custom<ExpressionScope>({}, { lerp: lerpParams }),
    /** Paints by the field's strength, weakest first. Empty draws everything in the stroke's own paint. */
    strengthFills: Types.custom<Fill[], FillResolved[][]>([], { resolve: readFillScale, lerp: lerpFillScale, kind: "vector" }),
    /** The strength the last paint stands for; zero takes the strongest the field is where it is drawn. */
    maxMagnitude: Types.number(0, { min: 0, step: 0.1 }),
    graph: PLANE_ENTRY,
};

export const FIELD_COMMANDS = {
    ...omit(PAINT_COMMANDS, "fillTo", "progressTo", "flash"),
    /** Change the field, each vector turning from the one into the other. */
    morphTo: { args: ["expression"] as const },
    /** Animate the equation's named values. */
    paramsTo: { args: ["params"] as const },
};

/** What a field mark is drawn from. */
export interface FieldValues {
    readonly expression: PlotSource;
    readonly params: ExpressionScope;
}

/** What one kind of field mark draws of `field` through `map`, and the entries of its own that change it. */
export interface FieldDrawing<S> {
    strokes(s: S, map: CoordinateMap, field: FieldSampler): FieldStroke[];
    /** The entries of its own that change what `strokes` returns, as a key. */
    own(s: S): string;
}

interface Traced {
    readonly drawn: FieldStroke[];
    readonly runs: Vector2[][];
}

const traces = createBoundedCache<Traced>(64);
const EMPTY: Traced = { drawn: [], runs: [] };

/** What a field mark of `kind` draws through `read`: each stroke with its strength, and all their runs. */
export function traceField<S extends FieldValues>(kind: string, drawing: FieldDrawing<S>, s: S, { map, shift }: MarkReading): Traced {
    const { area } = map;
    if (!Number.isFinite(area.maxX - area.minX)) return EMPTY;
    const { source, blend } = s.expression;
    const key = [kind, source, blend?.from, blend?.t, map.revision, JSON.stringify(s.params), shift.x, shift.y, drawing.own(s)].join("|");
    const known = traces.get(key);
    if (known) return known;
    const field = sampler(s, shift);
    const drawn = field ? drawing.strokes(s, map, field) : [];
    const traced = { drawn, runs: drawn.flatMap((stroke) => stroke.runs) };
    traces.set(key, traced);
    return traced;
}

/** A field mark's paint: one stroke, or a shade per strength when it has strength fills. */
export function drawField(
    ctx: RenderContext,
    s: MarkPaint & { readonly strengthFills: FillResolved[][]; readonly maxMagnitude: number },
    { drawn, runs }: Traced,
): void {
    const scale = s.strengthFills;
    const stroke = s.stroke as StrokeResolved[];
    const shaded = scale.length > 0 && stroke.length > 0;
    drawMark(ctx, s, runs, {
        ink: shaded
            ? (ctx, ink) => {
                const top = s.maxMagnitude > 0 ? s.maxMagnitude : drawn.reduce((most, d) => Math.max(most, d.magnitude), 0);
                const shades: Vector2[][][] = Array.from({ length: SHADES }, () => []);
                for (const d of drawn) {
                    const share = top > 0 ? Math.min(1, d.magnitude / top) : 0;
                    shades[Math.min(SHADES - 1, Math.floor(share * SHADES))].push(...d.runs);
                }
                shades.forEach((shade, index) => {
                    if (shade.length === 0) return;
                    const fill = fillAt(scale, (index + 0.5) / SHADES);
                    ctx.draw(
                        new Graphics2D()
                            .path({ data: runsToPath(shade), centerBounds: [ink.minX, ink.minY, ink.maxX, ink.maxY], start: s.start ?? 0, end: s.end ?? 1 })
                            .shadow(s.shadow)
                            .stroke(stroke.map((layer) => ({ ...layer, fill }))),
                    );
                });
            }
            : undefined,
    });
}

/** The field at a graph point, measured from the mark's own shift, mid-morph a blend of two. */
function sampler(s: FieldValues, shift: Vector2): FieldSampler | null {
    const { source, blend } = s.expression;
    const to = fieldOf(source, s.params, shift);
    if (!to || !blend) return to;
    const from = fieldOf(blend.from, s.params, shift);
    if (!from) return to;
    const start: Vector2 = { x: 0, y: 0 };
    return (x, y, out) => {
        if (!from(x, y, start) || !to(x, y, out)) return false;
        out.x = start.x + (out.x - start.x) * blend.t;
        out.y = start.y + (out.y - start.y) * blend.t;
        return true;
    };
}

function fieldOf(source: string, params: ExpressionScope, shift: Vector2): FieldSampler | null {
    const names = fieldParams(source);
    const field = parseField(source, names);
    if (field instanceof Error) return null;
    const scope = scopeFor(names, params);
    const { x, y } = field;
    return (gx, gy, out) => {
        const vx = x(gx - shift.x, gy - shift.y, scope);
        const vy = y(gx - shift.x, gy - shift.y, scope);
        out.x = vx;
        out.y = vy;
        return Number.isFinite(vx) && Number.isFinite(vy);
    };
}
