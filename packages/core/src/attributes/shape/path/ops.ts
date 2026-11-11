/**
 * Every path-geometry operation on one object, the repo's shape for an attribute whose operations go past
 * interpolation (like `insetsOps`, `alignmentOps`). Each method is the module function of the same name. Behind it is
 * **one** pen walk:
 *
 *     PathData ── commands ──▶ PathCommand[] ── contours ──▶ PathContour[]
 *                                                               │
 *           bounds · size · length · sampler · dash · trim ◀─────┤
 *                                     cubics ── morph ◀──────────┤
 *                                    anchors ── editing ◀────────┘
 *
 * `cubics` and `anchors` are the only places geometry is flattened to one curve type (a morph needs one segment kind
 * to pair up; nobody can drag an arc's handles). Everything that measures keeps the arc.
 */
import { PathCommand, PathData } from "@/render/descriptors/path";
import type { AttributeOps } from "@/attributes/shared/operators";

import { bounds, commands, contours, size } from "./walk";
import { dash, dashScale, length, sampler, trim } from "./measure";
import { cubics, lerp, plan, sample } from "./morph";
import {
    anchorBounds, anchorCommands, anchors, endFit, fitToBox, fromAnchors,
    isEmpty, map, normalize, pointOn, split, translate,
} from "./anchors";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { Extents } from "@/layout/bounds";
import { PathContour, CubicSubpath, VectorPath, PathSampler, MorphPlan, PathNormalization, PathAnchor } from "./types";


export interface PathOps {
    /** Parse. A `PathCommand[]` passes through by reference; nullish gives `[]`. */
    commands(d: PathData | null | undefined): PathCommand[];
    /** The normal form: absolute, shorthands expanded, grouped into contours. */
    contours(d: PathData | null | undefined): PathContour[];
    /** All-cubic form. Lossy for arcs — one of the two flattening boundaries. */
    cubics(d: PathData | null | undefined): CubicSubpath[];
    /** The editable anchor model. Lossy for arcs — the other boundary. */
    anchors(d: PathData | null | undefined): VectorPath;

    /** Tight box: each segment's own extrema, not its control hull. */
    bounds(d: PathData | null | undefined): Extents | null;
    /** {@link bounds} as a size; `0 x 0` for an empty path. */
    size(d: PathData | null | undefined): { width: number; height: number };
    /** Total arc length. An arc is measured along the arc, not across its chord. */
    length(d: PathData | null | undefined): number;
    /** Point and unit tangent at a distance along the path. */
    sampler(d: PathData): PathSampler;

    /** The portion between two arc-length fractions. Works on strings. */
    trim(d: PathData, start: number, end: number): PathData;
    /** Only the "on" runs of a dash pattern, fit as the renderer fits it, as a `d` string. */
    dash(d: PathData | null | undefined, pattern: number[], offset?: number): string;
    /** How far a pattern is stretched to fit one contour of a path — see `dash`. */
    dashScale(pattern: number[], contour: { length: number; closed: boolean }, total: number): number | null;

    /** A reusable correspondence between two paths. Expensive; `lerp` caches one. */
    plan(from: PathCommand[], to: PathCommand[]): MorphPlan;
    /** Sample a plan at `t`. Cheap. */
    sample(plan: MorphPlan, t: number): PathCommand[];

    /** Anchors back to a `d` string. Emits only `M`/`L`/`C`/`Z`. */
    fromAnchors(path: VectorPath): string;
    /** Anchors to commands, with a transform folded into the same pass. */
    anchorCommands(path: VectorPath, transform?: (p: Vector2) => Vector2): PathCommand[];
    /** Tight box of an anchor path. */
    anchorBounds(path: VectorPath): Extents | null;
    /** Every point and handle mapped. */
    map(path: VectorPath, fn: (p: Vector2) => Vector2): VectorPath;
    translate(path: VectorPath, delta: Vector2): VectorPath;
    /** The turn-and-scale about `start` carrying `end` onto `to` — a `map` fn. */
    endFit(start: Vector2, end: Vector2, to: Vector2): (p: Vector2) => Vector2;
    isEmpty(path: VectorPath): boolean;

    /** Re-quote against the geometry's own bounds. */
    normalize(path: VectorPath): PathNormalization;
    /** Re-quote against a stated box — the general form of {@link PathOps.normalize}. */
    fitToBox(path: VectorPath, box: Extents): PathNormalization;
    /** A point on the segment between two anchors, for hit-testing an insert. */
    pointOn(from: PathAnchor, to: PathAnchor, t: number): Vector2;
    /** De Casteljau split, so inserting an anchor does not move the curve. */
    split(from: PathAnchor, to: PathAnchor, t: number): { from: PathAnchor; middle: PathAnchor; to: PathAnchor };
}


export const pathOps: AttributeOps<PathData, PathData> & PathOps = {
    // An SVG path string or command list needs no normalization.
    resolve: (value) => value,
    lerp,

    commands,
    contours,
    cubics,
    anchors,

    bounds,
    size,
    length,
    sampler,

    trim,
    dash,
    dashScale,

    plan,
    sample,

    fromAnchors,
    anchorCommands,
    anchorBounds,
    map,
    translate,
    endFit,
    isEmpty,

    normalize,
    fitToBox,
    pointOn,
    split,
};
