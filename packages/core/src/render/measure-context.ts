import type { FontStyle } from "@/attributes/text/types";
import type { Size2D } from "@/attributes/layout/size";

/** Text measurement as a node sees it: how wide a run comes out is the shaper's property (in the backend), so every `measure`/`layout` pass is threaded one of these. `RenderContext2D` implements it, so a node measures through the object it paints with. Deliberately this small: glyph *positions* (an on-canvas caret) have a different audience (an editor), so they live on {@link RenderContext2D.layoutTextBlock}, which lets a host supply a measurer without being a renderer. */
export interface MeasureContext2D {
    /**
     * The size in pixels of `text` shaped at `fontSize` in the given face: advance width and the line box height the
     * shaper produced. Both dimensions, since rebuilding height from `fontSize × lineHeight` disagrees with the shaper
     * once a fallback face, different ascent/descent or taller glyphs are involved. `text` is measured as a single
     * unwrapped run (no `maxWidth`, no alignment); a block's real layout is `RenderContext2D.layoutTextBlock`.
     *
     * @param text          The string to measure.
     * @param fontSize      Size in pixels.
     * @param fontFamily    CSS-style family name (e.g. `"Inter"`).
     * @param fontWeight    Numeric weight (100–900). Defaults to 400 when omitted.
     * @param letterSpacing Extra inter-glyph spacing in pixels. Defaults to 0.
     * @param fontStyle     Italic / oblique variant. Defaults to normal.
     */
    measureText(
        text: string,
        fontSize: number,
        fontFamily: string,
        fontWeight?: number,
        letterSpacing?: number,
        fontStyle?: FontStyle,
    ): Size2D;
}
