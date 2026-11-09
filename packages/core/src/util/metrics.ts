/**
 * Two numbers a component ends up needing, neither of which belongs to any one
 * of them.
 *
 * Both were written for the chart family and are used well outside it — a
 * graph's plane rounds its ticks with one, a diagram divides its entrance with
 * the other. Leaving them there would make a package with nothing to do with
 * charts depend on charts for a page of arithmetic.
 */

/** Round a raw step up to a tidy value (1/2/5 × 10ⁿ) so markers land round. */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return nice * mag
}

/**
 * How an axis's staggered entrance is divided up, so the whole thing fits inside
 * `duration` instead of running past it.
 *
 * The standalone components this family was ported from read `duration` as *one
 * marker's* slide, and then added the stagger between them and a full-length
 * caption move on the end — so `enter(0.8)` on a five-marker axis actually took
 * about 2.2 seconds. That's fine when a scene is a hand-written script whose
 * beats are whatever they turn out to be. It is not fine here: an editor lays a
 * command out on the timeline at the duration it declares, times its parallel
 * siblings against it, and sums those durations into the scene's length. A
 * generator that overruns is a command that renders in the wrong place.
 *
 * So the budget runs the other way: the caption takes a fixed share off the top,
 * and the markers' per-move duration is solved for from what's left, given the
 * stagger. Same shape of animation, honest arithmetic.
 */
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
