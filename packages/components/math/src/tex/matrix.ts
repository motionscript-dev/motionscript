import {
    component2d,
    Types,
    type EntryOptions,
    type NodeOf,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Alignment as _Alignment,
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type FlowMode as _FlowMode,
    type FlowResolved as _FlowResolved,
    type GapSize as _GapSize,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
    type Vector2 as _Vector2,
} from "@motionscript/sdk";
import {
    drawFormula, formula, formulaFrame, layoutFormula, lerpMorph, loadFormula, measureFormula, morphOf, TYPESET, TYPESET_COMMANDS,
    type Morphing,
} from "./typeset";

export type MatrixBrackets = "square" | "round" | "bar" | "double" | "curly" | "none";

const ENVIRONMENT: Record<MatrixBrackets, string> = {
    square: "bmatrix",
    round: "pmatrix",
    bar: "vmatrix",
    double: "Vmatrix",
    curly: "Bmatrix",
    none: "matrix",
};

const BRACKETS = ["square", "round", "bar", "double", "curly", "none"] as const;

/** The LaTeX a matrix of `entries` is typeset from; empty for one with no entries. */
export function matrixSource(entries: readonly (readonly string[])[], brackets: MatrixBrackets = "square"): string {
    const rows = entries.filter((row) => Array.isArray(row) && row.length > 0);
    if (rows.length === 0) return "";
    const environment = ENVIRONMENT[brackets] ?? ENVIRONMENT.square;
    return `\\begin{${environment}} ${rows.map((row) => row.join(" & ")).join(" \\\\ ")} \\end{${environment}}`;
}

interface MatrixValues {
    readonly entries: Morphing<string[][]>;
    readonly brackets: Morphing<MatrixBrackets>;
}

/** The matrix's source now: mid-tween of its entries or its brackets, both ends of it. */
function sourceOf(s: MatrixValues): Morphing<string> {
    return morphOf([s.entries, s.brackets], ([entries, brackets]) => matrixSource(entries as string[][], brackets as MatrixBrackets));
}

const state = {
    ...TYPESET,
    // Unused by the matrix's own drawing: its entries say what it writes.
    latex: Types.custom<string, Morphing<string>, EntryOptions & { readonly kind: "text"; readonly multiline: true }>("", {
        kind: "text", multiline: true, lerp: lerpMorph,
    }),
    /** A list of rows is a whole value: mid-tween it holds both, and the morph draws the way there. */
    entries: Types.custom<string[][], Morphing<string[][]>>([["a", "b"], ["c", "d"]], { lerp: lerpMorph }),
    brackets: Types.custom<MatrixBrackets, Morphing<MatrixBrackets>, EntryOptions & { readonly options: typeof BRACKETS }>("square", {
        options: BRACKETS, animatable: false, lerp: lerpMorph,
    }),
};

/** A matrix typeset from its entries inside its brackets; each entry is a formula part, addressable by its source. */
export const LatexMatrix = formula(component2d({
    key: "latexMatrix",
    state,
    defaults: { width: "hug", height: "hug" },
    load: (loader) => loadFormula(loader),
    commands: {
        ...TYPESET_COMMANDS,
        morphTo: { args: ["latex"] },
        /** Change the entries: the ones both matrices write travel, the rest fade. */
        entriesTo: { args: ["entries"] },
    },
    measure: (_measurer, s) => measureFormula(formulaFrame(sourceOf(s), s.fontSize, s.partFills), s),
    layout: (box, s, children) => layoutFormula(box, s, children),
    render: (ctx, s) => drawFormula(ctx, s, formulaFrame(sourceOf(s), s.fontSize, s.partFills)),
}), sourceOf);

export type LatexMatrix = NodeOf<typeof LatexMatrix>;
