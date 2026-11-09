import { fillOps } from "@/attributes/shape/fill/registry";
import { strokeOps } from "@/attributes/shape/stroke/stroke";
import type { ResolvedTextRun, TextRun, TextSpan, FontStyle, TextAlign, TextCase, TextDecoration, VerticalAlign } from "@/attributes/text/types";
import { formatNumber } from "@/components/builtins/text/number-format";
import { numberNodePattern } from "@/components/builtins/text/number-pattern";
import type { PathData } from "@/render/descriptors/path";
import { PathBuilder } from "@/render/descriptors/path-builder";
import type { NodeOf } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Types } from "@/components/factory/types";
import * as Paint from "@/components/modules/paint";
import * as TextLayout from "@/components/modules/text-layout";
import * as TextStyle from "@/components/modules/text-style";

import type { Node2DProps } from "@/components/trees/2d/node2d";
import type { Fill } from "@/attributes/shape/fill/chain";
import type { Stroke } from "@/attributes/shape/stroke/stroke";
import type { PaintProps } from "@/components/builtins/geometry/geometry";
import type { Shadow } from "@/attributes/shape/shadow/shadow";

/**
 * The text built-ins. A glyph node paints like a shape, but has no outline to
 * lay an overlay over, so it takes Paint without one; its face comes from
 * TextStyle, which inherits what the author left unset.
 */

const { overlay: _overlay, ...glyphPaint } = Paint.state;
const { overlayTo: _overlayTo, ...glyphCommands } = Paint.commands;

/** Glyphs hug themselves; `'autofit'` fills the box it fits to. */
const autofits = (state: { readonly fontSize: number | "autofit" }) => (state.fontSize === "autofit" ? "fill" : "hug");

const NO_RUNS: readonly never[] = [];

function resolvePath(value: PathData | PathBuilder | null | undefined): PathData | null {
    if (value == null) return null;
    return value instanceof PathBuilder ? value.toCommands() : value;
}

function resolveRuns(value: TextRun[] | null | undefined): ResolvedTextRun[] {
    if (!Array.isArray(value)) return [];
    return value.map(({ fill, stroke, ...run }) => ({
        ...run,
        ...(fill === undefined ? {} : { fill: fillOps.resolve(fill) }),
        ...(stroke === undefined ? {} : { stroke: strokeOps.resolve(stroke) }),
    }));
}

const textState = {
    ...glyphPaint,
    ...TextStyle.state,
    text: Types.text("", { typing: true }),
    wrap: false,
    path: Types.custom<PathData | PathBuilder | null, PathData | null>(null, { resolve: resolvePath }),
    runs: Types.custom<TextRun[], ResolvedTextRun[]>([], { resolve: resolveRuns, animatable: false }),
};

const textSource = (state: { readonly text: string; readonly wrap: boolean; readonly path: PathData | null; readonly runs: ResolvedTextRun[] }) =>
    ({ text: state.text, wraps: state.wrap, glyphPath: state.path, runs: state.runs });

/** Copy somebody typed: wraps when asked, rides a path, styles stretches of itself. */
export const Text = component2d({
    key: "text",
    allowedChildren: [],
    state: textState,
    defaults: {
        width: (state) => (state.fontSize === "autofit" || state.wrap ? "fill" : "hug"),
        height: autofits,
    },
    commands: {
        ...glyphCommands,
        append: {
            args: { text: Types.text("", { multiline: true }) },
            run: (timeline, state) => timeline.tween({ text: state.text + timeline.args.text }),
        },
        prepend: {
            args: { text: Types.text("", { multiline: true }) },
            run: (timeline, state) => timeline.tween({ text: timeline.args.text + state.text }),
        },
    },
    load: (loader, state) => TextLayout.load(loader, state, textSource(state)),
    measure: (measurer, state) => TextLayout.measure(measurer, state, textSource(state)),
    render: (ctx, state) => TextLayout.draw(ctx, state, textSource(state)),
});

const numberState = {
    ...glyphPaint,
    ...TextStyle.state,
    value: 0,
    format: Types.custom<NumberFormat>("number"),
    customPattern: "",
    fractionDigits: 0,
    grouped: true,
    currencySymbol: "$",
};

const numberSource = (state: Parameters<typeof numberNodePattern>[0] & { readonly value: number }) =>
    ({ text: formatNumber(state.value, numberNodePattern(state)), wraps: false, glyphPath: null, runs: NO_RUNS });

/** A figure, formatted from its value: a quantity, not copy. */
export const NumberNode = component2d({
    key: "number",
    allowedChildren: [],
    state: numberState,
    defaults: { width: autofits, height: autofits },
    commands: { ...glyphCommands, countTo: { args: ["value"] } },
    load: (loader, state) => TextLayout.load(loader, state, numberSource(state)),
    measure: (measurer, state) => TextLayout.measure(measurer, state, numberSource(state)),
    render: (ctx, state) => TextLayout.draw(ctx, state, numberSource(state)),
});

const { verticalAlign: _v, textDecoration: _d, textCase: _c, minFontSize: _m, ...richStyle } = TextStyle.state;

/** Spans of text, each styled on its own, set on lines that break only where they say. */
export const RichText = component2d({
    key: "richtext",
    allowedChildren: [],
    state: {
        ...glyphPaint,
        ...richStyle,
        fontSize: Types.number(48, { inherit: TextStyle.inherit("fontSize", { autofit: false }) }),
        spans: Types.custom<TextSpan | TextSpan[], TextSpan[]>([], {
            resolve: (v) => (v == null ? [] : Array.isArray(v) ? v : [v]),
        }),
    },
    defaults: { width: "hug", height: "hug" },
    commands: { ...glyphCommands },
    load: (loader, state) => TextLayout.loadRichText(loader, state),
    measure: (measurer, state) => TextLayout.measureRichText(measurer, state),
    render: (ctx, state) => TextLayout.drawRichText(ctx, state),
});

/** The face text below it is set in, field by field, over whatever is inherited from above. */
export const DefaultTextStyle = component2d({
    key: "default-text-style",
    state: TextStyle.provided,
    provide: (state, inherited) => TextStyle.provide(state, inherited),
    render: (ctx, state) => ctx.textStyle(TextStyle.current(state), () => ctx.children()),
});

export type Text = NodeOf<typeof Text>;
export type NumberNode = NodeOf<typeof NumberNode>;
export type RichText = NodeOf<typeof RichText>;
export type DefaultTextStyle = NodeOf<typeof DefaultTextStyle>;

// What code building a text node names its props as.

/** The fields a string is shaped and set by, shared by every node that draws glyphs. */
export interface TextBaseProps extends PaintProps {
    fontSize: number | 'autofit';
    fontFamily: string;
    fontWeight: number;
    fontStyle: FontStyle;
    letterSpacing: number;
    lineHeight: number;
    textAlign: TextAlign;
    verticalAlign: VerticalAlign;
    textDecoration: TextDecoration;
    textCase: TextCase;
    minFontSize: number;
    /**
     * Name of a typography preset from `theme.typography` (e.g. `"header"`).
     * Supplies any text-style prop (fontSize, fontWeight, …) not set explicitly
     * here. An explicit prop always wins over the preset; the preset wins over an
     * inherited `<DefaultTextStyle>`.
     */
    variant: string;
}

export interface TextProps extends TextBaseProps {
    text: string;
    /** Wrap onto more lines once the text runs out of width. */
    wrap: boolean;
    /**
     * Wrap the text around a path (text-on-path). Accepts the same value shapes
     * as the {@link Path} node's `d`: an SVG path string, a `PathCommand[]`, or a
     * {@link PathBuilder}. When set, `wrap` and multi-line (`\n`) are ignored
     * (single line), and `runs` are not applied.
     */
    path: PathData | PathBuilder;
    /**
     * Stretches of `text` styled apart from the node — see {@link TextRun}.
     * Where two overlap the later one wins; offsets past the end of the string
     * style nothing. Ignored on a `path`.
     */
    runs: TextRun[];
}

/**
 * How a {@link NumberNode}'s value is written down.
 *
 * `'custom'` hands the pattern over verbatim through
 * {@link NumberProps.customPattern}; the other three compose one from
 * {@link NumberProps.fractionDigits} and {@link NumberProps.grouped}.
 */
export type NumberFormat = "currency" | "percent" | "number" | "custom";

export interface NumberProps extends TextBaseProps {
    /** The numeric value to display. Tweenable — `to({ value })` counts. */
    value: number;
    /**
     * How the figure is written:
     * - `'number'` — plain decimal (the default)
     * - `'currency'` — money, prefixed with {@link NumberProps.currencySymbol}
     * - `'percent'` — multiplies by 100 and appends `%` (so `0.42` → `42%`)
     * - `'custom'` — {@link NumberProps.customPattern}, verbatim
     */
    format: NumberFormat;
    /**
     * The pattern, when {@link NumberProps.format} is `'custom'` — the same
     * grammar `formatNumber` takes (`#,##0.00`, `0.0%`, `$#,##0`).
     */
    customPattern: string;
    /**
     * Fixed number of decimal places. Always exactly this many, which is what
     * keeps a counting animation from flickering trailing digits as the value
     * crosses an integer boundary.
     */
    fractionDigits: number;
    /** Group digits in threes — `1,000` rather than `1000`. */
    grouped: boolean;
    /** The symbol a `'currency'` figure is prefixed with. */
    currencySymbol: string;
}

export interface RichTextProps extends PaintProps {
    spans: TextSpan | TextSpan[];
    /** Default font family inherited by spans that don't set one. */
    fontFamily: string;
    /** Default font size inherited by spans that don't set one. */
    fontSize: number;
    /** Default font weight inherited by spans that don't set one. */
    fontWeight: number;
    /** Default font style inherited by spans that don't set one. */
    fontStyle: FontStyle;
    /** Default letter spacing inherited by spans that don't set one. */
    letterSpacing: number;
    /** Line height multiplier applied to each run's font size. */
    lineHeight: number;
    textAlign: TextAlign;
    /**
     * Name of a typography preset from `theme.typography` (e.g. `"body"`).
     * Supplies any node-level default (fontSize, fontWeight, â€¦) not set
     * explicitly here, which `runs()` then folds into each span. An explicit prop
     * wins over the preset; the preset wins over an inherited `<DefaultTextStyle>`.
     */
    variant: string;
}

export interface DefaultTextStyleProps extends Node2DProps {
    fontFamily: string;
    fontSize: number | 'autofit';
    fontWeight: number;
    fontStyle: FontStyle;
    letterSpacing: number;
    lineHeight: number;
    textAlign: TextAlign;
    fill: Fill;
    stroke: Stroke;
    shadow: Shadow;
}
