import { EMPTY_TEXT_STYLE, TEXT_SHAPING_KEYS, textOps } from "@/attributes/text/ops";
import type { ResolvedTextSpan, TextShapingKey, TextStyle } from "@/attributes/text/types";
import { Graphics2D, type GraphicsOp, type GraphicsShapeOp } from "./graphics2d";

type TextOp = Extract<GraphicsShapeOp, { kind: "text" }>;
type RichTextOp = Extract<GraphicsShapeOp, { kind: "richText" }>;

/** The span-level half of {@link TEXT_SHAPING_KEYS}: a `richText` op carries typography per span, so defaults are filled span by span, except `lineHeight`/`textAlign`, which lay out the whole block and live on the op. */
const SPAN_KEYS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
] as const satisfies readonly TextShapingKey[];

/** The `richText` op's own layout keys — the ones that aren't per-span. */
const RICHTEXT_BLOCK_KEYS = [
    'lineHeight', 'textAlign',
] as const satisfies readonly TextShapingKey[];

/** `graphics` with `style` filled into every `text`/`richText` op that left a shaping field unset: the drawn-text half of `<DefaultTextStyle>`. A `Text` node inherits through the context channel at bind; a raw `Graphics2D` has no node to bind, so it inherits here at draw time from the scope it is drawn in. Called from `RenderContext2D.draw`, so custom `ctx.draw(...)`, offscreen rasterization and the precomp asset walk see the same resolved ops (an inherited font actually *loads*). A key is unset only when `undefined`: an op naming a value wins. Returns `graphics` itself when nothing changes. */
export function applyGraphicsTextDefaults(graphics: Graphics2D, style: TextStyle): Graphics2D {
    // Not gated on `style` alone: an op naming a `variant` has something to inherit even in a scope that sets nothing. The lazy copy below keeps the walk cheap.
    const ambient = hasShapingDefaults(style) ? style : EMPTY_TEXT_STYLE;

    const ops = graphics.ops();
    let next: GraphicsOp[] | null = null;
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op.kind !== "text" && op.kind !== "richText") continue;
        const effective = effectiveStyle(op.state.variant, ambient);
        if (!hasShapingDefaults(effective)) continue;
        const patched = op.kind === "text"
            ? patchText(op, effective)
            : patchRichText(op, effective);
        if (!patched) continue;
        // Copy lazily: an op list with nothing to fill in keeps its identity, so a fully specified Text node allocates nothing.
        if (!next) next = ops.slice();
        next[i] = patched;
    }
    return next ? graphics._withOps(next) : graphics;
}

/** The defaults one op inherits: its `variant`'s preset laid over the enclosing scope's (explicit beats variant beats inherited `<DefaultTextStyle>`). Merged here, not by the caller, because the ambient scope is per subtree while a variant is per op, so they can't be flattened before the walk. */
function effectiveStyle(variant: string | undefined, ambient: TextStyle): TextStyle {
    return textOps.mergeStyle(ambient, variant ? textOps.preset(variant) : undefined);
}

/** Does `style` set anything a drawn text op could inherit? */
function hasShapingDefaults(style: TextStyle): boolean {
    for (const key of TEXT_SHAPING_KEYS) {
        if (style[key] !== undefined) return true;
    }
    return false;
}

function patchText(op: TextOp, style: TextStyle): TextOp | null {
    const state = fillUnset(op.state, style, TEXT_SHAPING_KEYS);
    return state ? { kind: "text", state: state as TextOp["state"] } : null;
}

function patchRichText(op: RichTextOp, style: TextStyle): RichTextOp | null {
    let state = fillUnset(op.state, style, RICHTEXT_BLOCK_KEYS);
    const spans = patchSpans(op.state.spans, style);
    if (spans) state = { ...(state ?? op.state), spans };
    return state ? { kind: "richText", state: state as RichTextOp["state"] } : null;
}

/** The spans with defaults filled in, or `null` when none needed any. */
function patchSpans(
    spans: ResolvedTextSpan[] | undefined,
    style: TextStyle,
): ResolvedTextSpan[] | null {
    if (!spans || spans.length === 0) return null;
    // A span has no autofit mode (it is sized by its block), so an inherited `'autofit'` is skipped rather than written through as a bad number.
    const spanStyle = style.fontSize === "autofit" ? { ...style, fontSize: undefined } : style;
    let next: ResolvedTextSpan[] | null = null;
    for (let i = 0; i < spans.length; i++) {
        const patched = fillUnset(spans[i], spanStyle, SPAN_KEYS);
        if (patched) (next ??= spans.slice())[i] = patched as unknown as ResolvedTextSpan;
    }
    return next;
}

/** A copy of `target` with each of `keys` it leaves `undefined` taken from `style`, or `null` when none needed filling. */
function fillUnset(target: object, style: TextStyle, keys: readonly TextShapingKey[]): Record<string, unknown> | null {
    const current = target as Record<string, unknown>;
    let out: Record<string, unknown> | null = null;
    for (const key of keys) {
        if (current[key] !== undefined) continue;
        const value = style[key];
        if (value === undefined) continue;
        (out ??= { ...current })[key] = value;
    }
    return out;
}
