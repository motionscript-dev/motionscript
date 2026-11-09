import { slot, type Slot, type SlotInput } from "./slot"

export const RADIAL_DIRECTIONS = ["clockwise", "counterclockwise"] as const
export type RadialDirection = (typeof RADIAL_DIRECTIONS)[number]

export interface RadialArrangement {
  kind: "radial"
  radius: number
  /** Where the first item sits, degrees clockwise from twelve o'clock. */
  startAngle: number
  /** How much of the circle the items span, degrees. */
  sweep: number
  direction: RadialDirection
  /** Turn each item so its top faces away from the centre. */
  rotateItems: boolean
  /** Degrees per second the ring turns on its own. */
  spinSpeed: number
}

/**
 * The angle of each of `count` slots, clockwise from twelve o'clock. A full
 * circle divides by the count, so the last item does not land on the first; an
 * arc divides by one less, so both ends get an item. In between the divisor
 * slides from one to the other as the arc closes — steeply, so an arc is an arc
 * until it is nearly whole, and a sweep animated to 360 lands without a jump.
 */
export function radialAngles(arrangement: RadialArrangement, count: number, time: number): number[] {
  const sweep = arrangement.sweep
  const closing = Math.min(1, Math.abs(sweep) / 360) ** 8
  const step = count <= 1 ? 0 : sweep / (count - 1 + closing)
  const sign = arrangement.direction === "counterclockwise" ? -1 : 1
  const start = arrangement.startAngle + arrangement.spinSpeed * time
  const angles: number[] = []
  for (let k = 0; k < count; k++) angles.push(start + sign * k * step)
  return angles
}

export function radialSlots(arrangement: RadialArrangement, input: SlotInput): Slot[] {
  const angles = radialAngles(arrangement, input.count, input.time)
  const start = angles[0] ?? 0
  return angles.map((angle) => {
    const rad = (angle * Math.PI) / 180
    const s = slot(arrangement.radius * Math.sin(rad), arrangement.radius * Math.cos(rad), {
      kind: "radial",
      angle: Math.abs(angle - start),
    })
    if (arrangement.rotateItems) s.rotation = angle
    return s
  })
}

/** The change to `startAngle` that brings slot `index` to twelve o'clock by the shorter way round. */
export function radialTurnToTop(arrangement: RadialArrangement, count: number, index: number): number {
  const angle = radialAngles({ ...arrangement, spinSpeed: 0 }, count, 0)[index] ?? arrangement.startAngle
  return -wrapDegrees(angle)
}

/** `degrees` folded into `(-180, 180]`. */
export function wrapDegrees(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}
