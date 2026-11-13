import { Graphics3D, Types, type FillResolved, type SceneContext, type StrokeResolved, type Transform3D } from "@motionscript/sdk"
import {
  FINE,
  HIDDEN,
  OUTLINE,
  PAPER,
  body,
  clamp01,
  clipBelow,
  dimension,
  dimensionScale,
  drawDimensions,
  easeOut,
  lines,
  metres,
  prism,
  prismEdges,
  type Face,
  type Point,
  type Vec,
} from "./cad-kit"

// --- Buildings ----------------------------------------------------------------------
// What a house, an office block and a tower share: storeys of one height rising one at
// a time, walls with openings drawn on them, and dimensions. Each is its own component,
// with the same props, so a scene picks the building it means.

export type Kind = "house" | "block" | "tower"

/** One storey, in drawing units of ten metres. */
export const STOREY = 0.32

/** One extruded piece of a building: its front outline in xy, from `z0` to `z1`. */
interface Part {
  poly: Point[]
  z0: number
  z1: number
}

interface Plan {
  parts: Part[]
  /** The main volume's box, which the floors and openings are drawn on. */
  body: { w: number; d: number; h: number }
  /** Where each level the building rises by tops out, from the ground. */
  levels: number[]
  /** A mast or flagpole: a line from the roof, not a solid. */
  mast?: [Vec, Vec]
}

function plan(kind: Kind, w: number, d: number, storeys: number): Plan {
  const sh = STOREY
  const h = storeys * sh
  const box = (x0: number, x1: number, y0: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  const levels = Array.from({ length: storeys }, (_, k) => (k + 1) * sh)
  if (kind === "house") {
    // A 40-degree pitch across the width, ridge running front to back.
    const ridge = h + (w / 2) * Math.tan((40 * Math.PI) / 180)
    return { parts: [{ poly: [[-w / 2, 0], [w / 2, 0], [w / 2, h], [0, ridge], [-w / 2, h]], z0: -d / 2, z1: d / 2 }], body: { w, d, h }, levels: [...levels, ridge] }
  }
  if (kind === "tower") {
    const inset = Math.min(w, d) * 0.14
    const crown = h + sh * 1.6
    return {
      parts: [
        { poly: box(-w / 2, w / 2, 0, h), z0: -d / 2, z1: d / 2 },
        { poly: box(-w / 2 + inset, w / 2 - inset, h, crown), z0: -d / 2 + inset, z1: d / 2 - inset },
      ],
      body: { w, d, h },
      levels: [...levels, crown],
      mast: [[0, crown, 0], [0, crown + sh * 1.2, 0]],
    }
  }
  // A plant room set back on the flat roof.
  const plant = h + sh * 0.7
  return {
    parts: [
      { poly: box(-w / 2, w / 2, 0, h), z0: -d / 2, z1: d / 2 },
      { poly: box(w * 0.08, w * 0.34, h, plant), z0: -d * 0.22, z1: d * 0.2 },
    ],
    body: { w, d, h },
    levels: [...levels, plant],
  }
}

/** The height the building stands at, `p` of the way up: one level at a time, each easing to a stop. */
function heightAt(levels: readonly number[], p: number): number {
  if (p >= 1) return levels[levels.length - 1]!
  if (p <= 0) return 0
  const n = levels.length
  const k = Math.min(n - 1, Math.floor(p * n))
  const from = k === 0 ? 0 : levels[k - 1]!
  return from + (levels[k]! - from) * easeOut(p * n - k)
}

/** A rectangle drawn on a wall: `at` maps (along, up) on the wall into the model. */
function frame(out: [Vec, Vec][], at: (a: number, y: number) => Vec, a0: number, a1: number, y0: number, y1: number): void {
  const p = [at(a0, y0), at(a1, y0), at(a1, y1), at(a0, y1)]
  for (let i = 0; i < 4; i++) out.push([p[i]!, p[(i + 1) % 4]!])
}

interface Drawn {
  faces: Face[]
  edges: [Vec, Vec][]
  floors: [Vec, Vec][]
  windows: [Vec, Vec][]
}

/** The building up to height `H`: its solid, its edges, its floor lines and its openings once their storey is built. */
function drawn(kind: Kind, p: Plan, H: number): Drawn {
  const sh = STOREY
  const faces: Face[] = []
  const edges: [Vec, Vec][] = []
  for (const part of p.parts) {
    const poly = clipBelow(part.poly, H)
    if (poly.length < 3) continue
    faces.push(...prism(poly, part.z0, part.z1))
    edges.push(...prismEdges(poly, part.z0, part.z1))
  }
  const { w, d, h } = p.body
  const top = Math.min(H, h)
  // Lines on a wall sit a hair off it: the depth rule for anything laid on a face.
  const e = 0.0012
  const walls: { len: number; at: (a: number, y: number) => Vec }[] = [
    { len: w, at: (a, y) => [-w / 2 + a, y, d / 2 + e] },
    { len: w, at: (a, y) => [w / 2 - a, y, -d / 2 - e] },
    { len: d, at: (a, y) => [w / 2 + e, y, d / 2 - a] },
    { len: d, at: (a, y) => [-w / 2 - e, y, -d / 2 + a] },
  ]
  const floors: [Vec, Vec][] = []
  for (let y = sh; y < top - 1e-6; y += sh) for (const wall of walls) floors.push([wall.at(0, y), wall.at(wall.len, y)])
  const windows: [Vec, Vec][] = []
  const storeys = Math.round(h / sh)
  walls.forEach((wall, side) => {
    if (kind === "tower") {
      // A curtain wall: mullions the full height.
      const n = Math.max(2, Math.round(wall.len / (sh * 0.55)))
      for (let i = 1; i < n; i++) windows.push([wall.at((wall.len * i) / n, 0), wall.at((wall.len * i) / n, top)])
      return
    }
    const n = Math.max(1, Math.round(wall.len / (sh * 1.15)))
    const pitch = wall.len / n
    const half = pitch * (kind === "block" ? 0.36 : 0.22)
    for (let k = 0; k < storeys; k++) {
      const sill = k * sh + sh * (k === 0 && kind === "block" ? 0.12 : 0.3)
      const head = k * sh + sh * 0.78
      if (head > H) break
      for (let i = 0; i < n; i++) {
        const c = pitch * (i + 0.5)
        const door = kind === "house" && side === 0 && k === 0 && i === Math.floor(n / 2)
        if (door) frame(windows, wall.at, c - sh * 0.2, c + sh * 0.2, 0, sh * 0.72)
        else frame(windows, wall.at, c - half, c + half, sill, head)
      }
    }
  })
  return { faces, edges, floors, windows }
}

const cache = new Map<string, Drawn>()

function cached(kind: Kind, p: Plan, H: number): Drawn {
  const key = `${kind}|${p.body.w}|${p.body.d}|${p.body.h}|${H.toFixed(4)}`
  let hit = cache.get(key)
  if (!hit) {
    hit = drawn(kind, p, H)
    if (cache.size > 64) cache.clear()
    cache.set(key, hit)
  }
  return hit
}

/** The props every building has: its footprint and storeys, its paints, and what its commands move. */
export function buildingState(storeys: number, most: number) {
  return {
    /** The walls and roof, shaded in four tones of its colour. */
    fill: Types.fill(PAPER),
    /** The outline and the mast. */
    stroke: Types.stroke(OUTLINE),
    /** Across the front, in drawing units of ten metres. */
    width: Types.number(1.2, { min: 0.2, max: 8, step: 0.05, animatable: false }),
    depth: Types.number(0.8, { min: 0.2, max: 8, step: 0.05, animatable: false }),
    storeys: Types.number(storeys, { min: 1, max: most, step: 1, animatable: false }),
    /** Window frames, or a tower's mullions; empty draws none. */
    windows: Types.stroke(FINE),
    /** A line at every floor; empty draws none. */
    floors: Types.stroke(FINE),
    /** Edges behind the solid, seen through it; empty draws none. */
    hiddenLines: Types.stroke(HIDDEN),
    /** Drafting dimensions for its width and height, in metres; empty draws none. */
    dimensions: Types.stroke([]),
    raised: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    measured: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
  }
}

interface BuildingValues {
  width: number
  depth: number
  storeys: number
  fill: readonly FillResolved[]
  stroke: readonly StrokeResolved[]
  windows: readonly StrokeResolved[]
  floors: readonly StrokeResolved[]
  hiddenLines: readonly StrokeResolved[]
  dimensions: readonly StrokeResolved[]
  raised: number
  measured: number
  rotationY: number
}

export function drawBuilding(ctx: SceneContext, s: BuildingValues, kind: Kind): void {
  const raised = ctx.declaring ? 1 : clamp01(s.raised)
  if (raised <= 0) return
  const p = plan(kind, Math.max(0.1, s.width), Math.max(0.1, s.depth), Math.max(1, Math.round(s.storeys)))
  const H = heightAt(p.levels, raised)
  if (H <= 1e-4) return
  const { faces, edges, floors, windows } = cached(kind, p, H)
  const g = new Graphics3D()
  body(g, faces, s.fill)
  lines(g, s.stroke, edges)
  lines(g, s.floors, floors)
  lines(g, s.windows, windows)
  if (p.mast && H >= p.levels[p.levels.length - 1]! - 1e-6) lines(g, s.stroke, [p.mast])
  lines(g, s.hiddenLines, edges, { through: true })
  const shown = clamp01(s.measured)
  const pen = (s.dimensions[0]?.weight ?? 0) * 0.001
  if (pen > 0 && raised >= 1 && shown > 0) {
    const { w, d } = p.body
    const top = p.levels[p.levels.length - 1]!
    const u = dimensionScale(pen)
    const mirror = Math.cos((s.rotationY * Math.PI) / 180) < 0
    const bars: Transform3D[] = []
    dimension(bars, [-w / 2, 0, d / 2], [w / 2, 0, d / 2], [0, -0.09 * u, 0], shown, u, pen, mirror, metres(w))
    dimension(bars, [w / 2, 0, d / 2], [w / 2, top, d / 2], [0.1 * u, 0, 0], shown, u, pen, mirror, metres(top))
    drawDimensions(g, s.dimensions, bars, shown)
  }
  ctx.draw(g)
}

