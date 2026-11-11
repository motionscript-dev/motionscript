import { shuffled } from "./random"
import type { Slot } from "./slots"

/** The first five work on any grid; the rest follow one arrangement's geometry and fall back to item order where it has none. */
export const STAGGER_ORDERS = [
  "index",
  "reverse",
  "random",
  "centerOut",
  "edgesIn",
  "row",
  "column",
  "angle",
  "path",
  "depth",
] as const
export type StaggerOrder = (typeof STAGGER_ORDERS)[number]

/** The most of a command's length the offsets may take; the rest is each item's own motion. */
const MAX_STAGGER = 0.95

/**
 * Each item's start, `0..1`, as a share of the stagger: `0` goes first, `1`
 * last, and items that tie go together — a ring revealed `centerOut` from its
 * centre appears all at once, which is what that means.
 */
export function staggerRanks(order: StaggerOrder, slots: readonly Slot[], seed: number): number[] {
  const n = slots.length
  const keys = keysOf(order, slots, seed)
  let min = Infinity
  let max = -Infinity
  for (const key of keys) {
    if (key < min) min = key
    if (key > max) max = key
  }
  const range = max - min
  if (!(range > 1e-9)) return new Array<number>(n).fill(0)
  return keys.map((key) => (key - min) / range)
}

/** Each item runs the same length, starting `rank · stagger` in; the stagger lives inside the command's duration. */
export function staggerProgress(rank: number, t: number, stagger: number): number {
  const s = Math.max(0, Math.min(MAX_STAGGER, stagger))
  const p = s === 0 ? t : (t - rank * s) / (1 - s)
  return p < 0 ? 0 : p > 1 ? 1 : p
}

function keysOf(order: StaggerOrder, slots: readonly Slot[], seed: number): number[] {
  switch (order) {
    case "reverse":
      return slots.map((_, i) => -i)
    case "random": {
      const sequence = shuffled(slots.map((_, i) => i), seed)
      const keys = new Array<number>(slots.length)
      sequence.forEach((item, rank) => {
        keys[item] = rank
      })
      return keys
    }
    case "centerOut":
      return slots.map((s) => Math.round(Math.hypot(s.x, s.y, s.depth) * 1000) / 1000)
    case "edgesIn":
      return slots.map((s) => -Math.round(Math.hypot(s.x, s.y, s.depth) * 1000) / 1000)
    case "row":
      return slots.map((s) => (s.meta.kind === "rectangular" ? s.meta.row : -Math.round(s.y)))
    case "column":
      return slots.map((s) => (s.meta.kind === "rectangular" ? s.meta.column : Math.round(s.x)))
    case "angle":
      return slots.map((s, i) =>
        s.meta.kind === "radial" ? s.meta.angle : s.meta.kind === "rectangular" || s.meta.kind === "sphere" ? clockAngle(s) : i
      )
    case "path":
      return slots.map((s, i) => (s.meta.kind === "path" ? s.meta.t : i))
    case "depth":
      return slots.map((s, i) => (s.meta.kind === "sphere" ? -s.meta.depth : i))
    default:
      return slots.map((_, i) => i)
  }
}

/** Degrees clockwise from twelve o'clock to where `s` sits. */
function clockAngle(s: Slot): number {
  const angle = (Math.atan2(s.x, s.y) * 180) / Math.PI
  return angle < 0 ? angle + 360 : angle
}
