import type { TextState } from "./descriptors/text";

/**
 * Where a laid-out run of text put its characters: what an editor needs to draw its own caret and selection over
 * rendered glyphs. **Space**: block-local canvas pixels, origin at the block's centre, **y down**, before the node's
 * transform (what the backend shapes into at origin `(0, 0)`); {@link nodeTextLayout} lifts it to viewport space.
 * **Carets, not glyph boxes**: a cursor lives between characters, so n characters have n + 1 positions, and a list of
 * glyph boxes leaves the run's start and end implicit and forces the host to reason about advances, kerning and
 * trailing whitespace.
 */

/** One laid-out line of a text block. */
export interface TextBlockLine {
    /** Character range this line covers, `[start, end)`, as offsets into the block's whole string; a hard line break belongs to neither line. */
    start: number;
    end: number;
    /** Top and bottom of the line box, block-local. */
    top: number;
    bottom: number;
    /** The x of every caret slot, block-local, in offset order: `carets[i]` is the slot at character `start + i`, so there are `end - start + 1` (one before each character plus one after the last). Left-to-right; bidirectional text isn't modelled in v1. */
    carets: number[];
}

/** A shaped text block: its lines and the size shaping produced. `width`/`height` are the block's own extent (what a hugging node measures to), not the box it may be aligned within. */
export interface TextBlockLayout {
    lines: TextBlockLine[];
    width: number;
    height: number;
}

/** The caret slot count a layout implies (one past the last character). Lines exclude their break, so summing slots would count breaks twice and lose the final position; read it off the last line. */
export function caretCount(layout: TextBlockLayout): number {
    const last = layout.lines[layout.lines.length - 1];
    return last ? last.end + 1 : 1;
}

/** Something that can report where a shaped text block put its characters. Narrower than {@link RenderContext2D}: `nodeTextLayout` needs only this call, and typing against the whole context would make a caret measurement look like it needs a renderer rather than a shaper. */
export interface TextBlockSource {
    layoutTextBlock(state: Partial<TextState>): TextBlockLayout | null;
}

/** Narrows `value` to a {@link TextBlockSource}, or `null` when it can't report glyph positions. A capability check, not a cast: a {@link MeasureContext2D} answers how *wide* text is, but where each character *landed* needs a shaper that keeps line boxes; a host without one should get "no caret model", not a crash. */
export function asTextBlockSource(value: unknown): TextBlockSource | null {
    return typeof (value as TextBlockSource | null)?.layoutTextBlock === "function"
        ? value as TextBlockSource
        : null;
}
