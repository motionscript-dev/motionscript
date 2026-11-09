import {
    commandsFor,
    pathOps,
    Types,
    type BoxBounds,
    type NodeView,
    type PaintProps,
    type PathCommand,
    type RenderContext,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";
import { omit, PAINT, PAINT_COMMANDS } from "./component";
import { LatexMatrix } from "../tex/matrix";
import { Latex } from "../tex/node";
import { isFormula, latexPartBounds } from "../tex/typeset";
import { refId } from "./graph";

/** A node with parts that can be pointed at by name: a formula's terms. */
export interface Parted {
    /** The box of `part`, y-up from the node's centre, or `null` when it has no such part. */
    partBounds(part: string, occurrence?: number): BoxBounds | null;
}

function isParted(node: object): boolean {
    return typeof (node as Partial<Parted>).partBounds === "function" || isFormula(node);
}

/** The box of `part` in `node`: its own `partBounds` answer, or a formula component's by its source. */
function partBoundsOf(node: object, part: string, occurrence: number): BoxBounds | null {
    if (typeof (node as Partial<Parted>).partBounds === "function") return (node as Parted).partBounds(part, occurrence);
    return latexPartBounds(node, part, occurrence) ?? null;
}

/** What a mark is drawn on: a node by id, and one part of it where it has parts. */
export interface Target {
    on: string;
    part?: string;
    occurrence?: number;
}

/** A target on its way to another: `t` of the way from `from`, or from the mark's resting target. */
export interface Retarget extends Target {
    from?: Target | null;
    t: number;
}

export interface FollowProps extends PaintProps {
    on?: string;
    part?: string;
    occurrence?: number;
    retarget?: Retarget | null;
}

/** A target's four corners in its mark's own frame, y-up: top left, top right, bottom right, bottom left. */
export type Quad = [Vector2, Vector2, Vector2, Vector2];

const restOf = ({ on, part, occurrence }: Target): Target => ({ on, part, occurrence });

function lerpRetarget(from: Retarget | null, to: Retarget | null, t: number): Retarget | null {
    if (t <= 0 || !to) return t < 1 ? from : to;
    return { ...restOf(to), from: from ? restOf(from) : null, t };
}

const REF = Types.custom<string, NodeView | null>("", { kind: "nodeRef", animatable: false });
const HELD_REF = Types.custom<string, NodeView | null, { readonly private: true }>("", { kind: "nodeRef", private: true });

/**
 * A mark drawn on another node, or on one part of a formula: a brace, a box,
 * an underline. It has no size of its own and takes no place in a layout; it
 * is drawn where its target is, wherever the two are in the tree, and its
 * selection box is its ink. Its entries, and what it draws on.
 */
export const FOLLOW_STATE = {
    // It is only an outline.
    ...omit(PAINT, "fill"),
    /** The node this mark is drawn on, by id. Left empty, it is the formula the mark sits inside. */
    on: REF,
    /** One part of that node, by its source, where it has parts: `x^2` of a formula. */
    part: Types.text("", { animatable: false }),
    /** Which of the places the part is written, counted from 1. */
    occurrence: Types.number(1, { min: 1, step: 1, animatable: false }),
    /** Where a `retargetTo` has taken the mark, and how far along it is. Not an author's to state. */
    retarget: Types.custom<Retarget | null>(null, { lerp: lerpRetarget }),
    /** The nodes the retarget names, there and where it set out from, read as nodes. */
    retargetOn: HELD_REF,
    retargetFrom: HELD_REF,
};

export const FOLLOW_COMMANDS = {
    ...omit(PAINT_COMMANDS, "fillTo"),
    ...commandsFor(FOLLOW_STATE, {
        /** Move the mark onto another node, or another part. */
        retargetTo: {
            // No defaults for the node and the part: one left out keeps the mark's own.
            args: {
                on: Types.custom<string | undefined>(undefined, { kind: "nodeRef" }),
                part: Types.custom<string | undefined>(undefined, { kind: "text" }),
                occurrence: Types.number(1, { min: 1, step: 1 }),
            },
            run: (timeline, s) => {
                const next = timeline.args;
                const held = s.retarget ?? restingOf(s);
                const to: Retarget = {
                    on: next.on ?? held.on,
                    part: next.part ?? (next.on ? "" : held.part),
                    occurrence: next.occurrence ?? 1,
                    t: 1,
                };
                const from = s.retarget;
                return timeline.animate((t) => {
                    const retarget = lerpRetarget(from, to, t);
                    return { retarget, retargetOn: retarget?.on ?? "", retargetFrom: retarget?.from?.on ?? "" };
                });
            },
        },
    }),
};

/** What a follow mark reads of its state. */
export interface FollowValues {
    readonly on: NodeView | null;
    readonly part: string;
    readonly occurrence: number;
    readonly retarget: Retarget | null;
    readonly retargetOn: NodeView | null;
    readonly retargetFrom: NodeView | null;
}

function restingOf(s: FollowValues): Target {
    return { on: refId(s.on), part: s.part, occurrence: s.occurrence };
}

const containers = new WeakMap<object, NodeView | null>();

/**
 * The formula a follow mark sits in, as its render last found it: what a mark
 * naming no node is drawn on. Its bounds and handles read it from there, where
 * there is no context to ask.
 */
export function container(ctx: RenderContext | null, s: object): NodeView | null {
    if (!ctx) return containers.get(s) ?? null;
    const found = ctx.ancestor(Latex) ?? ctx.ancestor(LatexMatrix);
    const parted = found && isParted(found.state) ? found : null;
    containers.set(s, parted);
    return parted;
}

/** The node the mark rests on: the one `on` names, or the formula it sits in. */
export function resting(s: FollowValues, parted: NodeView | null): NodeView | null {
    return s.on ?? parted;
}

/** The target's corners now: its resting one, or part-way to where a `retargetTo` is taking it. */
export function followedQuad(s: FollowValues, parted: NodeView | null): Quad | null {
    const state = s.retarget;
    const rest = (): Quad | null => quadOf(resting(s, parted), s);
    if (!state) return rest();
    const to = quadOf(state.on === "" ? parted : s.retargetOn, state);
    const from = state.from ? quadOf(state.from.on === "" ? parted : s.retargetFrom, state.from) : rest();
    if (!from || !to || state.t >= 1) return to ?? from;
    return lerpQuad(from, to, state.t);
}

/** Where `target` is, as the mark sees it; `null` when it names no node or part. */
function quadOf(node: NodeView | null, target: Omit<Target, "on">): Quad | null {
    if (!node) return null;
    const box: BoxBounds | null =
        target.part && isParted(node.state)
            ? partBoundsOf(node.state, target.part, target.occurrence || 1)
            : { x: 0, y: 0, width: node.size.width, height: node.size.height };
    if (!box) return null;
    const frame = node.frame;
    const turn = (frame.rotation * Math.PI) / 180;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    // The engine's turn is clockwise, in a y-up frame.
    const place = (x: number, y: number): Vector2 => ({
        x: frame.x + (cos * x + sin * y) * frame.scale,
        y: frame.y + (-sin * x + cos * y) * frame.scale,
    });
    const w = box.width / 2;
    const h = box.height / 2;
    return [place(box.x - w, box.y + h), place(box.x + w, box.y + h), place(box.x + w, box.y - h), place(box.x - w, box.y - h)];
}

function lerpQuad(a: Quad, b: Quad, t: number): Quad {
    return a.map((from, i) => ({ x: from.x + (b[i].x - from.x) * t, y: from.y + (b[i].y - from.y) * t })) as Quad;
}

/** The box of an outline, as a follow mark's bounds: it has no size of its own, so its ink is what is selected. */
export function outlineBounds(outline: readonly PathCommand[]): BoxBounds {
    const ink = pathOps.bounds(outline as PathCommand[]);
    if (!ink) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: (ink.minX + ink.maxX) / 2, y: (ink.minY + ink.maxY) / 2, width: ink.maxX - ink.minX, height: ink.maxY - ink.minY };
}

/** Every drawn point's centre frame: the mark's own centre, so its outline is where it says. */
export const OWN_FRAME: [number, number, number, number] = [-1, -1, 1, 1];

// --- Geometry the marks share ---

export const add = (a: Vector2, b: Vector2, k = 1): Vector2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const between = (a: Vector2, b: Vector2, t = 0.5): Vector2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The unit vector from `a` to `b`, and its length; a zero one points right. */
export function heading(a: Vector2, b: Vector2): { unit: Vector2; length: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    return { unit: length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length }, length };
}

/** A quad grown by `by` pixels on every side, along its own edges. */
export function grown(quad: Quad, by: number): Quad {
    const [tl, tr, br, bl] = quad;
    const across = heading(tl, tr).unit;
    const up = heading(bl, tl).unit;
    return [
        add(add(tl, across, -by), up, by),
        add(add(tr, across, by), up, by),
        add(add(br, across, by), up, -by),
        add(add(bl, across, -by), up, -by),
    ];
}
