import {
    component2d,
    Types,
    type EntryOptions,
    type InsetsProps,
    type NodeOf,
    type ShapeProps,
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
// From each module, never the `../engine` barrel: it re-exports this file, so a
// load that enters through the barrel would build this component before the
// modules it spreads exist.
import type { PartFill } from "../kit/part-fills";
import {
    drawFormula, formula, formulaFrame, layoutFormula, lerpMorph, loadFormula, measureFormula, TYPESET, TYPESET_COMMANDS,
    type Morphing,
} from "./typeset";
import type { LatexMorphStrategy } from "./tween";

export interface LatexProps extends ShapeProps {
    latex: string;
    fontSize: number;
    padding: InsetsProps;
    partFills: PartFill[];
    written: number;
}

/**
 * How a formula morphs, for a node built on the `Typeset` helpers: they take it
 * as an argument (`formulaFrame(source, fontSize, partFills, morph)`).
 */
export interface LatexStrategies {
    /** How the node morphs between two formulas. Defaults to `defaultLatexMorph`. */
    morph?: LatexMorphStrategy;
}

const state = {
    ...TYPESET,
    /** The formula. Mid-tween it holds both ends, and the glyphs morph from the one into the other. */
    latex: Types.custom<string, Morphing<string>, EntryOptions & { readonly kind: "text"; readonly multiline: true }>("", {
        kind: "text", multiline: true, lerp: lerpMorph,
    }),
};

/** A LaTeX formula drawn as glyph paths, morphing token by token between formulas. */
export const Latex = formula(component2d({
    key: "latex",
    state,
    defaults: { width: "hug", height: "hug" },
    load: (loader) => loadFormula(loader),
    commands: {
        ...TYPESET_COMMANDS,
        /** Morph this formula into another, its glyphs travelling to their places in it. */
        morphTo: { args: ["latex"] },
    },
    measure: (_measurer, s) => measureFormula(formulaFrame(s.latex, s.fontSize, s.partFills), s),
    layout: (box, s, children) => layoutFormula(box, s, children),
    render: (ctx, s) => drawFormula(ctx, s, formulaFrame(s.latex, s.fontSize, s.partFills)),
}), (s: { readonly latex: Morphing<string> }) => s.latex);

export type Latex = NodeOf<typeof Latex>;
