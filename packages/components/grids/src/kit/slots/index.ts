import { pathSlots, type PathArrangement } from "./path"
import { radialSlots, type RadialArrangement } from "./radial"
import { rectangularSlots, type RectangularArrangement } from "./rectangular"
import type { Slot, SlotInput } from "./slot"
import { sphereSlots, type SphereArrangement } from "./sphere"

export * from "./slot"
export * from "./rectangular"
export * from "./radial"
export * from "./path"
export * from "./path-templates"
export * from "./sphere"

/**
 * Everything an arrangement needs to place items, as plain data — so a
 * transition can keep the one it is leaving, and a grid can borrow another's.
 */
export type Arrangement = RectangularArrangement | RadialArrangement | PathArrangement | SphereArrangement

export type ArrangementKind = Arrangement["kind"]

/** Where each of `input.count` items sits under `arrangement`, in slot order. */
export function slotsOf(arrangement: Arrangement, input: SlotInput): Slot[] {
  switch (arrangement.kind) {
    case "rectangular":
      return rectangularSlots(arrangement, input)
    case "radial":
      return radialSlots(arrangement, input)
    case "path":
      return pathSlots(arrangement, input)
    case "sphere":
      return sphereSlots(arrangement, input)
  }
}

/** The camera distance an arrangement is seen through, or `0` when it is flat. */
export function focalLengthOf(arrangement: Arrangement): number {
  return arrangement.kind === "sphere" ? Math.max(1, arrangement.focalLength) : 0
}
