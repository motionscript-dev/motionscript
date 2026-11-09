/**
 * Every text operation, on one object.
 *
 * `textOps` was already the text attribute's `resolve`/`lerp` pair; it now also
 * carries what a `TextStyle` needs — the preset lookup, the merge every
 * text-default channel is built on, a whole style's resolve/lerp pair — and span
 * flattening, the shape `pathOps` has.
 *
 * The two cascades built on these are deliberately not here. A node's
 * (`applyTextDefaults`) lives beside `DefaultTextStyle` and a drawn op's
 * (`applyGraphicsTextDefaults`) beside `draw()`: each belongs to its channel, not
 * to the style.
 */
import type { AttributeOps } from "@/attributes/shared/operators";
import { fillOps } from "@/attributes/shape/fill/registry";
import type { FillResolved } from "@/attributes/shape/fill/union";
import { getTypographyPreset } from "@/attributes/shape/fill/color/parser";
import { strokeOps, type StrokeResolved } from "@/attributes/shape/stroke/stroke";
import { shadowOps, type ShadowResolved } from "@/attributes/shape/shadow/shadow";
import { lerpNumber } from "@/tween/lerp";
import type { ResolvedTextSpan, TextCase, TextShapingKey, TextSpan, TextStyle } from "./types";

/** Every key a {@link TextStyle} can set. */
export const TEXT_STYLE_KEYS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'letterSpacing', 'lineHeight', 'textAlign', 'fill', 'stroke', 'shadow',
] as const satisfies readonly (keyof TextStyle)[];

/**
 * The keys a drawn `text`/`richText` op can inherit. `fill`/`stroke`/`shadow` are
 * absent because in a `Graphics2D` they are group-scoped ops, not per-shape
 * slots: defaulting one would change which shapes the group's paint covers.
 */
export const TEXT_SHAPING_KEYS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'letterSpacing', 'lineHeight', 'textAlign',
] as const satisfies readonly TextShapingKey[];

/** A style that sets nothing. Frozen and shared, so the empty case allocates nothing. */
export const EMPTY_TEXT_STYLE: TextStyle = Object.freeze({});


/** The text attribute's operations beyond `resolve`/`lerp`. */
export interface TextOps {
    // ── Styles ─────────────────────────────────────────────────────────────
    /** A `theme.typography` preset (case-insensitive), or {@link EMPTY_TEXT_STYLE} when none is registered. */
    preset(name: string): TextStyle;
    /** The keys `over` sets, laid onto `base`. Returns `base` itself when `over` sets nothing. */
    mergeStyle(base: TextStyle, over: TextStyle | undefined): TextStyle;
    /** `style ?? previous` per field, paints resolved. Idempotent, like every mapper. */
    resolveStyle(style: TextStyle | undefined, previous: TextStyle): TextStyle;
    /**
     * Interpolate two font sizes. `'autofit'` is a mode, not a magnitude, so it
     * steps at the midpoint; two numbers interpolate. The rule {@link lerpStyle}
     * applies to its `fontSize`, for a node's own `fontSize` property to share.
     */
    lerpFontSize(a: number | "autofit" | undefined, b: number | "autofit" | undefined, t: number): number | "autofit" | undefined;
    /** Interpolate two resolved styles; categorical and one-sided fields step at the midpoint. */
    lerpStyle(from: TextStyle, to: TextStyle, t: number): TextStyle;
    /** A style as `Text` constructor props: unset keys dropped, the family falling back to the host's. */
    styleProps(style: TextStyle): Record<string, unknown>;

    // ── Spans ──────────────────────────────────────────────────────────────
    /** A span tree flattened against `base`: its text-bearing spans, in document order. */
    flatten(spans: readonly TextSpan[], base: Omit<ResolvedTextSpan, "text">): ResolvedTextSpan[];

    // ── Case ───────────────────────────────────────────────────────────────
    /**
     * `text` recased, **at its own length**: a character whose case mapping
     * would add characters (`ß` → `SS`) keeps its own form, because run offsets,
     * selections and caret slots all index the string as typed.
     */
    applyCase(text: string, textCase: TextCase): string;
}


export const textOps: AttributeOps<string, string> & TextOps = {
    // A string needs no normalization.
    resolve: (value) => value,
    lerp,

    preset,
    mergeStyle,
    resolveStyle,
    lerpStyle,
    lerpFontSize,
    styleProps,

    flatten,

    applyCase,
};


/**
 * Types and untypes: the common prefix and suffix hold still while `from`'s
 * differing middle shrinks away and `to`'s grows in.
 */
function lerp(from: string, to: string, t: number): string {
    if (t <= 0) return from;
    if (t >= 1) return to;

    let pre = 0;
    const maxPre = Math.min(from.length, to.length);
    while (pre < maxPre && from.charCodeAt(pre) === to.charCodeAt(pre)) pre++;

    let suf = 0;
    const maxSuf = Math.min(from.length - pre, to.length - pre);
    while (
        suf < maxSuf &&
        from.charCodeAt(from.length - 1 - suf) === to.charCodeAt(to.length - 1 - suf)
    ) suf++;

    const removeLen = from.length - pre - suf;
    const addLen = to.length - pre - suf;
    const totalLen = removeLen + addLen;
    if (totalLen === 0) return to;

    const prefix = from.substring(0, pre);
    const suffix = from.substring(from.length - suf);
    const split = removeLen / totalLen;

    if (t < split) {
        const localT = split === 0 ? 1 : t / split;
        const midLen = Math.round(removeLen * (1 - localT));
        return prefix + from.substring(pre, pre + midLen) + suffix;
    }
    const localT = split === 1 ? 1 : (t - split) / (1 - split);
    const midLen = Math.round(addLen * localT);
    return prefix + to.substring(pre, pre + midLen) + suffix;
}

// Read per call rather than cached, so a `setTheme` between frames needs no invalidation.
function preset(name: string): TextStyle {
    return (getTypographyPreset(name) as TextStyle | undefined) ?? EMPTY_TEXT_STYLE;
}

function mergeStyle(base: TextStyle, over: TextStyle | undefined): TextStyle {
    let out: Record<string, unknown> | null = null;
    for (const key of TEXT_STYLE_KEYS) {
        const value = over?.[key];
        if (value !== undefined) (out ??= { ...base })[key] = value;
    }
    return (out as TextStyle | null) ?? base;
}

function resolveStyle(style: TextStyle | undefined, previous: TextStyle): TextStyle {
    const s = style ?? {};
    return {
        fontFamily: s.fontFamily ?? previous.fontFamily,
        fontSize: s.fontSize ?? previous.fontSize,
        fontWeight: s.fontWeight ?? previous.fontWeight,
        fontStyle: s.fontStyle ?? previous.fontStyle,
        letterSpacing: s.letterSpacing ?? previous.letterSpacing,
        lineHeight: s.lineHeight ?? previous.lineHeight,
        textAlign: s.textAlign ?? previous.textAlign,
        fill: fillOps.resolve(s.fill ?? previous.fill ?? []),
        stroke: strokeOps.resolve(s.stroke ?? previous.stroke ?? []),
        shadow: shadowOps.resolve(s.shadow ?? previous.shadow ?? []),
    };
}

function lerpStyle(from: TextStyle, to: TextStyle, t: number): TextStyle {
    return {
        fontFamily: t < 0.5 ? from.fontFamily : to.fontFamily,
        fontSize: lerpFontSize(from.fontSize, to.fontSize, t),
        fontWeight: lerpOptionalNumber(from.fontWeight, to.fontWeight, t),
        fontStyle: t < 0.5 ? from.fontStyle : to.fontStyle,
        letterSpacing: lerpOptionalNumber(from.letterSpacing, to.letterSpacing, t),
        lineHeight: lerpOptionalNumber(from.lineHeight, to.lineHeight, t),
        textAlign: t < 0.5 ? from.textAlign : to.textAlign,
        fill: fillOps.lerp(from.fill as FillResolved[], to.fill as FillResolved[], t),
        stroke: strokeOps.lerp(from.stroke as StrokeResolved[], to.stroke as StrokeResolved[], t),
        shadow: shadowOps.lerp(from.shadow as ShadowResolved[], to.shadow as ShadowResolved[], t),
    };
}

// Spread onto a node, an `undefined` key is stored as a value rather than read as
// unset, so unset keys are dropped. The base is a fresh object per call because
// `mergeStyle` returns it as-is when `style` sets nothing, and a frozen
// `EMPTY_TEXT_STYLE` would then be handed out as props.
//
// `fontFamily` is dropped along with the rest rather than backfilled from
// `hostTextFamily()`. Writing it here turned the *component's* own theme into an
// author-set prop, and `applyTextDefaults` skips every key the props already
// carry — so a chart axis reached the renderer holding the host family, or `""`
// when no host had declared one, and the document's `<DefaultTextStyle>` and
// `theme.typography.default` never got a look in. Leaving it unset puts a
// component's text on the same cascade as an author's, with the host family
// where it belongs: last, in `requireFontFamily`.
function styleProps(style: TextStyle): Record<string, unknown> {
    return mergeStyle({}, style) as Record<string, unknown>;
}

function flatten(spans: readonly TextSpan[], base: Omit<ResolvedTextSpan, "text">): ResolvedTextSpan[] {
    const out: ResolvedTextSpan[] = [];
    const walk = (span: TextSpan, inherited: Omit<ResolvedTextSpan, "text">): void => {
        const merged = {
            fontFamily: span.fontFamily ?? inherited.fontFamily,
            fontSize: span.fontSize ?? inherited.fontSize,
            fontWeight: span.fontWeight ?? inherited.fontWeight,
            fontStyle: span.fontStyle ?? inherited.fontStyle,
            letterSpacing: span.letterSpacing ?? inherited.letterSpacing,
            fill: span.fill != null ? fillOps.resolve(span.fill) : inherited.fill,
            stroke: span.stroke != null ? strokeOps.resolve(span.stroke) : inherited.stroke,
        };
        if (span.text) out.push({ text: span.text, ...merged });
        for (const child of span.children ?? []) walk(child, merged);
    };
    for (const span of spans) walk(span, base);
    return out;
}

// A letter, digit or apostrophe continues a word, so `don't` and `3rd` keep
// their second halves as typed while `well-known` becomes `Well-Known`.
const WORD_CHAR = /[\p{L}\p{N}'\u2019]/u;

function applyCase(text: string, textCase: TextCase): string {
    if (textCase !== 'upper' && textCase !== 'lower' && textCase !== 'title') return text;
    let out = "";
    let prev = "";
    for (const ch of text) {
        const recase = textCase === 'upper' || (textCase === 'title' && !WORD_CHAR.test(prev));
        const mapped = textCase === 'lower' ? ch.toLowerCase() : recase ? ch.toUpperCase() : ch;
        out += mapped.length === ch.length ? mapped : ch;
        prev = ch;
    }
    return out;
}

// `"autofit"` is a mode, not a magnitude.
function lerpFontSize(
    a: number | "autofit" | undefined,
    b: number | "autofit" | undefined,
    t: number,
): number | "autofit" | undefined {
    if (typeof a === "number" && typeof b === "number") return lerpNumber(a, b, t);
    return t < 0.5 ? a : b;
}

// Defaulting the missing side to 0 would animate a weight down to nothing on its way to "unset".
function lerpOptionalNumber(a: number | undefined, b: number | undefined, t: number): number | undefined {
    if (a == null || b == null) return t < 0.5 ? a : b;
    return lerpNumber(a, b, t);
}
