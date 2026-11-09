/**
 * The family a component's text falls back to when the document names none.
 *
 * A node that draws a caption of its own — a button's label, a window's title —
 * has to put *some* family on it, because the renderer's font provider holds
 * only what the manifest registered and a family called `""` shapes against
 * nothing and paints no glyphs. Which family that is, though, is a fact about
 * the application: which fonts it vendored, which it licensed, what its UI is
 * set in. A component shipped as its own package cannot know it, and the engine
 * has no built-in family to offer in its place.
 *
 * So the answer is *supplied*, once, by the host application's composition
 * root, through {@link setHostTextFamily}. Until a host does, the answer is
 * `""`, and a host that ships a typeface says so instead of every node learning
 * its name.
 *
 * This is deliberately **not** a prop. The prop is the node's own `fontFamily`,
 * which a host's props mapping can fill in from here when the author has left
 * it empty. What lives here is only the answer to "empty means what?", which is
 * one answer for the whole application rather than one per node.
 */

let fallbackFamily = ""

/**
 * Declares the family this application's components fall back to.
 *
 * Called by the composition root before the first build. Left unset, components
 * fall back to `""`, which paints no glyphs — a legible blank rather than a
 * silently wrong typeface, and the same bargain an unregistered node type makes.
 */
export function setHostTextFamily(family: string): void {
  fallbackFamily = family
}

/** The family to use where the document names none. */
export function hostTextFamily(): string {
  return fallbackFamily
}
