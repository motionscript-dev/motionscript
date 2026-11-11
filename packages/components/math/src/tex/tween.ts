import { lerpNumber, type PathCommand } from "@motionscript/sdk";
import type { LatexToken } from "./geometry";

export interface AnimatedToken {
    token: string;
    path: LatexToken["path"];
    /** The top-level term it belongs to at rest; a morph matches on it. */
    term?: string;
    opacity: number;
    x: number;
    y: number;
    /** Mid-morph: the index of the token it was in the formula left, and of the one it becomes. */
    from?: number;
    to?: number;
}

/**
 * How a `Latex` node interpolates between two formulas: a pure `t -> tokens`
 * frame function. {@link defaultLatexMorph} is the default; pass a `morph` to replace it.
 */
export type LatexMorphStrategy = (from: LatexToken[], to: LatexToken[]) => (t: number) => AnimatedToken[];

const POINT_FIELDS = [["x", "y"], ["x1", "y1"], ["x2", "y2"]] as const;

function centroid(path: LatexToken["path"]): { x: number; y: number } {
    let sx = 0, sy = 0, n = 0;
    for (const cmd of path) {
        if ("x" in cmd && "y" in cmd) {
            sx += (cmd as any).x;
            sy += (cmd as any).y;
            n++;
        }
    }
    return n > 0 ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

/** The diagonal of a path's control-point bbox: only ever a ratio between the two ends of a match, so the control-point overshoot cancels. */
function extent(path: LatexToken["path"]): number {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cmd of path) {
        const c = cmd as any;
        for (const [kx, ky] of POINT_FIELDS) {
            if (kx in c) {
                if (c[kx] < minX) minX = c[kx];
                if (c[kx] > maxX) maxX = c[kx];
                if (c[ky] < minY) minY = c[ky];
                if (c[ky] > maxY) maxY = c[ky];
            }
        }
    }
    if (minX > maxX) return 0;
    return Math.hypot(maxX - minX, maxY - minY);
}

/**
 * Whether two paths share command count and types. A matched pair almost always
 * does: a character's glyph id keys one outline in `<defs>`, emitted under two
 * transforms.
 */
function isPointwiseCompatible(from: PathCommand[], to: PathCommand[]): boolean {
    if (from.length !== to.length) return false;
    for (let i = 0; i < from.length; i++) {
        if (from[i].type !== to[i].type) return false;
    }
    return true;
}

/**
 * Lerp two structurally identical paths point by point. Matched glyphs are one
 * outline under two uniform-scale-plus-translate transforms, and a blend of
 * those is another, so the in-between is a well-formed glyph at an in-between size.
 */
function lerpPath(from: PathCommand[], to: PathCommand[], t: number): PathCommand[] {
    const out: PathCommand[] = new Array(from.length);
    for (let i = 0; i < from.length; i++) {
        const f = from[i] as any;
        const g = to[i] as any;
        const c: any = { ...g };
        for (const [kx, ky] of POINT_FIELDS) {
            if (kx in g && kx in f) {
                c[kx] = lerpNumber(f[kx], g[kx], t);
                c[ky] = lerpNumber(f[ky], g[ky], t);
            }
        }
        out[i] = c as PathCommand;
    }
    return out;
}

/**
 * Scale a path about (cx, cy), then translate by (dx, dy). The fallback for a
 * matched pair whose paths differ in structure (a stretchy delimiter built from
 * different pieces): the target outline starts at the source's size and grows back.
 */
function scaleAbout(
    path: PathCommand[],
    cx: number,
    cy: number,
    s: number,
    dx: number,
    dy: number,
): PathCommand[] {
    return path.map(cmd => {
        const c: any = { ...(cmd as any) };
        for (const [kx, ky] of POINT_FIELDS) {
            if (kx in c) {
                c[kx] = cx + (c[kx] - cx) * s + dx;
                c[ky] = cy + (c[ky] - cy) * s + dy;
            }
        }
        return c as PathCommand;
    });
}

/**
 * Match tokens from `from` to `to` by character key, a term that both formulas
 * write first: the `x^2` of `x^2 + 1` travels to the `x^2` of `y = x^2` as
 * one, instead of lending its `2` to whichever `2` comes first. What is left
 * is matched greedily by character alone.
 */
function matchTokens(
    from: LatexToken[],
    to: LatexToken[],
): {
    matched: Array<{ from: LatexToken; to: LatexToken }>;
    deleted: LatexToken[];
    added: LatexToken[];
} {
    const remaining = [...to];
    const partner = new Map<LatexToken, LatexToken>();
    // Synthetic shapes (rects/paths) have no natural token key.
    const keyed = (t: LatexToken) => !t.token.startsWith("__");
    const pair = (same: (f: LatexToken, t: LatexToken) => boolean) => {
        for (const ft of from) {
            if (!keyed(ft) || partner.has(ft)) continue;
            const idx = remaining.findIndex(t => keyed(t) && same(ft, t));
            if (idx === -1) continue;
            partner.set(ft, remaining[idx]);
            remaining.splice(idx, 1);
        }
    };
    pair((f, t) => f.token === t.token && f.term !== undefined && f.term === t.term);
    pair((f, t) => f.token === t.token);

    const matched: Array<{ from: LatexToken; to: LatexToken }> = [];
    const deleted: LatexToken[] = [];
    for (const ft of from) {
        const tt = partner.get(ft);
        if (tt) matched.push({ from: ft, to: tt });
        else deleted.push(ft);
    }

    return { matched, deleted, added: remaining };
}

/**
 * Precompute a formula-change morph as a pure `t -> tokens` frame function:
 * deleted tokens fade out over the first half, matched tokens interpolate place
 * and size across the whole range, added tokens fade in over the second half.
 *
 * Size must be interpolated with place: a matched glyph is rarely the same size
 * at both ends (the `2` of `b^2` against the `2` of `2a`), and sliding only the
 * centroid would snap to the new size before the glide. `t` is already eased.
 */
export function defaultLatexMorph(
    from: LatexToken[],
    to: LatexToken[],
): (t: number) => AnimatedToken[] {
    const { matched, deleted, added } = matchTokens(from, to);

    // Properties of the pair rather than of `t`, settled once.
    const fromIndex = new Map(from.map((token, i) => [token, i]));
    const toIndex = new Map(to.map((token, i) => [token, i]));
    const matchedData = matched.map(({ from: f, to: t }) => {
        const toExtent = extent(t.path);
        return {
            from: fromIndex.get(f),
            to: toIndex.get(t),
            pointwise: isPointwiseCompatible(f.path, t.path),
            fromPath: f.path,
            toPath: t.path,
            token: t.token,
            fromCenter: centroid(f.path),
            toCenter: centroid(t.path),
            fromScale: toExtent > 0 ? extent(f.path) / toExtent : 1,
        };
    });

    return (t: number): AnimatedToken[] => {
        const tokens: AnimatedToken[] = [];

        for (const m of matchedData) {
            if (m.pointwise) {
                tokens.push({
                    token: m.token,
                    path: lerpPath(m.fromPath, m.toPath, t),
                    opacity: 1,
                    // The lerp already carries where the glyph sits.
                    x: 0,
                    y: 0,
                    from: m.from,
                    to: m.to,
                });
                continue;
            }

            const s = lerpNumber(m.fromScale, 1, t);
            const cx = lerpNumber(m.fromCenter.x, m.toCenter.x, t);
            const cy = lerpNumber(m.fromCenter.y, m.toCenter.y, t);
            tokens.push({
                token: m.token,
                path: scaleAbout(
                    m.toPath,
                    m.toCenter.x,
                    m.toCenter.y,
                    s,
                    cx - m.toCenter.x,
                    cy - m.toCenter.y,
                ),
                opacity: 1,
                x: 0,
                y: 0,
                from: m.from,
                to: m.to,
            });
        }

        for (const d of deleted) {
            const fadeT = Math.min(t * 2, 1);
            tokens.push({
                token: d.token,
                path: d.path,
                opacity: lerpNumber(1, 0, fadeT),
                x: 0,
                y: 0,
                from: fromIndex.get(d),
            });
        }

        for (const a of added) {
            const fadeT = Math.max(t * 2 - 1, 0);
            tokens.push({
                token: a.token,
                path: a.path,
                opacity: lerpNumber(0, 1, fadeT),
                x: 0,
                y: 0,
                to: toIndex.get(a),
            });
        }

        return tokens;
    };
}
