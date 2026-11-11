import { Types, easeOut, type EasingFunction, type Piece, type Timeline } from "@motionscript/sdk"

const identity: EasingFunction = (t) => t

/** Any component's timeline: these helpers only build pieces, which every timeline builds alike. */
export type AnyTimeline = Timeline<any, any>

/** How far a legend starts below its slot when `enter` brings it in, in px. */
export const LEGEND_SLIDE = 20

/** Marker count when an axis states no ticks. */
export const DEFAULT_MARKERS = 5

/** How a cartesian `enter` splits its duration: axes arriving, marks drawing, legend coming up. Sums to 1. */
export const ENTER_SHARE = { axes: 0.35, marks: 0.5, legend: 0.15 } as const

/**
 * The ease a part's own frames apply to `t`: none when its command was given
 * one, which already eases every frame the command builds, and otherwise the
 * ease-out every chart command defaults to.
 */
export function frameEase(timeline: { readonly easing: EasingFunction | undefined }): EasingFunction {
  return timeline.easing ? identity : easeOut()
}

/** A piece of a command placed at its own time: from `at` seconds, for `duration` seconds. */
export interface Beat {
  readonly at: number
  readonly duration: number
  readonly piece: Piece
}

/**
 * `beats` at their own offsets over the command, each eased on its own and held
 * at its last frame once it is done. A beat ahead of the playhead writes nothing,
 * so whatever stands before it is written by a piece ahead of these. Beats that
 * run past the command are played faster to end with it.
 */
export function beats(timeline: AnyTimeline, parts: readonly Beat[]): Piece {
  const total = timeline.duration
  const natural = parts.reduce((end, part) => Math.max(end, part.at + part.duration), 0)
  const k = natural > total && natural > 0 ? total / natural : 1
  return timeline.together(
    parts.map(({ at, duration, piece }) => {
      const start = at * k
      const length = duration * k
      return timeline.sequence([timeline.wait(start), piece, timeline.wait(Math.max(0, total - start - length))])
    })
  )
}

/** How far one piece of a staggered entrance has come: its opacity, and how far it still sits off its place. */
export interface Arrival {
  readonly opacity: number
  readonly shift: number
}

/** Each piece's arrival, by key. An unlisted piece has landed. */
export type Arrivals = Readonly<Record<string, Arrival>>

const LANDED: Arrival = { opacity: 1, shift: 0 }

/**
 * A part's private record of its pieces' arrivals. A write merges into it, so
 * beats placed apart each write their own piece and leave the others as the
 * frame left them.
 */
export function arrivalsEntry() {
  return Types.custom<Arrivals>({}, { private: true, resolve: (next: Arrivals, previous?: Arrivals) => ({ ...previous, ...next }) })
}

export function arrivalOf(arrivals: Arrivals, key: string | number): Arrival {
  return arrivals[key] ?? LANDED
}

/** Every piece in `keys` armed at `from`: the first frame of their entrance. */
export function armed(keys: readonly (string | number)[], from: Arrival): Arrivals {
  const record: Record<string, Arrival> = {}
  for (const key of keys) record[key] = from
  return record
}

/**
 * A piece arriving from `from` over its beat: a part armed at `from` tweened to
 * `{ opacity: 1, [axis]: 0 }`, eased by `ease`.
 */
export function arrival(timeline: AnyTimeline, key: string | number, from: Arrival, ease: EasingFunction): Piece {
  return timeline.animate((t) => {
    const e = ease(t)
    return {
      arrivals: {
        [key]: {
          opacity: from.opacity + (LANDED.opacity - from.opacity) * e,
          shift: from.shift + (LANDED.shift - from.shift) * e,
        },
      },
    }
  })
}
