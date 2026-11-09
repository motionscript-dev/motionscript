import type { FillResolved, Loader, ShadowResolved, StrokeResolved } from "@motionscript/sdk"

/** Paints a chart part holds in entries of its own, which no paint entry loads for it. */
export interface PartPaints {
  readonly fills?: readonly (readonly FillResolved[])[]
  readonly strokes?: readonly (readonly StrokeResolved[])[]
  readonly shadows?: readonly (readonly ShadowResolved[])[]
}

/** Declare `paints` from a component's `load`. */
export function loadPaints(loader: Loader, paints: PartPaints): void {
  for (const fill of paints.fills ?? []) loader.fill(fill)
  for (const strokes of paints.strokes ?? []) for (const stroke of strokes) loader.fill(stroke.fill)
  for (const shadows of paints.shadows ?? []) for (const shadow of shadows) loader.fill(shadow.fill)
}
