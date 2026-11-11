/** Two numbers a component needs that belong to none of them: written for the chart family but used well outside it (a graph rounds ticks with one, a diagram divides its entrance with the other), so keeping them there would make a non-chart package depend on charts. */

/** Round a raw step up to a tidy value (1/2/5 × 10ⁿ) so markers land round. */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return nice * mag
}

/** Divides an axis's staggered entrance so the whole thing fits inside `duration`. The ported components read `duration` as one marker's slide and then added stagger and a caption move, so `enter(0.8)` on five markers took ~2.2 s; an editor lays a command at its declared duration and sums those into the scene's length, so an overrun renders in the wrong place. The caption takes a fixed share off the top and the per-marker move is solved from what's left, given the stagger. */
export function enterBudget(
  duration: number,
  count: number,
  hasCaption: boolean,
  /** An explicit gap between markers; derived from `duration` when omitted. */
  stagger?: number
): { step: number; per: number; caption: number } {
  // The caption lands *after* the last marker, so it needs its own slice.
  const caption = hasCaption ? duration * 0.3 : 0
  const markers = Math.max(0, duration - caption)
  const gaps = Math.max(0, count - 1)

  if (stagger !== undefined) {
    // An explicit gap wins; the per-marker move takes whatever is left, and
    // can't go negative on an axis with more markers than budget.
    return {
      step: stagger,
      per: Math.max(0, markers - stagger * gaps),
      caption,
    }
  }
  // Default rhythm: each gap is a fifth of a marker's own move, which is the
  // ratio the original used — solved for here rather than assumed.
  const per = markers / (1 + gaps / 5)
  return { step: per / 5, per, caption }
}
