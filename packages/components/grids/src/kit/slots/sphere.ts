import { slot, type Slot, type SlotInput } from "./slot"

/** `outward` lays each item on the sphere's surface; `billboard` keeps every item facing the viewer. */
export const SPHERE_FACINGS = ["outward", "billboard"] as const
export type SphereFacing = (typeof SPHERE_FACINGS)[number]

export const SPHERE_AXES = ["x", "y", "z"] as const
export type SphereAxis = (typeof SPHERE_AXES)[number]

export interface SphereArrangement {
  kind: "sphere"
  radius: number
  /** Turn about the vertical axis, degrees — positive carries the front to the right. */
  yaw: number
  /** Turn about the horizontal axis, degrees — positive brings the top toward the viewer. */
  pitch: number
  /** Turn about the view axis, degrees clockwise. */
  roll: number
  facing: SphereFacing
  /** The camera's distance from the sphere's centre plane, px — smaller is more dramatic. */
  focalLength: number
  /** How much the back half fades, `0..1`. */
  depthFade: number
  /** Hide the items whose faces point away from the viewer. */
  cullBackfaces: boolean
  /** Degrees per second of yaw the sphere turns on its own. */
  spinSpeed: number
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const DEG = 180 / Math.PI

/** Point `k` of `count` on the unit sphere — a Fibonacci lattice, as even as `count` points get. */
export function fibonacciPoint(k: number, count: number): [number, number, number] {
  if (count <= 1) return [0, 0, 1]
  const y = 1 - (2 * (k + 0.5)) / count
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = k * GOLDEN_ANGLE
  return [Math.cos(theta) * r, y, Math.sin(theta) * r]
}

/** `p` turned by yaw, then pitch, then roll — y-up, z toward the viewer. */
export function orient(p: readonly [number, number, number], yaw: number, pitch: number, roll: number): [number, number, number] {
  const [x0, y0, z0] = p
  const ya = yaw / DEG, pa = pitch / DEG, ra = roll / DEG
  const x1 = x0 * Math.cos(ya) + z0 * Math.sin(ya)
  const z1 = -x0 * Math.sin(ya) + z0 * Math.cos(ya)
  const y2 = y0 * Math.cos(pa) - z1 * Math.sin(pa)
  const z2 = y0 * Math.sin(pa) + z1 * Math.cos(pa)
  return [x1 * Math.cos(ra) + y2 * Math.sin(ra), -x1 * Math.sin(ra) + y2 * Math.cos(ra), z2]
}

export function sphereSlots(arrangement: SphereArrangement, input: SlotInput): Slot[] {
  const { count } = input
  const radius = arrangement.radius
  const yaw = arrangement.yaw + arrangement.spinSpeed * input.time
  const outward = arrangement.facing === "outward"
  const slots: Slot[] = []
  for (let k = 0; k < count; k++) {
    const q = fibonacciPoint(k, count)
    const [nx, ny, nz] = orient(q, yaw, arrangement.pitch, arrangement.roll)
    const s = slot(nx * radius, ny * radius, {
      kind: "sphere",
      lat: Math.asin(Math.max(-1, Math.min(1, q[1]))) * DEG,
      lon: Math.atan2(q[2], q[0]) * DEG,
      depth: nz,
    })
    s.depth = nz * radius
    if (outward) {
      // The tilt whose `Rx · Ry` turns a face's normal onto the surface normal.
      s.rotationY = Math.asin(Math.max(-1, Math.min(1, nx))) * DEG
      s.rotationX = Math.atan2(ny, nz) * DEG
    }
    s.opacity = 1 - arrangement.depthFade * (1 - (nz + 1) / 2)
    if (outward && arrangement.cullBackfaces && facesAway(s, [nx, ny, nz], arrangement.focalLength)) s.opacity = 0
    slots.push(s)
  }
  return slots
}

/** Whether an outward face at `s` shows its back to a viewer `focal` px in front of the centre. */
function facesAway(s: Slot, normal: readonly [number, number, number], focal: number): boolean {
  if (focal <= 0) return normal[2] < 0
  return normal[0] * -s.x + normal[1] * -s.y + normal[2] * (focal - s.depth) < 0
}

/** The yaw and pitch that bring point `index` of `count` round to face the viewer. */
export function sphereFaceForward(count: number, index: number): { yaw: number; pitch: number } {
  const [x, y, z] = fibonacciPoint(index, count)
  return {
    yaw: -Math.atan2(x, z) * DEG,
    pitch: Math.atan2(y, Math.hypot(x, z)) * DEG,
  }
}
