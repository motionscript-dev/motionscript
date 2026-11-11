import { Geo, Graphics3D, Mat, Types, component3d, type Geometry3D, type Transform3D } from "@motionscript/sdk"

type Rgba = [number, number, number, number]
type Point = readonly [number, number]
type Vec = readonly [number, number, number]
type Kind = "settlement" | "city" | "road"

// --- Shapes ------------------------------------------------------------------

interface Face {
  verts: Vec[]
  normal: Vec
}

/** An outline extruded from `z0` to `z1`, as flat faces; the caps fan from its first corner, which must see every other. */
function prism(poly: readonly Point[], z0: number, z1: number): Face[] {
  const faces: Face[] = [
    { verts: poly.map((p) => [p[0], p[1], z1] as Vec), normal: [0, 0, 1] },
    { verts: [poly[0]!, ...poly.slice(1).reverse()].map((p) => [p[0], p[1], z0] as Vec), normal: [0, 0, -1] },
  ]
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    faces.push({
      verts: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]],
      normal: [(b[1] - a[1]) / l, -(b[0] - a[0]) / l, 0],
    })
  })
  return faces
}

function house(x: number, w: number, wall: number, peak: number): Point[] {
  return [[x - w / 2, 0], [x + w / 2, 0], [x + w / 2, wall], [x, peak], [x - w / 2, wall]]
}

function block(x0: number, x1: number, h: number): Point[] {
  return [[x0, 0], [x1, 0], [x1, h], [x0, h]]
}

interface Part {
  poly: Point[]
  depth: number
}

// In board units: a tile is 0.95 from centre to corner, so a road spans most of an edge.
const PARTS: Record<Kind, Part[]> = {
  settlement: [{ poly: house(0, 0.24, 0.17, 0.31), depth: 0.3 }],
  // One outline, so one hull and no seam where the hall meets the tower.
  // It starts at the inner corner, the one corner that sees all the others.
  city: [{ poly: [[-0.02, 0.21], [-0.25, 0.21], [-0.25, 0], [0.22, 0], [0.22, 0.3], [0.1, 0.44], [-0.02, 0.3]], depth: 0.28 }],
  road: [{ poly: block(-0.32, 0.32, 0.1), depth: 0.1 }],
}

// --- Cel shading ---------------------------------------------------------------

// Where the paint's light comes from, in the piece's own frame: the board's sun at rest.
const SUN: Vec = (() => {
  const v = [-5, 8, 4]
  const l = Math.hypot(...v)
  return [v[0]! / l, v[1]! / l, v[2]! / l]
})()

function toHsl([r, g, b]: Rgba): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number): Vec {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)]
}

/** Turns `h` toward `to` by up to `by` degrees, the short way round. */
function lean(h: number, to: number, by: number): number {
  const d = ((to - h + 540) % 360) - 180
  return (h + Math.sign(d) * Math.min(Math.abs(d), by) + 360) % 360
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/**
 * Four flat tones from one colour: a warm highlight, the colour itself, and
 * two shadows leaning toward violet. That lean is what makes it read as
 * painted rather than lit.
 */
function tones(color: Rgba): Vec[] {
  const [h, s, l] = toHsl(color)
  return [
    fromHsl(lean(h, 50, 10), clamp01(s * 0.92), clamp01(l + (1 - l) * 0.32)),
    fromHsl(h, s, l),
    fromHsl(lean(h, 255, 8), clamp01(s * 0.95), clamp01(l * 0.82)),
    fromHsl(lean(h, 255, 16), clamp01(s * 0.85), clamp01(l * 0.66)),
  ]
}

/** Four close greys of one colour: a CAD viewport's shading, quiet enough that the lines carry the form. */
function cadTones(color: Rgba): Vec[] {
  const [h, s, l] = toHsl(color)
  return [
    fromHsl(h, s * 0.9, clamp01(l + (1 - l) * 0.14)),
    fromHsl(h, s, l),
    fromHsl(h, s, clamp01(l * 0.92)),
    fromHsl(h, s, clamp01(l * 0.84)),
  ]
}

function band(normal: Vec, sun: Vec): number {
  const k = normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2]
  return k > 0.6 ? 0 : k > 0.2 ? 1 : k > -0.25 ? 2 : 3
}

function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function triangles(faces: Face[], paint: ((face: Face) => Vec) | null): Geometry3D {
  const position: number[] = []
  const normal: number[] = []
  const color: number[] = []
  for (const face of faces) {
    const rgb = paint ? paint(face).map(linear) : null
    for (let i = 1; i < face.verts.length - 1; i++) {
      for (const v of [face.verts[0]!, face.verts[i]!, face.verts[i + 1]!]) {
        position.push(...v)
        normal.push(...face.normal)
        if (rgb) color.push(...rgb)
      }
    }
  }
  return Geo.buffer({
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    ...(paint ? { color: new Float32Array(color) } : {}),
    staticData: true,
  })
}

// Each face keeps the tone it is painted in however the piece turns: the sun is
// the piece's own, so a turn never flips a side from lit to shaded.
const painted = new Map<string, Geometry3D>()

function paintedPiece(kind: Kind, color: Rgba, cad: boolean): Geometry3D {
  const faces = PARTS[kind].flatMap((p) => prism(p.poly, -p.depth / 2, p.depth / 2))
  const bands = faces.map((f) => band(f.normal, SUN))
  const key = `${kind}|${cad}|${color.map((c) => c.toFixed(3)).join()}`
  let hit = painted.get(key)
  if (!hit) {
    const palette = cad ? cadTones(color) : tones(color)
    let i = 0
    hit = triangles(faces, () => palette[bands[i++]!]!)
    if (painted.size > 256) painted.clear()
    painted.set(key, hit)
  }
  return hit
}

// --- Drawn edges -----------------------------------------------------------------

type Look = "cad" | "ink" | "sketch" | "flat"

/** Every hard edge of a part: both outlines and the corners between them. */
function edgesOf(part: Part): [Vec, Vec][] {
  const z0 = -part.depth / 2
  const z1 = part.depth / 2
  return part.poly.flatMap((a, i) => {
    const b = part.poly[(i + 1) % part.poly.length]!
    return [
      [[a[0], a[1], z0], [b[0], b[1], z0]],
      [[a[0], a[1], z1], [b[0], b[1], z1]],
      [[a[0], a[1], z0], [a[0], a[1], z1]],
    ] as [Vec, Vec][]
  })
}

const BAR = Geo.box({ width: 1, height: 1, depth: 1 })

/** A bar from `p` to `q`, `w` thick, running `extend` past each end. */
function bar(p: Vec, q: Vec, w: number, extend: number): Transform3D {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const dz = q[2] - p[2]
  const len = Math.hypot(dx, dy, dz)
  const d = [dx / len, dy / len, dz / len]
  // The turn that carries +x onto the edge: about +x cross d, by the angle between them.
  let quaternion = { x: 0, y: 1, z: 0, w: 0 }
  if (d[0]! > -0.9999) {
    const qx = 0
    const qy = -d[2]!
    const qz = d[1]!
    const qw = 1 + d[0]!
    const l = Math.hypot(qx, qy, qz, qw)
    quaternion = { x: qx / l, y: qy / l, z: qz / l, w: qw / l }
  }
  return {
    position: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2],
    quaternion,
    scale: [len + extend * 2, w, w],
  }
}

/** A small deterministic wobble per edge, so a sketch never repeats a stroke exactly. */
function wobble(seed: number): number {
  const v = Math.sin(seed * 91.7 + 47.3) * 43758.5453
  return v - Math.floor(v) - 0.5
}

const strokes = new Map<string, Transform3D[]>()

function strokesOf(kind: Kind, look: Look): Transform3D[] {
  const key = `${kind}|${look}`
  let hit = strokes.get(key)
  if (!hit) {
    hit = PARTS[kind].flatMap((part) => edgesOf(part)).map(([p, q], i) => {
      if (look === "ink") return bar(p, q, 0.011, 0.0055)
      if (look === "cad") return bar(p, q, 0.0045, 0.0022)
      // A pen line: a touch uneven, crossing past the corner it ends at.
      const jitter = (k: number): Vec => [p[0] + wobble(i * 7 + k) * 0.008, p[1] + wobble(i * 11 + k) * 0.008, p[2] + wobble(i * 13 + k) * 0.008]
      const end = (k: number): Vec => [q[0] + wobble(i * 17 + k) * 0.008, q[1] + wobble(i * 19 + k) * 0.008, q[2] + wobble(i * 23 + k) * 0.008]
      return bar(jitter(1), end(2), 0.0085 + (wobble(i * 29) + 0.5) * 0.007, 0.018 + (wobble(i * 31) + 0.5) * 0.02)
    })
    strokes.set(key, hit)
  }
  return hit
}

/** Every edge as dashes, for the hidden lines a CAD view shows through the solid. */
const dashes = new Map<Kind, Transform3D[]>()

function dashesOf(kind: Kind): Transform3D[] {
  let hit = dashes.get(kind)
  if (!hit) {
    hit = []
    for (const [p, q] of PARTS[kind].flatMap((part) => edgesOf(part))) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
      const n = Math.max(1, Math.round(len / 0.03))
      for (let k = 0; k < n; k++) {
        const at = (t: number): Vec => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]
        hit.push(bar(at(k / n), at((k + 0.55) / n), 0.0035, 0))
      }
    }
    dashes.set(kind, hit)
  }
  return hit
}

// --- Dimensions ---------------------------------------------------------------------

/** Board units to the millimetres a dimension reads. */
const MM = 40
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
  ".": [[[0.3, 0], [0.3, 0.08]]],
}

/**
 * `text` as strokes, `height` tall and centred on the origin of its own plane;
 * `place` carries a point of that plane (x right, y up) into the scene.
 */
function letter(text: string, height: number, place: (x: number, y: number) => Vec): [Vec, Vec][] {
  const advance = (ch: string) => (ch === ":" || ch === "." ? 0.5 : 0.82)
  const width = [...text].reduce((w, ch) => w + advance(ch), 0) - 0.22
  const out: [Vec, Vec][] = []
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

/** A drafting dimension from `a` to `b`: the line, a tick at each end, the gaps out to the part, and the size. */
function dimension(bars: Transform3D[], a: Vec, b: Vec, out: Vec, mirror: boolean): void {
  const off = (v: Vec, k: number): Vec => [v[0] + out[0] * k, v[1] + out[1] * k, v[2] + out[2] * k]
  const a1 = off(a, 1)
  const b1 = off(b, 1)
  bars.push(bar(off(a, 0.25), off(a, 1.25), 0.003, 0), bar(off(b, 0.25), off(b, 1.25), 0.003, 0), bar(a1, b1, 0.003, 0))
  // Ticks at 45 degrees across each end.
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const d: Vec = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len]
  const t: Vec = [(d[0] + out[0] * 3) * 0.008, (d[1] + out[1] * 3) * 0.008, (d[2] + out[2] * 3) * 0.008]
  for (const e of [a1, b1]) bars.push(bar([e[0] - t[0], e[1] - t[1], e[2] - t[2]], [e[0] + t[0], e[1] + t[1], e[2] + t[2]], 0.0035, 0))
  // The size, lettered in the part's front plane beside the line.
  const mid = off([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], out[0] !== 0 ? 1.9 : 2.3)
  const size = 0.034
  // Lettered in the front plane; read from behind, the figures are flipped so they never show mirrored.
  const flip = mirror ? -1 : 1
  for (const [p, q] of letter((len * MM).toFixed(1), size, (x, y) => [mid[0] + flip * x + (out[0] !== 0 ? size * 1.4 : 0), mid[1] + y, mid[2]])) {
    const t = bar(p, q, 0.0042, 0.0021)
    bars.push({ ...t, scale: [(t.scale as Vec)[0], 0.0042, 0.002] })
  }
}

const SHADOW = Geo.circle({ radius: 0.24, segments: 24 })
const FOOTPRINT: Record<Kind, [number, number]> = { road: [1.5, 0.55], city: [1.15, 0.85], settlement: [0.85, 0.9] }

export default component3d({
  key: "gamePiece",
  state: {
    kind: Types.oneOf(["settlement", "city", "road"] as const, { animatable: false }),
    look: Types.oneOf(["cad", "ink", "sketch", "flat"] as const, { animatable: false }),
    /** Drafting dimensions for its width and height, in millimetres. */
    dimensions: Types.boolean(false, { animatable: false }),
    color: Types.color("#3D7FE6"),
    lineColor: Types.color("#24212E"),
    placed: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
  },
  commands: {
    place: {
      args: {},
      entrance: true,
      run: (timeline) => timeline.animate((t) => ({ placed: t }), { eased: false }),
    },
  },
  render: (ctx, s) => {
    const placed = ctx.declaring ? 1 : clamp01(s.placed)
    if (placed <= 0) return
    const kind = (PARTS[s.kind as Kind] ? s.kind : "settlement") as Kind
    const line = s.lineColor as unknown as Rgba
    // It comes down and eases to a stop where it stands.
    const fall = 1 - Math.pow(1 - placed, 3)
    const y = 1.2 * (1 - fall)
    const at: Transform3D = { position: [0, y, 0], scale: [1, 1, 1] }
    const [fx, fz] = FOOTPRINT[kind]
    const g = new Graphics3D()
    const look = s.look as Look
    // A drawing has no shadow; the other looks sit on one.
    if (look !== "cad") g.mesh(SHADOW, Mat.basic({ color: line, opacity: 0.25 * fall, transparent: true, depthWrite: false }), {
      position: [0, 0.004, 0],
      rotation: [-90, 0, 0],
      scale: [fx * (0.6 + 0.4 * fall), fz * (0.6 + 0.4 * fall), 1],
    })
    g.mesh(paintedPiece(kind, s.color as unknown as Rgba, look === "cad"), Mat.basic({ color: "white", vertexColors: true }), at)
    if (look !== "flat") g.instances(BAR, Mat.basic({ color: line }), strokesOf(kind, look), { transform: at })
    if (look === "cad") {
      g.instances(BAR, Mat.basic({ color: line, opacity: 0.28 * fall, transparent: true, depthTest: false, depthWrite: false }), dashesOf(kind), { transform: at })
      if (s.dimensions && fall > 0.98) {
        const part = PARTS[kind][0]!
        const xs = part.poly.map((p) => p[0])
        const ys = part.poly.map((p) => p[1])
        const x0 = Math.min(...xs)
        const x1 = Math.max(...xs)
        const z = part.depth / 2
        const bars: Transform3D[] = []
        // The camera looks along -z; past a quarter turn either way the piece shows its back.
        const mirror = Math.cos((s.rotationY * Math.PI) / 180) < 0
        dimension(bars, [x0, 0, z], [x1, 0, z], [0, 0, 0.07], mirror)
        dimension(bars, [x1, 0, -z], [x1, Math.max(...ys), -z], [0.07, 0, 0], mirror)
        g.instances(BAR, Mat.basic({ color: line }), bars, { transform: at })
      }
    }
    ctx.draw(g)
  },
})
