/**
 * The family a component's text falls back to when the document names none. A caption a node draws itself (a button's
 * label, a window's title) needs *some* family: the font provider holds only what the manifest registered, and a family
 * called `""` shapes against nothing and paints no glyphs. Which one is a fact about the application (fonts vendored
 * or licensed), so the host's composition root *supplies* it once through {@link setHostTextFamily}; until then it is `""`.
 *
 * Deliberately **not** a prop: the prop is the node's own `fontFamily`, which a host's props mapping can fill from
 * here when left empty. This is only the answer to "empty means what?", one for the whole application.
 */

let fallbackFamily = ""

/** Declares the family this application's components fall back to; called by the composition root before the first build. Unset it is `""`, which paints no glyphs: a legible blank rather than a silently wrong typeface (the bargain an unregistered node type makes). */
export function setHostTextFamily(family: string): void {
  fallbackFamily = family
}

/** The family to use where the document names none. */
export function hostTextFamily(): string {
  return fallbackFamily
}
