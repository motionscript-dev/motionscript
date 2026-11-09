import type { Size2D } from "@/attributes/layout/size";
import type { ShadowResolved } from "@/attributes/shape/shadow/shadow";
import type { StrokeResolved } from "@/attributes/shape/stroke/stroke";
import type { Node2D } from "@/components/trees/2d/node2d";
import {
    declareGlyphAssets, declareRichAssets, measureGlyphs, measureRich, richState, textState,
    type RichValues, type TextSource, type TextValues,
} from "@/components/builtins/text/text-layout";
import type { TextState } from "@/render/descriptors/text";
import { Graphics2D } from "@/render/graphics2d";
import type { Loader, Measurer, RenderContext2D } from "@/components/factory/api";
import { currentPass, internalsOf, markDecided } from "@/components/factory/views";

/**
 * Glyphs: measured, drawn and loaded by the shared functions in `components/builtins/text/text-layout.ts`.
 * `source` is where the string comes from: a `text` entry, a formatted number.
 */

export type { TextSource, TextValues, RichValues };

type Painted = { readonly shadow: unknown; readonly fill: unknown; readonly stroke: unknown };

/** The block's own size, which a filling text still reports, so a hugging ancestor sees its content. */
export function measure(measurer: Measurer, s: TextValues, source: TextSource): Size2D {
    const { node, scope } = currentPass();
    markDecided(node);
    return measureGlyphs(s, source, { maxWidth: measurer.max.width, maxHeight: measurer.max.height }, scope);
}

const drawn = new WeakMap<Node2D, { readonly s: TextValues; readonly source: TextSource }>();

/** The glyphs, shadow and fill, then the children, then the stroke. A styled piece paints itself, so the node's own paint steps aside. */
export function draw(ctx: RenderContext2D, s: TextValues & Painted, source: TextSource): void {
    const c = internalsOf(ctx);
    drawn.set(c.host, { s, source });
    if (c.probing) return;
    const out = c.target();
    const state = textState(s, source, c.host.layoutBounds);
    const segmented = state.segments != null;
    c.inFront(() => {
        const g = new Graphics2D().text(state).shadow(s.shadow as ShadowResolved[]);
        if (!segmented) g.fill(s.fill as never);
        out.draw(g);
    });
    ctx.children();
    c.inFront(() => {
        const stroke = s.stroke as StrokeResolved[];
        if (stroke.length === 0 || segmented) return;
        out.draw(new Graphics2D().text(state).stroke(stroke));
    });
}

export function load(loader: Loader, s: TextValues, source: TextSource): void {
    declareGlyphAssets(s, source, loader);
}

/** What a node drew its glyphs as, for a host's caret geometry. `null` for a node that draws none. */
export function textStateOf(node: Node2D): Partial<TextState> | null {
    const last = drawn.get(node);
    return last ? textState(last.s, last.source, node.layoutBounds) : null;
}

export function measureRichText(measurer: Measurer, s: RichValues): Size2D {
    const { scope } = currentPass();
    return measureRich(s, { maxWidth: measurer.max.width, maxHeight: measurer.max.height }, scope);
}

export function drawRichText(ctx: RenderContext2D, s: RichValues): void {
    const c = internalsOf(ctx);
    if (c.probing) return;
    const out = c.target();
    c.inFront(() => out.draw(new Graphics2D().richText(richState(s, c.host.layoutBounds))));
    ctx.children();
}

export function loadRichText(loader: Loader, s: RichValues): void {
    declareRichAssets(s, loader);
}
