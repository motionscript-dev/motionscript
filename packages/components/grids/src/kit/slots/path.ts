import { pathOps, type PathData, type PathSampler } from "@motionscript/sdk"

import { slot, type Slot, type SlotInput } from "./slot"

/** `distribute` spreads the items over the path; `fixed` sets them a distance apart. */
export const PATH_SPACINGS = ["distribute", "fixed"] as const
export type PathSpacing = (typeof PATH_SPACINGS)[number]

/** How path coordinates land in the grid's frame: `origin` of the path goes to `(x, y)`, turned and scaled. */
export interface PathPlacement {
  originX: number
  originY: number
  /** The path is y-down, as SVG and the editor write one. */
  flipY?: boolean
  x: number
  y: number
  /** Degrees clockwise. */
  rotation: number
  scale: number
}

export interface PathArrangement {
  kind: "path"
  /** y-up, like every path in the library, unless its placement says otherwise. */
  path: PathData
  placement: PathPlacement
  spacing: PathSpacing
  /** Pixels between items when `spacing` is `fixed`. */
  spacingDistance: number
  /** Share of the path the items are moved along; wraps on a closed path. */
  offset: number
  /** Share of the path per second the items travel on their own. */
  flowSpeed: number
  trimStart: number
  trimEnd: number
  /** Turn each item to follow the path's direction. */
  alignToPath: boolean
}

const SAMPLERS = new Map<PathData, { sampler: PathSampler; closed: boolean }>()
const SAMPLER_CACHE = 32

/** A sampler for `path`, kept while the same value keeps arriving — a path is re-read every frame. */
function measured(path: PathData): { sampler: PathSampler; closed: boolean } {
  const hit = SAMPLERS.get(path)
  if (hit) return hit
  const contours = pathOps.contours(path)
  const entry = {
    sampler: pathOps.sampler(path),
    closed: contours.length === 1 && contours[0].closed,
  }
  if (SAMPLERS.size >= SAMPLER_CACHE) SAMPLERS.delete(SAMPLERS.keys().next().value!)
  SAMPLERS.set(path, entry)
  return entry
}

/**
 * Items at even arc-length steps — by distance along the curve rather than the
 * path's own parameter, which bunches them up wherever a curve is tight.
 *
 * On a closed path used whole, `n` items take `n` equal steps and `offset`
 * wraps round, so an animated offset is a loop. Anywhere else the ends are
 * ends: `n` items take `n - 1` steps so both get one, and an item moved past
 * either is hidden rather than piled on it.
 */
export function pathSlots(arrangement: PathArrangement, input: SlotInput): Slot[] {
  const { count } = input
  if (count === 0) return []
  const { sampler, closed } = measured(arrangement.path)
  const length = sampler.length
  const a = clamp01(Math.min(arrangement.trimStart, arrangement.trimEnd))
  const b = clamp01(Math.max(arrangement.trimStart, arrangement.trimEnd))
  const start = a * length
  const span = (b - a) * length
  const loops = closed && a === 0 && b === 1
  const offset = arrangement.offset + arrangement.flowSpeed * input.time
  const place = arrangement.placement
  const rad = (place.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const slots: Slot[] = []
  for (let k = 0; k < count; k++) {
    let u: number
    if (arrangement.spacing === "fixed" && span > 0) {
      u = offset + (k * arrangement.spacingDistance) / span
    } else if (loops) {
      u = offset + k / count
    } else {
      u = offset + (count === 1 ? 0.5 : k / (count - 1))
    }
    let visible = true
    if (loops) u = u - Math.floor(u)
    else if (u < -1e-9 || u > 1 + 1e-9) visible = false
    const at = sampler.frameAt(start + clamp01(u) * span)
    if (!at) {
      const s = slot(0, 0, { kind: "path", t: clamp01(u) })
      s.opacity = 0
      slots.push(s)
      continue
    }
    // Into the grid's frame: about the path's origin, turned clockwise (y-up).
    const flip = place.flipY ? -1 : 1
    const px = (at.x - place.originX) * place.scale
    const py = (at.y - place.originY) * place.scale * flip
    const s = slot(
      place.x + px * cos + py * sin,
      place.y - px * sin + py * cos,
      { kind: "path", t: clamp01(u) },
    )
    if (arrangement.alignToPath) s.rotation = (-Math.atan2(at.ty * flip, at.tx) * 180) / Math.PI + place.rotation
    if (!visible) s.opacity = 0
    slots.push(s)
  }
  return slots
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
