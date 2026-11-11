import {
  Geo,
  Graphics3D,
  Mat,
  Tex,
  Types,
  component3d,
  type Geometry3D,
  type Material3D,
  type Transform3D,
} from "@motionscript/sdk"

type Rgba = [number, number, number, number]
type Resource = "wood" | "brick" | "sheep" | "wheat" | "ore" | "desert"
type Trade = "any" | Exclude<Resource, "desert">
interface Tile {
  resource: Resource
  number: number
}

// The beginner board, row by row from the far edge (3, 4, 5, 4 and 3 tiles).
const TILES: Tile[] = [
  { resource: "ore", number: 10 },
  { resource: "sheep", number: 2 },
  { resource: "wood", number: 9 },
  { resource: "wheat", number: 12 },
  { resource: "brick", number: 6 },
  { resource: "sheep", number: 4 },
  { resource: "brick", number: 10 },
  { resource: "wheat", number: 9 },
  { resource: "wood", number: 11 },
  { resource: "desert", number: 0 },
  { resource: "wood", number: 3 },
  { resource: "ore", number: 8 },
  { resource: "wood", number: 8 },
  { resource: "ore", number: 3 },
  { resource: "wheat", number: 4 },
  { resource: "sheep", number: 5 },
  { resource: "brick", number: 5 },
  { resource: "wheat", number: 6 },
  { resource: "sheep", number: 11 },
]

// Clockwise from the far left.
const PORTS: Trade[] = ["any", "sheep", "any", "ore", "wheat", "any", "brick", "any", "wood"]

const SQ3 = Math.sqrt(3)
const TILE_R = 0.95
const TILE_H = 0.26
// The water is a narrow channel: harbors stand on the rim, as on the printed frame.
const SEA_R = 5.35
const TRAY_H = 0.55
const RIM_T = 0.36
// The tray's walls are flush with the rim's outside, so the top never overhangs them.
const TRAY_R = SEA_R + RIM_T + 0.02
const PORT_OUT = 0.6
const SIGN_R = 0.382
const RIM = Geo.torus({ radius: SEA_R, thickness: RIM_T, segments: [12, 6] })

const RAMP = Tex.data([60, 60, 60, 255, 165, 165, 165, 255, 255, 255, 255, 255], 3, 1, {
  magFilter: "nearest",
  minFilter: "nearest",
  colorSpace: "linear",
})

function toon(color: Rgba): Material3D {
  const opacity = color[3]
  return { type: "toon", color: [color[0], color[1], color[2], 1], gradientMap: RAMP, shading: "flat", ...(opacity < 1 ? { opacity, transparent: true } : {}) } as Material3D
}

function flat(color: Rgba): Material3D {
  const opacity = color[3]
  return Mat.basic({ color: [color[0], color[1], color[2], 1], ...(opacity < 1 ? { opacity, transparent: true } : {}) })
}

/**
 * Draw order among see-through things. The ground's strokes go first; then a depth-only copy of every fading solid,
 * so a fading part shows only its nearest surface, as one piece (no hidden edges or inner faces through it); then
 * the fading surfaces; then their ink, and the lettering last, so no surface blends over it.
 */
const ORDER = { ground: -2, hide: -1, ink: 1, print: 2 } as const
const HIDE = Mat.basic({ color: [0, 0, 0, 1], opacity: 0, transparent: true, depthWrite: true })

/** A solid in `color`; below full opacity it fades as one piece rather than showing what is behind its front. */
function solid(g: Graphics3D, geometry: Geometry3D, color: Rgba, transform?: Transform3D, material: (color: Rgba) => Material3D = toon): void {
  if (color[3] <= 0.002) return
  if (color[3] < 1) g.mesh(geometry, HIDE, { ...transform, renderOrder: ORDER.hide })
  g.mesh(geometry, material(color), transform)
}


// A photo of open water as 256 x 256 grey levels, laid faintly over the sea.
const WATER_PHOTO = ""
const WATER_SIZE = 256

const waters = new Map<number, ReturnType<typeof Tex.data>>()

/** The photo as a multiplier near white: `strength` 0 leaves the sea's colour alone. */
function waterMap(strength: number): ReturnType<typeof Tex.data> | null {
  if (WATER_PHOTO === "" || !(strength > 0)) return null
  const key = Math.round(Math.min(1, strength) * 20) / 20
  let hit = waters.get(key)
  if (!hit) {
    const grey = atob(WATER_PHOTO)
    const data = new Uint8Array(WATER_SIZE * WATER_SIZE * 4)
    for (let i = 0; i < WATER_SIZE * WATER_SIZE; i++) {
      const v = Math.round(255 * (1 - key * (1 - grey.charCodeAt(i) / 255)))
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    hit = Tex.data(data, WATER_SIZE, WATER_SIZE, { colorSpace: "linear", wrapS: "mirror", wrapT: "mirror", repeat: [2, 2] })
    waters.set(key, hit)
  }
  return hit
}

function water(color: Rgba, strength: number): Material3D {
  const map = waterMap(strength)
  if (!map) return toon(color)
  // Brightened by what the photo takes away on average, so the sea keeps its colour.
  const k = Math.min(1 / (1 - strength * 0.5), 1 / Math.max(color[0], color[1], color[2], 0.01))
  const lift: Rgba = [color[0] * k, color[1] * k, color[2] * k, 1]
  return { type: "toon", color: lift, map, gradientMap: RAMP } as Material3D
}

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3]]
}

const SHADE: Rgba = [0.16, 0.15, 0.32, 1]

// --- Board layout ------------------------------------------------------------

interface Cell {
  q: number
  r: number
  x: number
  z: number
}

const CELLS: Cell[] = (() => {
  const out: Cell[] = []
  for (let r = -2; r <= 2; r++) {
    for (let q = Math.max(-2, -2 - r); q <= Math.min(2, 2 - r); q++) {
      out.push({ q, r, x: SQ3 * (q + r / 2), z: 1.5 * r })
    }
  }
  return out
})()

const DIRS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
]

interface Harbor {
  x: number
  z: number
  angle: number
  ends: [number, number][]
}

// The coast's edges in clockwise order, and nine of them spread evenly as harbors.
const HARBORS: Harbor[] = (() => {
  const onBoard = new Set(CELLS.map((c) => `${c.q},${c.r}`))
  const edges: Harbor[] = []
  for (const cell of CELLS) {
    DIRS.forEach(([dq, dr], k) => {
      if (onBoard.has(`${cell.q + dq},${cell.r + dr}`)) return
      const angle = k * 60
      const rad = (angle * Math.PI) / 180
      const ends: [number, number][] = [angle - 30, angle + 30].map((a) => {
        const v = (a * Math.PI) / 180
        return [cell.x + Math.cos(v), cell.z - Math.sin(v)]
      })
      const mid = SQ3 / 2
      edges.push({ x: cell.x + Math.cos(rad) * mid, z: cell.z - Math.sin(rad) * mid, angle, ends })
    })
  }
  const around = (e: Harbor) => {
    const a = (Math.atan2(-e.z, e.x) * 180) / Math.PI
    return (((150 - a) % 360) + 360) % 360
  }
  edges.sort((a, b) => around(a) - around(b))
  return Array.from({ length: 9 }, (_, k) => edges[Math.round(k * (edges.length / 9))]!)
})()

/** The platform: a flat-topped hexagon with corners this far out, standing this tall, its top ruled with tile-sized cells. */
const FRAME_R = 6.3
const PLATFORM_H = 1.2

/** The platform's corners on the ground, x and z, counter-clockwise from +x. */
const FRAME: [number, number][] = Array.from({ length: 6 }, (_, k) => {
  const a = (k * Math.PI) / 3
  return [Math.cos(a) * FRAME_R, -Math.sin(a) * FRAME_R]
})

/** `p`..`q` cut to the platform's top, or null when it lies wholly off it. */
function clipToFrame(p: [number, number], q: [number, number]): [[number, number], [number, number]] | null {
  let t0 = 0
  let t1 = 1
  const d = [q[0] - p[0], q[1] - p[1]] as const
  for (let k = 0; k < 6; k++) {
    const a = FRAME[k]!
    const b = FRAME[(k + 1) % 6]!
    const n = [a[1] - b[1], b[0] - a[0]] as const
    // Inside is the side the centre is on.
    const side = Math.sign(n[0] * -a[0] + n[1] * -a[1])
    const num = side * (n[0] * (p[0] - a[0]) + n[1] * (p[1] - a[1]))
    const den = side * (n[0] * d[0] + n[1] * d[1])
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return null
      continue
    }
    const t = -num / den
    if (den > 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 >= t1) return null
  }
  return [
    [p[0] + d[0] * t0, p[1] + d[1] * t0],
    [p[0] + d[0] * t1, p[1] + d[1] * t1],
  ]
}

type Seg = [[number, number], [number, number]]

/** Every edge of a hex lattice of corner radius `size`, each once, kept where `keep` says. */
function lattice(size: number, reach: number, keep: (p: [number, number], q: [number, number]) => boolean): Seg[] {
  const seen = new Set<string>()
  const out: Seg[] = []
  const key = (v: [number, number]) => `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)}`
  const n = Math.ceil(reach / (size * 1.5)) + 2
  for (let r = -n; r <= n; r++) {
    for (let q = -n * 2; q <= n * 2; q++) {
      const cx = SQ3 * size * (q + r / 2)
      const cz = 1.5 * size * r
      if (Math.hypot(cx, cz) > reach + size * 2) continue
      for (let k = 0; k < 6; k++) {
        const corner = (j: number): [number, number] => {
          const a = ((30 + 60 * j) * Math.PI) / 180
          return [cx + Math.cos(a) * size, cz - Math.sin(a) * size]
        }
        const p = corner(k)
        const q2 = corner(k + 1)
        // A shared edge is one stroke: drawn twice it would read heavier than the rest.
        const id = [key(p), key(q2)].sort().join("|")
        if (seen.has(id) || !keep(p, q2)) continue
        seen.add(id)
        out.push([p, q2])
      }
    }
  }
  return out
}

/** Flat strokes on the ground as one mesh: a quad per segment, uploaded once. */
function strokes(segs: Seg[], w: number, y: number): Geometry3D {
  const position: number[] = []
  const normal: number[] = []
  for (const [p, q] of segs) {
    const dx = q[0] - p[0]
    const dz = q[1] - p[1]
    const l = Math.hypot(dx, dz)
    const nx = (-dz / l) * (w / 2)
    const nz = (dx / l) * (w / 2)
    const a = [p[0] + nx, y, p[1] + nz]
    const b = [q[0] + nx, y, q[1] + nz]
    const c2 = [q[0] - nx, y, q[1] - nz]
    const d = [p[0] - nx, y, p[1] - nz]
    // Both windings, so the strokes show from above whichever way a segment runs.
    position.push(...a, ...b, ...c2, ...a, ...c2, ...d, ...a, ...c2, ...b, ...a, ...d, ...c2)
    for (let i = 0; i < 12; i++) normal.push(0, 1, 0)
  }
  return Geo.buffer({ position: new Float32Array(position), normal: new Float32Array(normal), staticData: true })
}

/** The tile-sized grid ruled on the platform's top, cut at its edge. */
const GRID = strokes(
  lattice(1, FRAME_R + 1, () => true).flatMap((seg) => {
    const cut = clipToFrame(seg[0], seg[1])
    return cut ? [cut] : []
  }),
  0.014,
  0.002
)

/** The platform's top edge, a touch inside it so the stroke stays on the top. */
const RIM_STROKES = strokes(
  FRAME.map((a, k): Seg => {
    const b = FRAME[(k + 1) % 6]!
    const inset = (v: [number, number]): [number, number] => [v[0] * 0.995, v[1] * 0.995]
    return [inset(a), inset(b)]
  }),
  0.03,
  0.003
)
/** The platform's corners and foot, as strips lying on its sides drawn like the top edge. */
const SIDE_STROKES = (() => {
  const position: number[] = []
  const normal: number[] = []
  const w = 0.03
  const out = 0.003
  FRAME.forEach((a, k) => {
    const b = FRAME[(k + 1) % 6]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
    const mid = Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    const n = [(a[0] + b[0]) / 2 / mid, (a[1] + b[1]) / 2 / mid]
    // A point on this side, `along` from corner `a`, at height `y`, a hair proud of the face.
    const at = (along: number, y: number) => [a[0] + u[0]! * along + n[0]! * out, y, a[1] + u[1]! * along + n[1]! * out]
    const strip = (s0: number, s1: number, y0: number, y1: number) => {
      const p = at(s0, y0)
      const q = at(s1, y0)
      const r = at(s1, y1)
      const t = at(s0, y1)
      position.push(...p, ...q, ...r, ...p, ...r, ...t, ...p, ...r, ...q, ...p, ...t, ...r)
      for (let i = 0; i < 12; i++) normal.push(n[0]!, 0, n[1]!)
    }
    // Half a corner line on each side meeting there, and the foot along the bottom.
    strip(0, w / 2, -PLATFORM_H, 0)
    strip(len - w / 2, len, -PLATFORM_H, 0)
    strip(0, len, -PLATFORM_H, -PLATFORM_H + w)
  })
  return Geo.buffer({ position: new Float32Array(position), normal: new Float32Array(normal), staticData: true })
})()
const PLATFORM = Geo.cylinder({ radius: FRAME_R, height: PLATFORM_H, segments: [6, 1] })

function pipsOf(n: number): number {
  return 6 - Math.abs(7 - n)
}

// --- Scenery -----------------------------------------------------------------

/** A small deterministic jitter, so no two tiles repeat their scenery exactly. */
function jitter(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

interface Palette {
  ground: Rgba
  a: Rgba
  b: Rgba
  c: Rgba
}

function scenery(g: Graphics3D, resource: Resource, p: Palette, at: [number, number, number], seed: number, grow = 1): void {
  const [cx, cy, cz] = at
  const slot = (k: number, radius = 0.6) => {
    const a = ((30 + 60 * k + (jitter(seed + k) - 0.5) * 16) * Math.PI) / 180
    const d = radius + (jitter(seed * 3 + k) - 0.5) * 0.08
    return [cx + Math.cos(a) * d, cz - Math.sin(a) * d] as const
  }
  // Scaled about the tile's centre, so the scenery grows in with the tile under it.
  const mesh = (geometry: Geometry3D, color: Rgba, x: number, y: number, z: number, rotation?: [number, number, number], scale?: [number, number, number]) =>
    solid(g, geometry, color, {
      position: [cx + (x - cx) * grow, cy + y * grow, cz + (z - cz) * grow],
      rotation,
      scale: scale ? [scale[0] * grow, scale[1] * grow, scale[2] * grow] : grow === 1 ? undefined : [grow, grow, grow],
    })

  switch (resource) {
    case "wood":
      for (let k = 0; k < 6; k++) {
        const [x, z] = slot(k)
        const s = 0.85 + jitter(seed + k * 7) * 0.3
        const leaf = k % 2 === 0 ? p.a : p.b
        mesh(Geo.cylinder({ radius: 0.035 * s, height: 0.1 * s, segments: [5, 1] }), p.c, x, 0.05 * s, z)
        mesh(Geo.cone({ radius: 0.19 * s, height: 0.3 * s, segments: [6, 1] }), leaf, x, (0.1 + 0.15) * s, z, [0, k * 17, 0])
        mesh(Geo.cone({ radius: 0.14 * s, height: 0.24 * s, segments: [6, 1] }), leaf, x, (0.24 + 0.12) * s, z, [0, k * 17 + 30, 0])
      }
      break
    case "brick":
      for (let k = 0; k < 6; k++) {
        const [x, z] = slot(k)
        const turn = jitter(seed + k) * 60
        if (k % 2 === 0) {
          mesh(Geo.sphere({ radius: 0.2, segments: [7, 4] }), p.b, x, 0, z, [0, turn, 0], [1, 0.6, 1])
        } else {
          const brick = Geo.box({ width: 0.17, height: 0.075, depth: 0.09 })
          mesh(brick, p.a, x - 0.05, 0.04, z, [0, turn, 0])
          mesh(brick, p.c, x + 0.06, 0.04, z + 0.03, [0, turn, 0])
          mesh(brick, p.a, x + 0.005, 0.115, z + 0.01, [0, turn + 10, 0])
        }
      }
      break
    case "sheep":
      for (let k = 0; k < 6; k++) {
        const [x, z] = slot(k)
        const turn = jitter(seed + k) * 360
        if (k % 2 === 0) {
          const rad = (turn * Math.PI) / 180
          mesh(Geo.icosahedron({ radius: 0.12 }), p.a, x, 0.13, z, [0, turn, 0], [1.25, 0.9, 1])
          mesh(Geo.icosahedron({ radius: 0.06 }), p.c, x + Math.cos(rad) * 0.15, 0.17, z - Math.sin(rad) * 0.15, [0, turn, 0])
          for (const [lx, lz] of [[-0.07, -0.04], [0.07, -0.04], [-0.07, 0.04], [0.07, 0.04]] as const) {
            const c = Math.cos(rad), s = Math.sin(rad)
            mesh(Geo.cylinder({ radius: 0.02, height: 0.08, segments: [4, 1] }), p.c, x + lx * c + lz * s, 0.04, z - lx * s + lz * c)
          }
        } else {
          mesh(Geo.icosahedron({ radius: 0.11 }), p.b, x, 0.07, z, [0, turn, 0], [1, 0.8, 1])
        }
      }
      break
    case "wheat":
      for (let k = 0; k < 6; k++) {
        const [x, z] = slot(k)
        for (let i = 0; i < 3; i++) {
          const a = (i * 120 + k * 40) * (Math.PI / 180)
          const sx = x + Math.cos(a) * 0.06
          const sz = z - Math.sin(a) * 0.06
          const h = 0.16 + jitter(seed + k * 3 + i) * 0.06
          mesh(Geo.cylinder({ radius: 0.016, height: h, segments: [4, 1] }), p.c, sx, h / 2, sz)
          mesh(Geo.capsule({ radius: 0.04, height: 0.09, segments: [2, 6] }), i === 1 ? p.b : p.a, sx, h + 0.05, sz)
        }
      }
      break
    case "ore":
      for (let k = 0; k < 6; k++) {
        const [x, z] = slot(k, k % 2 === 0 ? 0.56 : 0.64)
        const turn = jitter(seed + k) * 72
        if (k % 2 === 0) {
          const s = 0.9 + jitter(seed + k * 5) * 0.3
          mesh(Geo.cone({ radius: 0.27 * s, height: 0.46 * s, segments: [5, 1] }), p.a, x, 0.23 * s, z, [0, turn, 0])
          mesh(Geo.cone({ radius: 0.14 * s, height: 0.22 * s, segments: [5, 1] }), p.c, x, 0.355 * s, z, [0, turn, 0])
        } else {
          mesh(Geo.dodecahedron({ radius: 0.09 }), p.b, x, 0.05, z, [turn, turn, 0])
        }
      }
      break
    case "desert": {
      for (let k = 0; k < 3; k++) {
        const [x, z] = slot(k * 2 + 1, 0.5)
        mesh(Geo.sphere({ radius: 0.26, segments: [8, 4] }), p.b, x, 0, z, [0, k * 40, 0], [1.2, 0.4, 0.8])
      }
      for (let k = 0; k < 3; k++) {
        const [x, z] = slot(k * 2, 0.55)
        mesh(Geo.capsule({ radius: 0.05, height: 0.22, segments: [3, 6] }), p.a, x, 0.16, z)
        mesh(Geo.capsule({ radius: 0.035, height: 0.08, segments: [3, 6] }), p.a, x + 0.08, 0.18, z, [0, 0, 0])
        mesh(Geo.capsule({ radius: 0.035, height: 0.06, segments: [3, 6] }), p.a, x - 0.08, 0.13, z)
      }
      break
    }
  }
}

// --- Drawn edges -----------------------------------------------------------------

type Look = "cad" | "ink" | "sketch" | "flat"
type V3 = [number, number, number]

const BAR = Geo.box({ width: 1, height: 1, depth: 1 })

function wobble(seed: number): number {
  const v = Math.sin(seed * 91.7 + 47.3) * 43758.5453
  return v - Math.floor(v) - 0.5
}

/** A bar from `p` to `q`, `w` thick, running `extend` past each end. */
function bar(p: V3, q: V3, w: number, extend: number): Transform3D {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const dz = q[2] - p[2]
  const len = Math.hypot(dx, dy, dz) || 1e-6
  const d = [dx / len, dy / len, dz / len]
  let quaternion = { x: 0, y: 1, z: 0, w: 0 }
  if (d[0]! > -0.9999) {
    const l = Math.hypot(d[2]!, d[1]!, 1 + d[0]!)
    quaternion = { x: 0, y: -d[2]! / l, z: d[1]! / l, w: (1 + d[0]!) / l }
  }
  return { position: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], quaternion, scale: [len + extend * 2, w, w] }
}

/** Collects a frame's drawn edges, as ink or as pen strokes, into one draw per colour. */
class Pen {
  readonly strokes = new Map<string, { color: Rgba; order: number; bars: Transform3D[] }>()
  private n = 0
  constructor(readonly look: Look, readonly width: number) {}
  /** `always` draws it whatever the look: a line that is part of the picture, not an outline. */
  line(p: V3, q: V3, color: Rgba, weight = 1, always = false): void {
    if (this.look === "flat" && !always) return
    const set = this.group(color, ORDER.ink)
    const w = this.width * weight
    if (this.look !== "sketch") {
      set.bars.push(bar(p, q, w, w / 2))
      return
    }
    const i = this.n++
    const j = (k: number): V3 => [wobble(i * 7 + k) * w * 0.7, wobble(i * 11 + k) * w * 0.7, wobble(i * 13 + k) * w * 0.7]
    const a = j(1)
    const b = j(2)
    set.bars.push(bar([p[0] + a[0], p[1] + a[1], p[2] + a[2]], [q[0] + b[0], q[1] + b[1], q[2] + b[2]], w * (0.75 + (wobble(i * 29) + 0.5) * 0.6), w * (1.6 + (wobble(i * 31) + 0.5) * 1.8)))
  }
  /** The edges of an n-sided prism from `y0` to `y1`, corners `r` out, the first at `start` degrees from +z. */
  prism(cx: number, cz: number, y0: number, y1: number, r: number, n: number, start: number, color: Rgba, sides = true, weight = 1): void {
    const at = (k: number, y: number): V3 => {
      const a = ((start + (k * 360) / n) * Math.PI) / 180
      return [cx + r * Math.sin(a), y, cz + r * Math.cos(a)]
    }
    for (let k = 0; k < n; k++) {
      this.line(at(k, y1), at(k + 1, y1), color, weight)
      if (y0 !== y1) this.line(at(k, y0), at(k + 1, y0), color, weight)
      if (sides) this.line(at(k, y0), at(k, y1), color, weight)
    }
  }
  /** The twelve edges of a box `len` x `h` x `d` centred on `c`, turned `yaw` degrees about y. */
  box(c: V3, len: number, h: number, d: number, yaw: number, color: Rgba): void {
    const r = (yaw * Math.PI) / 180
    const pt = (x: number, y: number, z: number): V3 => [c[0] + x * Math.cos(r) + z * Math.sin(r), c[1] + y, c[2] - x * Math.sin(r) + z * Math.cos(r)]
    const xs = [-len / 2, len / 2]
    const ys = [-h / 2, h / 2]
    const zs = [-d / 2, d / 2]
    for (const y of ys) for (const z of zs) this.line(pt(xs[0]!, y, z), pt(xs[1]!, y, z), color)
    for (const x of xs) for (const z of zs) this.line(pt(x, ys[0]!, z), pt(x, ys[1]!, z), color)
    for (const x of xs) for (const y of ys) this.line(pt(x, y, zs[0]!), pt(x, y, zs[1]!), color)
  }
  /** Lettering lying flat on a face, `w` wide and barely raised: drawn whatever the look. */
  print(strokes: [V3, V3][], color: Rgba, w: number): void {
    if (color[3] < 0.02) return
    const set = this.group(color, ORDER.print)
    for (const [p, q] of strokes) {
      const t = bar(p, q, w, w / 2)
      set.bars.push({ ...t, scale: [(t.scale as V3)[0], 0.004, w] })
    }
  }
  draw(g: Graphics3D): void {
    for (const { color, order, bars } of this.strokes.values()) g.instances(BAR, flat(color), bars, { transform: { renderOrder: order } })
  }
  private group(color: Rgba, order: number): { color: Rgba; order: number; bars: Transform3D[] } {
    const key = `${order}|${color.join()}`
    let set = this.strokes.get(key)
    if (!set) this.strokes.set(key, (set = { color, order, bars: [] }))
    return set
  }
}

// --- Lettering ------------------------------------------------------------------------

// A single-stroke drafting hand for the few characters a board and its pieces
// print: each glyph is polylines in a box 0.6 wide and 1 tall. Lettering is
// geometry rather than a texture, so nothing here depends on how a renderer
// numbers a frame's images.
const GLYPHS: Record<string, [number, number][][]> = {
  "0": [[[0.15, 0], [0.45, 0], [0.6, 0.15], [0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.85], [0, 0.15], [0.15, 0]]],
  "1": [[[0.12, 0.78], [0.36, 1], [0.36, 0]], [[0.12, 0], [0.58, 0]]],
  "2": [[[0, 0.82], [0.15, 1], [0.45, 1], [0.6, 0.85], [0.6, 0.62], [0, 0], [0.6, 0]]],
  "3": [[[0, 0.85], [0.15, 1], [0.45, 1], [0.6, 0.85], [0.6, 0.65], [0.45, 0.52], [0.2, 0.52]], [[0.45, 0.52], [0.6, 0.38], [0.6, 0.15], [0.45, 0], [0.15, 0], [0, 0.15]]],
  "4": [[[0.45, 0], [0.45, 1], [0, 0.3], [0.62, 0.3]]],
  "5": [[[0.6, 1], [0.05, 1], [0, 0.56], [0.42, 0.6], [0.6, 0.45], [0.6, 0.15], [0.45, 0], [0.15, 0], [0, 0.15]]],
  "6": [[[0.55, 0.9], [0.4, 1], [0.2, 1], [0, 0.75], [0, 0.15], [0.15, 0], [0.45, 0], [0.6, 0.15], [0.6, 0.42], [0.45, 0.56], [0.15, 0.56], [0, 0.42]]],
  "7": [[[0, 1], [0.6, 1], [0.2, 0]]],
  "8": [[[0.15, 0.52], [0, 0.66], [0, 0.86], [0.15, 1], [0.45, 1], [0.6, 0.86], [0.6, 0.66], [0.45, 0.52], [0.15, 0.52], [0, 0.36], [0, 0.15], [0.15, 0], [0.45, 0], [0.6, 0.15], [0.6, 0.36], [0.45, 0.52]]],
  "9": [[[0.05, 0.1], [0.2, 0], [0.4, 0], [0.6, 0.25], [0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.85], [0, 0.58], [0.15, 0.44], [0.45, 0.44], [0.6, 0.58]]],
  ":": [[[0.3, 0.2], [0.3, 0.3]], [[0.3, 0.7], [0.3, 0.8]]],
  "?": [[[0, 0.78], [0.15, 0.97], [0.45, 0.97], [0.6, 0.8], [0.6, 0.62], [0.3, 0.42], [0.3, 0.24]], [[0.3, 0.02], [0.3, 0.1]]],
  ".": [[[0.3, 0], [0.3, 0.08]]],
}

/**
 * `text` as strokes, `height` tall and centred on the origin of its own plane;
 * `place` carries a point of that plane (x right, y up) into the scene.
 */
function letter(text: string, height: number, place: (x: number, y: number) => V3): [V3, V3][] {
  const advance = (ch: string) => (ch === ":" || ch === "." ? 0.5 : 0.82)
  const width = [...text].reduce((w, ch) => w + advance(ch), 0) - 0.22
  const out: [V3, V3][] = []
  let x = -width / 2
  for (const ch of text) {
    const w = ch === ":" || ch === "." ? -0.05 : 0
    for (const line of GLYPHS[ch] ?? []) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = line[i]!
        const [bx, by] = line[i + 1]!
        out.push([place((x + w + ax) * height, (ay - 0.5) * height), place((x + w + bx) * height, (by - 0.5) * height)])
      }
    }
    x += advance(ch)
  }
  return out
}

/** What each trade's sign shows, as strokes in a box about 1 square: a tree, a brick wall, a sheep, wheat, a peak. */
const PICTOGRAMS: Record<Exclude<Trade, "any">, [number, number][][]> = {
  wood: [
    [[0.5, 1], [0.24, 0.66], [0.76, 0.66], [0.5, 1]],
    [[0.5, 0.82], [0.16, 0.34], [0.84, 0.34], [0.5, 0.82]],
    [[0.5, 0.34], [0.5, 0.06]],
  ],
  brick: [
    [[0.05, 0.12], [0.95, 0.12], [0.95, 0.88], [0.05, 0.88], [0.05, 0.12]],
    [[0.05, 0.37], [0.95, 0.37]],
    [[0.05, 0.63], [0.95, 0.63]],
    [[0.5, 0.12], [0.5, 0.37]],
    [[0.28, 0.37], [0.28, 0.63]],
    [[0.72, 0.37], [0.72, 0.63]],
    [[0.5, 0.63], [0.5, 0.88]],
  ],
  sheep: [
    [[0.14, 0.42], [0.08, 0.56], [0.16, 0.72], [0.34, 0.78], [0.54, 0.75], [0.68, 0.62], [0.66, 0.45], [0.5, 0.36], [0.24, 0.36], [0.14, 0.42]],
    [[0.66, 0.6], [0.84, 0.7], [0.94, 0.6], [0.84, 0.5], [0.67, 0.52]],
    [[0.26, 0.36], [0.26, 0.12]],
    [[0.5, 0.36], [0.5, 0.12]],
  ],
  wheat: [
    [[0.5, 0.02], [0.5, 0.98]],
    [[0.5, 0.36], [0.3, 0.5]],
    [[0.5, 0.36], [0.7, 0.5]],
    [[0.5, 0.56], [0.3, 0.7]],
    [[0.5, 0.56], [0.7, 0.7]],
    [[0.5, 0.76], [0.33, 0.88]],
    [[0.5, 0.76], [0.67, 0.88]],
  ],
  ore: [
    [[0.02, 0.1], [0.38, 0.86], [0.56, 0.5], [0.7, 0.66], [0.98, 0.1], [0.02, 0.1]],
    [[0.24, 0.55], [0.38, 0.62], [0.48, 0.54]],
  ],
}

/** A trade's pictogram, `size` across and centred on the origin of its plane, carried into the scene by `place`. */
function pictogram(trade: Exclude<Trade, "any">, size: number, place: (x: number, y: number) => V3): [V3, V3][] {
  const out: [V3, V3][] = []
  for (const line of PICTOGRAMS[trade]) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i]!
      const [bx, by] = line[i + 1]!
      out.push([place((ax - 0.5) * size, (ay - 0.5) * size), place((bx - 0.5) * size, (by - 0.5) * size)])
    }
  }
  return out
}

// --- The component -----------------------------------------------------------

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((v) => s.has(v))
}

export default component3d({
  key: "hexBoard",
  state: {
    tiles: Types.custom<Tile[]>(TILES, { kind: "vector", animatable: false }),
    ports: Types.custom<Trade[]>(PORTS, { kind: "vector", animatable: false }),
    built: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    spotTiles: Types.custom<number[]>([], { kind: "vector", animatable: false }),
    spotPorts: Types.custom<number[]>([], { kind: "vector", animatable: false }),
    spotlit: Types.number(0, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    woodColor: Types.color("#4A9E62"),
    brickColor: Types.color("#D9714F"),
    sheepColor: Types.color("#ABCF63"),
    wheatColor: Types.color("#EEC453"),
    oreColor: Types.color("#8D98B5"),
    desertColor: Types.color("#E6D3A8"),
    seaColor: Types.color("#2696D2"),
    waterTexture: Types.number(0.25, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    frameColor: Types.color("#F7E3B5"),
    tokenColor: Types.color("#FFF8EA"),
    inkColor: Types.color("#2E2A3A"),
    hotColor: Types.color("#EF4B5B"),
    lineColor: Types.color("#2E2A3A"),
    look: Types.oneOf(["cad", "ink", "sketch", "flat"] as const, { animatable: false }),
    /** What the island stands on: a drawn hex grid of open sea, or a tray of water. */
    frame: Types.oneOf(["grid", "tray"] as const, { animatable: false }),
    gridColor: Types.color("#2E2A3A"),
    platformColor: Types.color("#2A2E36"),
  },
  commands: {
    assemble: {
      args: {},
      entrance: true,
      run: (timeline) => timeline.animate((t) => ({ built: t }), { eased: false }),
    },
    spotlight: {
      args: {
        tiles: Types.custom<number[]>([], { kind: "vector" }),
        ports: Types.custom<number[]>([], { kind: "vector" }),
      },
      run: (timeline, state) => {
        const { tiles, ports } = timeline.args
        const from = state.spotlit
        if (from < 0.001 || (sameSet(tiles, state.spotTiles) && sameSet(ports, state.spotPorts))) {
          return timeline.animate((t) => ({ spotTiles: tiles, spotPorts: ports, spotlit: from + (1 - from) * t }))
        }
        return timeline.animate((t) =>
          t < 0.5
            ? { spotTiles: state.spotTiles, spotPorts: state.spotPorts, spotlit: from * (1 - 2 * t) }
            : { spotTiles: tiles, spotPorts: ports, spotlit: 2 * t - 1 }
        )
      },
    },
    clearSpotlight: (timeline) => timeline.tween({ spotlit: 0 }),
  },
  render: (ctx, s) => {
    const g = new Graphics3D()
    const c = (v: unknown) => v as Rgba
    const line = c(s.lineColor)
    const look = s.look as Look
    const cad = look === "cad"
    const pen = new Pen(look, cad ? 0.012 : 0.028)
    // A drawing's fills are quiet, so its lines carry it.
    const quiet = (color: Rgba): Rgba => (cad ? mix(color, [0.93, 0.92, 0.88, 1], 0.2) : color)
    const lit = clamp01(s.spotlit)
    const shown = new Set(s.spotTiles)
    const shownPorts = new Set(s.spotPorts)
    const dimOf = (on: boolean) => (on ? 0 : lit)
    // Out of the spotlight a part fades: its colour stays, its opacity drops.
    const shade = (color: Rgba, dim: number): Rgba => (dim > 0 ? [color[0], color[1], color[2], color[3] * (1 - 0.88 * dim)] : color)
    // Lettering on a faded part goes altogether: half-read figures are noise.
    const print = (color: Rgba, dim: number): Rgba => [color[0], color[1], color[2], color[3] * (1 - dim)]

    const grid = s.frame !== "tray"
    if (grid) {
      // A raised hexagonal platform, its top ruled with tile-sized cells and edged with a fine line.
      const ink = c(s.gridColor)
      g.mesh(PLATFORM, toon(c(s.platformColor)), { position: [0, -PLATFORM_H / 2, 0], rotation: [0, 30, 0] })
      const under = { renderOrder: ORDER.ground }
      g.mesh(GRID, flat([ink[0], ink[1], ink[2], 0.22]), under)
      g.mesh(RIM_STROKES, flat([ink[0], ink[1], ink[2], 0.55]), under)
      g.mesh(SIDE_STROKES, flat([ink[0], ink[1], ink[2], 0.55]), under)
    } else {
      // A thick tray, its water, and a soft rim that bulges in over the water's edge.
      const seaDim = lit * 0.6
      const frame = shade(c(s.frameColor), seaDim)
      const flat: [number, number, number] = [0, 30, 0]
      g.mesh(Geo.cylinder({ radius: TRAY_R, height: TRAY_H, segments: [6, 1] }), toon(mix(frame, SHADE, 0.12)), { position: [0, -TRAY_H / 2 - 0.04, 0], rotation: flat })
      pen.prism(0, 0, -TRAY_H - 0.04, -0.04, TRAY_R, 6, 90, line, true, 1.3)
      const sea = shade(c(s.seaColor), seaDim)
      g.mesh(Geo.cylinder({ radius: SEA_R + 0.1, height: 0.08, segments: [6, 1] }), water(sea, s.waterTexture), { position: [0, -0.04, 0], rotation: flat })
      g.mesh(RIM, toon(frame), { position: [0, 0.02, 0], rotation: [-90, 0, 0], scale: [1, 1, 0.62] })
      pen.prism(0, 0, 0.0, 0.0, SEA_R - RIM_T * 0.92, 6, 90, line, false)
    }

    const raw: Record<Resource, Palette> = {
      wood: { ground: c(s.woodColor), a: [0.13, 0.55, 0.3, 1], b: [0.2, 0.66, 0.32, 1], c: [0.55, 0.33, 0.2, 1] },
      brick: { ground: c(s.brickColor), a: [0.85, 0.32, 0.2, 1], b: [0.95, 0.6, 0.36, 1], c: [0.72, 0.24, 0.17, 1] },
      sheep: { ground: c(s.sheepColor), a: [1, 1, 1, 1], b: [0.45, 0.76, 0.3, 1], c: [0.24, 0.22, 0.3, 1] },
      wheat: { ground: c(s.wheatColor), a: [1, 0.9, 0.45, 1], b: [0.95, 0.68, 0.2, 1], c: [0.82, 0.6, 0.2, 1] },
      ore: { ground: c(s.oreColor), a: [0.5, 0.56, 0.7, 1], b: [0.42, 0.46, 0.58, 1], c: [0.97, 0.98, 1, 1] },
      desert: { ground: c(s.desertColor), a: [0.36, 0.72, 0.4, 1], b: [0.93, 0.8, 0.52, 1], c: [0.4, 0.38, 0.5, 1] },
    }
    const palettes = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, { ground: quiet(v.ground), a: quiet(v.a), b: quiet(v.b), c: quiet(v.c) }])
    ) as Record<Resource, Palette>
    // Printed figures: fine in a drawing, bold on a painted board.
    const stroke = cad ? 0.026 : 0.034

    const built = clamp01(s.built)
    // A part settling on fades in as it slides down this far onto its place.
    const SLIDE = 0.45
    const fadeIn = (color: Rgba, k: number): Rgba => [color[0], color[1], color[2], color[3] * k]
    const tiles = s.tiles as readonly Tile[]
    CELLS.forEach((cell, i) => {
      const tile = tiles[i]
      if (!tile) return
      const token = tile.resource !== "desert" && tile.number > 1
      // Tiles and their scenery grow in place from the centre outward; then their numbers settle on.
      const ring = Math.max(Math.abs(cell.q), Math.abs(cell.r), Math.abs(cell.q + cell.r))
      const order = ring === 0 ? 0 : ring === 1 ? 1 + i / 19 : 2 + i / 19
      const grow = easeOut(clamp01((built - (order / 3.2) * 0.36) / 0.16))
      if (grow <= 0) return
      const settle = easeOut(clamp01((built - 0.42 - (order / 3.2) * 0.22) / 0.16))
      const slide = (1 - settle) * SLIDE
      const on = shown.has(i + 1)
      const lift = on ? 0.32 * easeOut(lit) : 0
      const dim = dimOf(on)
      const h = (TILE_H + lift) * grow
      const p = palettes[tile.resource] ?? palettes.desert
      const pal: Palette = { ground: shade(p.ground, dim), a: shade(p.a, dim), b: shade(p.b, dim), c: shade(p.c, dim) }

      solid(g, Geo.cylinder({ radius: TILE_R, height: TILE_H + lift, segments: [6, 1] }), pal.ground, { position: [cell.x, h / 2, cell.z], scale: [grow, grow, grow] })
      pen.prism(cell.x, cell.z, 0, h, TILE_R * grow, 6, 0, shade(line, dim))
      scenery(g, tile.resource, pal, [cell.x, h, cell.z], i + 1, grow)

      if (token && settle > 0) {
        const ty = h + slide
        const paper = fadeIn(shade(c(s.tokenColor), dim), settle)
        solid(g, Geo.cylinder({ radius: 0.34, height: 0.06, segments: [28, 1] }), paper, { position: [cell.x, ty + 0.03, cell.z] })
        pen.prism(cell.x, cell.z, ty, ty + 0.06, 0.34, 20, 0, fadeIn(shade(line, dim), settle), false, 0.7)
        // The number and its pips, printed on the token's face; a 6 or an 8 in red.
        const ink = fadeIn(print(tile.number === 6 || tile.number === 8 ? c(s.hotColor) : c(s.inkColor), dim), settle)
        const top = ty + 0.066
        pen.print(letter(String(tile.number), 0.2, (x, yy) => [cell.x + x, top, cell.z - yy - 0.035]), ink, stroke)
        const pips = pipsOf(tile.number)
        for (let k = 0; k < pips; k++) {
          const px = cell.x + (k - (pips - 1) / 2) * 0.05
          pen.print([[[px - 0.001, top, cell.z + 0.15], [px + 0.001, top, cell.z + 0.15]]], ink, 0.024)
        }
      }
    })

    // Harbors: a post, two planks to the coast, and the rate on a round sign; they come in last, from the open side.
    const ports = s.ports as readonly Trade[]
    HARBORS.forEach((h, i) => {
      const trade = ports[i]
      if (!trade) return
      const settle = easeOut(clamp01((built - 0.64 - i * 0.022) / 0.16))
      if (settle <= 0.001) return
      const tint: Rgba = trade === "any" ? [0.97, 0.96, 0.93, 1] : palettes[trade].ground
      const on = shownPorts.has(i + 1)
      const dim = dimOf(on)
      const lift = on ? 0.3 * easeOut(lit) : 0
      const rad = (h.angle * Math.PI) / 180
      // Slid out along the harbor's own heading, away from the coast, until it settles.
      const away = (1 - settle) * 0.7
      const ox = Math.cos(rad) * away
      const oz = -Math.sin(rad) * away
      const out = grid ? SQ3 / 2 : PORT_OUT
      const px = h.x + Math.cos(rad) * out + ox
      const pz = h.z - Math.sin(rad) * out + oz
      const wood: Rgba = fadeIn(shade([0.78, 0.52, 0.3, 1], dim), settle)
      const edge = fadeIn(shade(line, dim), settle)
      for (const [ex, ez] of h.ends) {
        const sx = ex + (h.x - ex) * 0.28 + ox
        const sz = ez + (h.z - ez) * 0.3 + oz
        // Each plank runs from the coast to the sign's rim, not under its face.
        const reach = Math.hypot(px - sx, pz - sz)
        const ex2 = px - ((px - sx) / reach) * (SIGN_R - 0.02)
        const ez2 = pz - ((pz - sz) / reach) * (SIGN_R - 0.02)
        const dx = ex2 - sx
        const dz = ez2 - sz
        const len = Math.hypot(dx, dz)
        const yaw = (Math.atan2(-dz, dx) * 180) / Math.PI
        const py = grid ? 0.04 : 0.21
        solid(g, Geo.box({ width: len, height: 0.05, depth: 0.09 }), wood, { position: [(sx + ex2) / 2, py, (sz + ez2) / 2], rotation: [0, yaw, 0] })
        pen.box([(sx + ex2) / 2, py, (sz + ez2) / 2], len, 0.05, 0.09, yaw, edge)
      }
      // The sign stands on the platform (grid) or on a post above the rim (tray), and grows upward when lit.
      const base = grid ? 0 : 0.265
      const top = base + 0.07 + lift
      if (!grid) solid(g, Geo.cylinder({ radius: 0.05, height: 0.3, segments: [6, 1] }), wood, { position: [px, 0.1, pz] })
      solid(g, Geo.cylinder({ radius: SIGN_R, height: top - base, segments: [28, 1] }), fadeIn(shade(tint, dim), settle), { position: [px, (base + top) / 2, pz] })
      pen.prism(px, pz, base, top, SIGN_R, 20, 0, edge, false, 0.7)
      // A paper face: what the harbor trades, drawn in that trade's colour, over its rate.
      solid(g, Geo.circle({ radius: SIGN_R - 0.06, segments: 28 }), fadeIn(shade(c(s.tokenColor), dim), settle), { position: [px, top + 0.008, pz], rotation: [-90, 0, 0] }, flat)
      const label = fadeIn(print(c(s.inkColor), dim), settle)
      // Clear of the face below it: a hair's gap fights for depth from across the board.
      const on2 = (dz: number) => (x: number, yy: number): V3 => [px + x, top + 0.012, pz + dz - yy]
      pen.print(letter(trade === "any" ? "3:1" : "2:1", 0.1, on2(0.15)), label, stroke * 0.85)
      if (trade === "any") pen.print(letter("?", 0.15, on2(-0.05)), label, stroke * 0.95)
      else pen.print(pictogram(trade, 0.22, on2(-0.06)), fadeIn(print(mix(palettes[trade].ground, [0.12, 0.11, 0.14, 1], 0.45), dim), settle), stroke * 0.95)
    })

    pen.draw(g)
    ctx.draw(g)
  },
})
