import {
    component2d,
    fillOps,
    Graphics2D,
    Types,
    type Fill,
    type FillResolved,
    type NodeOf,
    type Color as _Color,

    type NormalizedColor,
    type RenderContext,
    type ShadowResolved,
    type Size2D,
    type StrokeResolved,
    type Values,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type Stroke as _Stroke,
} from "@motionscript/sdk";
import { braceOutline } from "../kit/brace";
import { omit, PAINT, PAINT_COMMANDS, painted } from "../kit/component";
import { drawLabels, loadFormulas, type Label } from "../kit/furniture";
import { lerpFillScale, readFillScale } from "../kit/scale";
import { formatTick } from "../kit/ticks";

/** The parts' paints until told otherwise, a column each, round again past the last. */
const PALETTE = ["#58a6ff", "#f59e0b", "#4ade80", "#f472b6", "#a78bfa", "#2dd4bf"];

/** How strongly the lower part of a split column shows its paint. */
const LOWER = 0.45;

function readShares(value: readonly number[] | undefined): number[] {
    return (Array.isArray(value) ? value : []).map((share) => (Number.isFinite(share) && share > 0 ? share : 0));
}

// Shares tween one by one; a different count has nothing to pair with, and changes at the end.
function lerpShares(from: number[], to: number[], t: number): number[] {
    if (from.length !== to.length) return t < 1 ? from : to;
    return to.map((share, i) => from[i] + (share - from[i]) * t);
}

const state = {
    // Its parts are painted from `columnFills`, and it trims no outline of its own.
    ...omit(PAINT, "fill", "start", "end"),
    /** How the whole is shared across, left to right; any numbers, read as shares of their sum. */
    columnShares: Types.custom<number[]>([1], { resolve: readShares, lerp: lerpShares, kind: "vector" }),
    /** Each column's upper share, 0 to 1; a column without one is not cut across. */
    rowShares: Types.custom<number[]>([], { resolve: readShares, lerp: lerpShares, kind: "vector" }),
    /** Each column's paint, left to right, round again past the last; its lower part shows it fainter. */
    columnFills: Types.custom<Fill[], FillResolved[][]>([], { resolve: readFillScale, lerp: lerpFillScale, kind: "vector" }),
    columnLabels: Types.custom<string[]>([], { animatable: false, kind: "vector" }),
    /** The upper part's name and the lower's, written on the left. */
    rowLabels: Types.custom<string[]>([], { animatable: false, kind: "vector" }),
    /** Write each part's probability in it. */
    values: Types.boolean(false, { animatable: false }),
    labelSize: Types.number(20, { min: 1, unit: "px" }),
    labelColor: Types.color("#e5e7eb"),
    fontFamily: Types.text("", { animatable: false }),
};

export type SampleSpaceValues = Values<typeof state>;

/** One part of a sample space: its box in pixels from the node's centre, y up, and its probability. */
export interface SamplePart {
    x: number;
    y: number;
    width: number;
    height: number;
    probability: number;
    column: number;
    upper: boolean;
}

/**
 * A probability's whole as a box cut into columns by `columnShares`, each cut
 * again by its `rowShares` entry (P(B | A) above, the rest below): each part's
 * area is its probability.
 */
export const SampleSpace = component2d({
    key: "sampleSpace",
    state,
    defaults: { stroke: { weight: 2, fill: "#0b0d12", align: "center" } },
    load: (loader, s) => {
        if (s.fontFamily !== "") loader.font(s.fontFamily);
        loadFormulas(loader, [...s.columnLabels, ...s.rowLabels]);
    },
    commands: {
        ...omit(PAINT_COMMANDS, "fillTo", "progressTo", "flash"),
        /** Move the cuts: the columns' shares, each column's upper share, or both. */
        divideTo: { args: ["columnShares", "rowShares"] },
    },
    render: (ctx, s) => painted(ctx, () => drawSpace(ctx, s)),
});

export type SampleSpace = NodeOf<typeof SampleSpace>;

/** Each part of a sample space of `size`: columns left to right, upper part first. */
export function sampleParts(space: SampleSpaceValues, size: Size2D): SamplePart[] {
    const box = boxOf(space, size);
    const shares = space.columnShares;
    const total = shares.reduce((sum, share) => sum + share, 0);
    if (!(total > 0) || box.width <= 0 || box.height <= 0) return [];
    const out: SamplePart[] = [];
    let left = box.x - box.width / 2;
    shares.forEach((share, column) => {
        const width = (box.width * share) / total;
        const p = share / total;
        const cut = space.rowShares[column];
        const top = box.y + box.height / 2;
        if (cut === undefined) {
            out.push({ x: left + width / 2, y: box.y, width, height: box.height, probability: p, column, upper: true });
        } else {
            const upper = Math.min(1, Math.max(0, cut));
            const h = box.height * upper;
            out.push({ x: left + width / 2, y: top - h / 2, width, height: h, probability: p * upper, column, upper: true });
            out.push({ x: left + width / 2, y: top - h - (box.height - h) / 2, width, height: box.height - h, probability: p * (1 - upper), column, upper: false });
        }
        left += width;
    });
    return out;
}

function drawSpace(ctx: RenderContext, space: SampleSpaceValues): void {
    const parts = sampleParts(space, ctx.size);
    if (parts.length === 0) return;
    const fills = space.columnFills;
    const stroke = space.stroke as StrokeResolved[];
    const labels: Label[] = [];
    for (const part of parts) {
        if (!(part.width > 0) || !(part.height > 0)) continue;
        const base = fills.length > 0 ? fills[part.column % fills.length] : fillOps.resolve(PALETTE[part.column % PALETTE.length]);
        const paint = part.upper ? base : base.map((layer) => ({ ...layer, opacity: (layer.opacity ?? 1) * LOWER }));
        const g = new Graphics2D().rect({ x: part.x, y: part.y, width: part.width, height: part.height });
        ctx.draw(g.shadow(space.shadow as ShadowResolved[]).fill(paint));
        if (stroke.length > 0) ctx.draw(new Graphics2D().rect({ x: part.x, y: part.y, width: part.width, height: part.height }).stroke(stroke));
        if (space.values && part.height > space.labelSize && part.width > space.labelSize) {
            labels.push({ text: formatTick(Math.round(part.probability * 1000) / 1000, 0.001), at: { x: part.x, y: part.y }, align: "center" });
        }
    }
    labels.push(...braces(ctx, space, parts));
    const style = { fontSize: space.labelSize, fontFamily: space.fontFamily, color: space.labelColor as NormalizedColor };
    for (const part of drawLabels(labels, style)) ctx.draw(part);
}

/** Room for the braces and their names, below and on the left, taken from the box. */
function boxOf(space: SampleSpaceValues, size: Size2D): { x: number; y: number; width: number; height: number } {
    const { width, height } = size;
    const room = space.labelSize * 2.6;
    const below = space.columnLabels.some((label) => label !== "") ? room : 0;
    const left = space.rowLabels.some((label) => label !== "") ? room * 1.6 : 0;
    return { x: left / 2, y: below / 2, width: Math.max(0, width - left), height: Math.max(0, height - below) };
}

/** Braces under each column and beside the first column's parts, and the labels that name them. */
function braces(ctx: RenderContext, space: SampleSpaceValues, parts: readonly SamplePart[]): Label[] {
    const box = boxOf(space, ctx.size);
    const reach = space.labelSize * 0.8;
    const gap = 6;
    const runs = new Graphics2D();
    const labels: Label[] = [];
    let drawn = false;
    const brace = (from: Vector2, to: Vector2, out: Vector2, text: string, align: Label["align"]) => {
        if (text === "") return;
        // A frame centred on the node's own centre, so the path is drawn where it is and not moved onto it.
        runs.path({ data: braceOutline(from, to, out, reach), centerBounds: [-1, -1, 1, 1] });
        drawn = true;
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const far = reach + space.labelSize * 0.75;
        labels.push({ text, at: { x: mid.x + out.x * far, y: mid.y + out.y * far }, align });
    };
    const bottom = box.y - box.height / 2 - gap;
    for (const part of parts) {
        if (!part.upper && space.rowShares[part.column] !== undefined) continue;
        const text = space.columnLabels[part.column] ?? "";
        // Left to right along the bottom, so the bulge, to the edge's right, points down.
        brace({ x: part.x + part.width / 2, y: bottom }, { x: part.x - part.width / 2, y: bottom }, { x: 0, y: -1 }, text, "center");
    }
    const first = parts.filter((part) => part.column === 0);
    const left = box.x - box.width / 2 - gap;
    if (space.rowShares[0] !== undefined) {
        first.forEach((part) => {
            const text = space.rowLabels[part.upper ? 0 : 1] ?? "";
            brace({ x: left, y: part.y - part.height / 2 }, { x: left, y: part.y + part.height / 2 }, { x: -1, y: 0 }, text, "right");
        });
    }
    if (drawn) {
        const fill = fillOps.resolve({ type: "solid", color: space.labelColor as NormalizedColor });
        ctx.draw(runs.stroke({ weight: 2, fill, align: "center", cap: "round", join: "round" }));
    }
    return labels;
}
