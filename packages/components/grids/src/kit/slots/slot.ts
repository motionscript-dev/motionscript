import type { Size2D } from "@motionscript/sdk"

/**
 * One place in an arrangement, in the grid's own frame: centred on it, y-up,
 * `depth` toward the viewer.
 *
 * Pure data, and the whole of what an arrangement produces — which is what lets
 * a morph blend any two of them item by item, whatever shapes they came from.
 */
export interface Slot {
  x: number
  y: number
  depth: number
  /** Degrees clockwise. */
  rotation: number
  /** Tilt, degrees, as a node's own `rotationX`/`rotationY`. */
  rotationX: number
  rotationY: number
  scale: number
  opacity: number
  meta: SlotMeta
}

/** What kind of place a slot is — the orderings a stagger can follow. */
export type SlotMeta =
  | { kind: "rectangular"; row: number; column: number }
  /** Degrees clockwise from the arrangement's first slot. */
  | { kind: "radial"; angle: number }
  /** `0..1` along the part of the path in use. */
  | { kind: "path"; t: number }
  /** `depth` is `-1` at the back of the sphere and `1` at the front. */
  | { kind: "sphere"; lat: number; lon: number; depth: number }

/** What an arrangement is laid out for. */
export interface SlotInput {
  count: number
  /** Each item's measured size, in item order. */
  sizes: readonly Size2D[]
  /** The grid's content box. */
  box: Size2D
  /** Clip seconds, for arrangements that move on their own. */
  time: number
}

export function slot(x: number, y: number, meta: SlotMeta): Slot {
  return { x, y, depth: 0, rotation: 0, rotationX: 0, rotationY: 0, scale: 1, opacity: 1, meta }
}

/** `a` toward `b`. The meta switches halfway, since an ordering cannot be half one thing. */
export function blendSlot(a: Slot, b: Slot, t: number): Slot {
  if (t <= 0) return a
  if (t >= 1) return b
  const mix = (p: number, q: number) => p + (q - p) * t
  return {
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    depth: mix(a.depth, b.depth),
    rotation: mix(a.rotation, b.rotation),
    rotationX: mix(a.rotationX, b.rotationX),
    rotationY: mix(a.rotationY, b.rotationY),
    scale: mix(a.scale, b.scale),
    opacity: mix(a.opacity, b.opacity),
    meta: t < 0.5 ? a.meta : b.meta,
  }
}

/** Push `s` away from (or pull it toward) the grid's centre. */
export function spreadSlot(s: Slot, spread: number): Slot {
  if (spread === 1) return s
  return { ...s, x: s.x * spread, y: s.y * spread, depth: s.depth * spread }
}

/** Largest width and height among `sizes`. */
export function largest(sizes: readonly Size2D[]): Size2D {
  let width = 0
  let height = 0
  for (const size of sizes) {
    if (size.width > width) width = size.width
    if (size.height > height) height = size.height
  }
  return { width, height }
}
