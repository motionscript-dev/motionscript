import type { NormalizedColor } from "@motionscript/sdk";
import type { CodeLayout } from "./layout";
import { IdLine } from "./tokens";

/** Keyed by token id, not (line, index), so a concurrent edit that shifts indices doesn't clobber it. */
export interface AnimToken {
    id: number;
    opacity: number[];
    opacityKeys: number[];
}

/** A highlight cross-fade: opacity only, so several stack and a highlighted listing still hits the static-layout cache. */
export interface DimTransition {
    kind: "dim";
    tokens: AnimToken[];
    progress: number;
}

/** When each part of an edit happens, in normalized time: out, then move, then in. Run together, a replacement reads as a cross-dissolve of two listings. */
export interface Phases {
    /** Null when the edit removes nothing. */
    out: [number, number] | null;
    /** Surviving tokens travel and the block resizes. */
    move: [number, number];
    /** Null when the edit adds nothing. */
    in: [number, number] | null;
}

/** One edit in flight. Both endpoints are fixed, so the two layouts are computed once and reused for every frame. */
export interface StructuralTransition {
    kind: "structural";
    from: IdLine[];
    to: IdLine[];
    removedIds: Set<number>;
    addedIds: Set<number>;
    /** Rows of `to` that enter as a whole row. They only fade in place: text is written where it belongs, and sliding one in puts it under its neighbours. */
    enteringLineIds: Set<number>;
    fromColorById: Map<number, string | undefined>;
    phases: Phases;
    progress: number;
    /** @internal */
    layoutKey: string | null;
    fromLayout: CodeLayout | null;
    toLayout: CodeLayout | null;
}

/** A filled band behind whole rows: the first and last line it covers, by line id so it follows them through an edit, and its paint. */
export interface RowBand {
    startId: number;
    endId: number;
    color: NormalizedColor;
    radius: number;
}

/** Bands at the same position in both lists travel and recolour; one with no counterpart fades. */
export interface RowsTransition {
    kind: "rows";
    from: RowBand[];
    to: RowBand[];
    progress: number;
}

export type CodeTransition = DimTransition | StructuralTransition | RowsTransition;

/** Decides the {@link Phases} from whether the edit removes or adds anything; `defaultCodePhases` is the default. */
export type CodePhaseStrategy = (hasRemoved: boolean, hasAdded: boolean) => Phases;

export interface TokenState {
    opacity: number;
}

/** Samples a piecewise-linear curve at progress `p`. */
export function sampleCurve(keys: number[], values: number[], p: number): number {
    if (p <= keys[0]) return values[0];
    if (p >= keys[keys.length - 1]) return values[values.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
        if (p <= keys[i + 1]) {
            const span = keys[i + 1] - keys[i];
            const local = span === 0 ? 0 : (p - keys[i]) / span;
            return values[i] + (values[i + 1] - values[i]) * local;
        }
    }
    return values[values.length - 1];
}

/** Progress *within* a phase window, clamped to [0, 1]. A null window is complete. */
export function windowProgress(w: [number, number] | null, p: number): number {
    if (!w) return 1;
    const [a, b] = w;
    if (p <= a) return 0;
    if (p >= b) return 1;
    return b === a ? 1 : (p - a) / (b - a);
}

/** Smooth start and end, so a phase never begins or ends with a velocity step. */
export function smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
}

export function makeAnim(id: number, curve: { keys: number[]; values: number[] }): AnimToken {
    return { id, opacity: curve.values, opacityKeys: curve.keys };
}

/** A pure append has nothing to fade out, so each edit shape spends the whole duration on the phases it has. */
export function defaultCodePhases(hasRemoved: boolean, hasAdded: boolean): Phases {
    // The overlaps are deliberate and small. Butt-joining the phases leaves the
    // block sitting empty at its new size for a beat between the old content
    // leaving and the new content arriving; letting the arrival start while the
    // reflow's eased tail is still running closes that gap without blurring the
    // order the edit reads in.
    if (hasRemoved && hasAdded) return { out: [0, 0.38], move: [0.10, 0.68], in: [0.52, 1] };
    if (hasRemoved) return { out: [0, 0.45], move: [0.22, 1], in: null };
    if (hasAdded) return { out: null, move: [0, 0.55], in: [0.38, 1] };
    return { out: null, move: [0, 1], in: null };
}

/** Eased progress of the move phase; a settled frame (no edit) is fully moved. */
export function moveProgress(edit: { phases: Phases; progress: number } | null): number {
    return edit ? smoothstep(windowProgress(edit.phases.move, edit.progress)) : 1;
}

/** Per-token opacity: the persistent highlight dim, overridden by each active dim transition. */
export function resolveTokenStates(
    tokenLines: IdLine[],
    transitions: CodeTransition[],
    highlightDimOpacity: number | null,
    highlightedIds: Set<number>,
): Map<number, TokenState> {
    const out = new Map<number, TokenState>();

    if (highlightDimOpacity !== null) {
        const dim = highlightDimOpacity;
        for (const line of tokenLines) {
            for (const tok of line.tokens) {
                out.set(tok.id, { opacity: highlightedIds.has(tok.id) ? 1 : dim });
            }
        }
    }

    for (const tr of transitions) {
        if (tr.kind !== "dim") continue;
        for (const at of tr.tokens) {
            out.set(at.id, { opacity: sampleCurve(at.opacityKeys, at.opacity, tr.progress) });
        }
    }

    return out;
}
