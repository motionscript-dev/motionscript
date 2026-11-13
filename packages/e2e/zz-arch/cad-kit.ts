import { Geo, Mat, type FillResolved, type Geometry3D, type Graphics3D, type Material3D, type StrokeResolved, type Transform3D } from "@motionscript/sdk"

// --- The drafting kit ------------------------------------------------------------
// Shared by the architecture template's nodes: solids shaded in four quiet tones of
// their fill, every line one of their strokes drawn as thin instanced bars, and
// dimensions lettered in a single-stroke hand. Everything is geometry, so nothing
// depends on how a renderer numbers a frame's images. `material` and `lines` are the
// engine's Paint3D helpers, same names and units, kept here until the studio's
// engine carries Paint3D; then they become `Paint3D.material` and `Paint3D.lines`.

export type Rgba = [number, number, number, number]
export type Point = readonly [number, number]
export type Vec = readonly [number, number, number]

export interface Face {
  verts: Vec[]
  normal: Vec
}

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)
export const easeInOut = (t: number) => {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
/** How far `t` is through the window `[a, b]`, 0 before it and 1 after. */
export const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))

// --- The drafting palette -----------------------------------------------------------

export const INK = "#1A2230"
export const PAPER = "#E9E6DD"
export const PLATE = "#E4E1D8"
export const STEEL = "#5B6B82"
export const ORANGE = "#E8642C"
export const BLUE = "#2563EB"

/** A model's outline: the drafting pen, its corners closed. */
export const OUTLINE = { weight: 5.5, fill: INK, cap: "square" } as const
/** A fine line drawn on a face: floors, openings, mullions. */
export const FINE = { weight: 3, fill: INK, cap: "square" } as const
/** Hidden edges, dashed faintly through the solid. */
export const HIDDEN = { weight: 3.85, fill: "#1A223042", dash: [18, 14] } as const

// --- Paints -------------------------------------------------------------------------

/** A stroke `weight` or `dash` of 1 is this many scene units. */
export const STROKE_UNIT = 0.001

/** The colour a paint is, read off its first solid layer with that layer's opacity; `null` for none. */
export function colorOf(paint: readonly FillResolved[] | undefined): Rgba | null {
  for (const layer of paint ?? []) {
    if (layer.type !== "solid") continue
    const [r, g, b, a = 1] = layer.color as unknown as number[]
    return [r!, g!, b!, a * (layer.opacity ?? 1)]
  }
  return null
}

/** The unlit material a surface painted with `fill` wears; `null` when it paints nothing. */
export function material(fill: readonly FillResolved[], fade = 1): Material3D | null {
  const c = colorOf(fill)
  return c ? flat([c[0], c[1], c[2], c[3] * fade]) : null
}

export interface LinesOptions {
  /** Drawn through solids, for hidden lines. */
  through?: boolean
  /** Multiplies every layer's opacity, as a line fades in. */
  fade?: number
  transform?: Transform3D
}

/**
 * `segments` drawn with each layer of `stroke`: one batch of bars per layer, weight and
 * dash in thousandths of a scene unit, a square cap running each bar half its weight past
 * its ends. An empty stroke draws nothing.
 */
export function lines(g: Graphics3D, stroke: readonly StrokeResolved[], segments: readonly [Vec, Vec][], options: LinesOptions = {}): void {
  const fade = options.fade ?? 1
  for (const layer of stroke) {
    const c = colorOf(layer.fill)
    if (!c || !(layer.weight > 0) || c[3] * fade <= 0.002) continue
    const w = layer.weight * STROKE_UNIT
    const extend = layer.cap === "square" ? w / 2 : 0
    const dash = (layer.dash ?? []).map((d) => d * STROKE_UNIT)
    const bars = dash.length >= 2 ? dashed(segments, w, dash[0]!, dash[1]!) : segments.map(([a, b]) => bar(a, b, w, extend))
    if (bars.length === 0) continue
    const ink = flat([c[0], c[1], c[2], c[3] * fade], options.through ? { depthTest: false, depthWrite: false } : {})
    g.instances(BAR, options.through ? ({ ...ink, transparent: true } as Material3D) : ink, bars, options.transform ? { transform: options.transform } : undefined)
  }
}

/** The weight of a stroke's first layer, in scene units; 0 when it draws nothing. */
export const weightOf = (stroke: readonly StrokeResolved[]) => (stroke[0]?.weight ?? 0) * STROKE_UNIT

/** An outline in the xy plane extruded from `z0` to `z1`, as flat faces; the caps fan from its first corner, which must see every other. */
export function prism(poly: readonly Point[], z0: number, z1: number): Face[] {
  const faces: Face[] = [
    { verts: poly.map((p) => [p[0], p[1], z1] as Vec), normal: [0, 0, 1] },
    { verts: [poly[0]!, ...poly.slice(1).reverse()].map((p) => [p[0], p[1], z0] as Vec), normal: [0, 0, -1] },
  ]
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l < 1e-6) return
    faces.push({
      verts: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]],
      normal: [(b[1] - a[1]) / l, -(b[0] - a[0]) / l, 0],
    })
  })
  return faces
}

/** A box from corner to corner, as a prism of its front outline. */
export function boxFaces(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Face[] {
  return prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1)
}

/** The part of an outline at or below `h` (Sutherland–Hodgman against one level line). */
export function clipBelow(poly: readonly Point[], h: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const ain = a[1] <= h + 1e-9
    const bin = b[1] <= h + 1e-9
    if (ain) out.push(a)
    if (ain !== bin) {
      const t = (h - a[1]) / (b[1] - a[1])
      out.push([a[0] + (b[0] - a[0]) * t, h])
    }
  }
  // Drop repeated corners, which would leave zero-length sides.
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length]!
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6
  })
}

// --- Shading ---------------------------------------------------------------------

/** Where the paint's light comes from, in the node's own frame, so a side keeps its tone however the node turns. */
export const SUN: Vec = (() => {
  const v = [-5, 8, 6]
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

/** Four close tones of one colour: a CAD viewport's shading, quiet enough that the lines carry the form. */
export function cadTones(color: Rgba): Vec[] {
  const [h, s, l] = toHsl(color)
  return [
    fromHsl(h, s * 0.9, clamp01(l + (1 - l) * 0.16)),
    fromHsl(h, s, l),
    fromHsl(h, s, clamp01(l * 0.9)),
    fromHsl(h, s, clamp01(l * 0.8)),
  ]
}

export function band(normal: Vec): number {
  const k = normal[0] * SUN[0] + normal[1] * SUN[1] + normal[2] * SUN[2]
  return k > 0.6 ? 0 : k > 0.2 ? 1 : k > -0.25 ? 2 : 3
}

function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

/** Faces as one mesh, each painted the tone its side faces the sun with. */
export function shaded(faces: readonly Face[], color: Rgba): Geometry3D {
  const tones = cadTones(color).map((c) => c.map(linear))
  const position: number[] = []
  const normal: number[] = []
  const paint: number[] = []
  for (const face of faces) {
    const rgb = tones[band(face.normal)]!
    for (let i = 1; i < face.verts.length - 1; i++) {
      for (const v of [face.verts[0]!, face.verts[i]!, face.verts[i + 1]!]) {
        position.push(...v)
        normal.push(...face.normal)
        paint.push(...rgb)
      }
    }
  }
  return Geo.buffer({
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    color: new Float32Array(paint),
  })
}

export const PAINTED = Mat.basic({ color: "white", vertexColors: true })

export function flat(color: Rgba, extra: Partial<{ depthTest: boolean; depthWrite: boolean }> = {}): Material3D {
  const opacity = color[3]
  return Mat.basic({ color: [color[0], color[1], color[2], 1], ...(opacity < 1 ? { opacity, transparent: true, depthWrite: false } : {}), ...extra })
}

/** An invisible copy that only writes depth, drawn first, so a fading solid fades as one piece. */
const HIDE = Mat.basic({ color: [0, 0, 0, 1], opacity: 0, transparent: true, depthWrite: true })

export function solid(g: Graphics3D, geometry: Geometry3D, material: Material3D, opacity: number, transform: Transform3D = {}): void {
  if (opacity <= 0.002) return
  if (opacity < 1) g.mesh(geometry, HIDE, { ...transform, renderOrder: -1 })
  g.mesh(geometry, opacity < 1 ? ({ ...material, opacity, transparent: true } as Material3D) : material, transform)
}

/** Faces shaded in the tones of `fill`, faded by `opacity`: nothing for an empty fill. */
export function body(g: Graphics3D, faces: readonly Face[], fill: readonly FillResolved[], opacity = 1, transform: Transform3D = {}): void {
  const c = colorOf(fill)
  if (!c) return
  solid(g, shaded(faces, c), PAINTED, opacity * c[3], transform)
}

// --- Lines -----------------------------------------------------------------------

export const BAR = Geo.box({ width: 1, height: 1, depth: 1 })

/** A bar from `p` to `q`, `w` thick, running `extend` past each end. */
export function bar(p: Vec, q: Vec, w: number, extend = 0): Transform3D {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const dz = q[2] - p[2]
  const len = Math.hypot(dx, dy, dz) || 1e-6
  const d = [dx / len, dy / len, dz / len]
  // The turn that carries +x onto the bar: about +x cross d, by the angle between them.
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

/** Every hard edge of an extruded outline: both outlines and the corners between them. */
export function prismEdges(poly: readonly Point[], z0: number, z1: number): [Vec, Vec][] {
  return poly.flatMap((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    return [
      [[a[0], a[1], z0], [b[0], b[1], z0]],
      [[a[0], a[1], z1], [b[0], b[1], z1]],
      [[a[0], a[1], z0], [a[0], a[1], z1]],
    ] as [Vec, Vec][]
  })
}

/** Edges as dashes `on` long with `off` between, `w` thick. */
export function dashed(edges: readonly [Vec, Vec][], w: number, on: number, off: number): Transform3D[] {
  const out: Transform3D[] = []
  const step = on + off
  for (const [p, q] of edges) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
    const n = Math.max(1, Math.round(len / step))
    const share = on / step
    const at = (t: number): Vec => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]
    for (let k = 0; k < n; k++) out.push(bar(at(k / n), at((k + share) / n), w))
  }
  return out
}

// --- Lettering --------------------------------------------------------------------

// A single-stroke drafting hand: each glyph is polylines in a box 0.6 wide and 1 tall.
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
  ".": [[[0.3, 0], [0.3, 0.08]]],
  "m": [[[0, 0], [0, 0.6]], [[0, 0.45], [0.12, 0.6], [0.2, 0.6], [0.3, 0.45], [0.3, 0]], [[0.3, 0.45], [0.42, 0.6], [0.5, 0.6], [0.6, 0.45], [0.6, 0]]],
  "k": [[[0, 0], [0, 1]], [[0.55, 0.62], [0, 0.22]], [[0.2, 0.38], [0.6, 0]]],
  "N": [[[0, 0], [0, 1], [0.6, 0], [0.6, 1]]],
  " ": [],
}

const narrow = (ch: string) => ch === "." || ch === " "

/**
 * `text` as strokes, `height` tall and centred on the origin of its own plane;
 * `place` carries a point of that plane (x right, y up) into the scene.
 */
export function letter(text: string, height: number, place: (x: number, y: number) => Vec): [Vec, Vec][] {
  const advance = (ch: string) => (narrow(ch) ? 0.5 : 0.82)
  const width = [...text].reduce((w, ch) => w + advance(ch), 0) - 0.22
  const out: [Vec, Vec][] = []
  let x = -width / 2
  for (const ch of text) {
    const w = narrow(ch) ? -0.05 : 0
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

/** Lettering strokes as flat bars, `w` thick, lying in the plane they were placed in. */
export function lettering(strokes: readonly [Vec, Vec][], w: number): Transform3D[] {
  return strokes.map(([p, q]) => {
    const t = bar(p, q, w, w / 2)
    return { ...t, scale: [(t.scale as Vec)[0], w, w * 0.5] }
  })
}

/**
 * How large dimensions drawn with a `pen` (scene units across) are: offsets, ticks and
 * lettering together. A drafting pen sets its lettering, a tenth or so of the height,
 * so a heavier dimension stroke draws larger figures.
 */
export const dimensionScale = (pen: number) => pen / 0.003

/**
 * A drafting dimension from `a` to `b`: extension lines out from the solid that stop on the
 * dimension line, a tick at each end, and the size beside it in metres. `out` is the
 * direction and reach of the offset; `k` (0..1) slides the whole drawing out as it is drawn in.
 * `u` scales the offsets and lettering, `w` is the pen; `mirror` flips the lettering when the
 * drawing is seen from behind, so it never reads backwards.
 */
export function dimension(bars: Transform3D[], a: Vec, b: Vec, out: Vec, k: number, u: number, w: number, mirror: boolean, text: string): void {
  const off = (v: Vec, f: number): Vec => [v[0] + out[0] * f, v[1] + out[1] * f, v[2] + out[2] * f]
  const reach = 0.5 + 0.5 * k
  const a1 = off(a, reach)
  const b1 = off(b, reach)
  bars.push(bar(off(a, 0.2), off(a, reach + 0.12), w), bar(off(b, 0.2), off(b, reach + 0.12), w), bar(a1, b1, w))
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const d: Vec = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len]
  const ol = Math.hypot(...out) || 1
  const n: Vec = [out[0] / ol, out[1] / ol, out[2] / ol]
  // Architectural ticks: a short slash through each end of the line.
  const tick = (at: Vec): Transform3D => {
    const s = 0.018 * u
    return bar([at[0] - (d[0] + n[0]) * s, at[1] - (d[1] + n[1]) * s, at[2] - (d[2] + n[2]) * s], [at[0] + (d[0] + n[0]) * s, at[1] + (d[1] + n[1]) * s, at[2] + (d[2] + n[2]) * s], w * 1.8)
  }
  bars.push(tick(a1), tick(b1))
  const size = 0.034 * u
  const sideways = Math.abs(d[1]) > 0.7
  const mid = off([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], reach + (sideways ? 0 : 0.6))
  const flip = mirror ? -1 : 1
  const width = text.length * 0.82 * size
  const shift = sideways ? (width / 2 + size * 0.8) * Math.sign(n[0] || 1) * flip : 0
  bars.push(...lettering(letter(text, size, (x, y) => [mid[0] + flip * x + shift, mid[1] + y, mid[2]]), w * 1.4))
}

/** Dimension bars drawn in the first layer of `stroke`, faded in by `k`. */
export function drawDimensions(g: Graphics3D, stroke: readonly StrokeResolved[], bars: readonly Transform3D[], k: number): void {
  const c = colorOf(stroke[0]?.fill)
  if (!c || bars.length === 0) return
  g.instances(BAR, flat([c[0], c[1], c[2], c[3] * k]), [...bars])
}

/** Metres as a dimension reads them; the drawing's unit is ten metres. */
export const metres = (units: number) => (units * 10).toFixed(1)
