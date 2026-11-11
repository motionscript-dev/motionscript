import { Graphics3D, Mat, Types, component3d, type Geometry3D, type Material3D, type Transform3D } from "@motionscript/sdk"
import {
  BAR,
  PAINTED,
  bar,
  clamp01,
  clipBelow,
  dashed,
  dimension,
  easeOut,
  flat,
  metres,
  prism,
  prismEdges,
  shaded,
  type Point,
  type Rgba,
  type Vec,
} from "./cad-kit"

type Kind = "house" | "block" | "tower"

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

function plan(kind: Kind, w: number, d: number, storeys: number, sh: number): Plan {
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

/** A rectangle drawn on a wall: `along` and `up` span the wall's plane, `at` is its corner. */
function frame(out: [Vec, Vec][], at: (a: number, y: number) => Vec, a0: number, a1: number, y0: number, y1: number): void {
  const p = [at(a0, y0), at(a1, y0), at(a1, y1), at(a0, y1)]
  for (let i = 0; i < 4; i++) out.push([p[i]!, p[(i + 1) % 4]!])
}

interface Lines {
  edges: [Vec, Vec][]
  fine: [Vec, Vec][]
}

/** The building's drawn lines up to height `H`: edges, floor lines, and openings once their storey is built. */
function linesOf(kind: Kind, p: Plan, H: number, sh: number, openings: boolean, floors: boolean): Lines {
  const edges: [Vec, Vec][] = []
  const fine: [Vec, Vec][] = []
  for (const part of p.parts) {
    const poly = clipBelow(part.poly, H)
    if (poly.length >= 3) edges.push(...prismEdges(poly, part.z0, part.z1))
  }
  const { w, d, h } = p.body
  const top = Math.min(H, h)
  const e = 0.0012
  // The four walls, each as a map from (along, up) into the model.
  const walls: { len: number; at: (a: number, y: number) => Vec }[] = [
    { len: w, at: (a, y) => [-w / 2 + a, y, d / 2 + e] },
    { len: w, at: (a, y) => [w / 2 - a, y, -d / 2 - e] },
    { len: d, at: (a, y) => [w / 2 + e, y, d / 2 - a] },
    { len: d, at: (a, y) => [-w / 2 - e, y, -d / 2 + a] },
  ]
  if (floors) {
    for (let y = sh; y < top - 1e-6; y += sh) for (const wall of walls) fine.push([wall.at(0, y), wall.at(wall.len, y)])
  }
  if (!openings) return { edges, fine }
  const storeys = Math.round(h / sh)
  walls.forEach((wall, side) => {
    if (kind === "tower") {
      // A curtain wall: mullions the full height, over the floor lines.
      const n = Math.max(2, Math.round(wall.len / (sh * 0.55)))
      for (let i = 1; i < n; i++) fine.push([wall.at((wall.len * i) / n, 0), wall.at((wall.len * i) / n, top)])
      return
    }
    const n = Math.max(1, Math.round(wall.len / (sh * 1.15)))
    const pitch = wall.len / n
    for (let k = 0; k < storeys; k++) {
      const sill = k * sh + sh * (k === 0 && kind === "block" ? 0.12 : 0.3)
      const head = k * sh + sh * 0.78
      if (head > H) break
      for (let i = 0; i < n; i++) {
        const c = pitch * (i + 0.5)
        const door = kind === "house" && side === 0 && k === 0 && i === Math.floor(n / 2)
        if (door) frame(fine, wall.at, c - sh * 0.2, c + sh * 0.2, 0, sh * 0.72)
        else frame(fine, wall.at, c - pitch * (kind === "block" ? 0.36 : 0.22), c + pitch * (kind === "block" ? 0.36 : 0.22), sill, head)
      }
    }
  })
  return { edges, fine }
}

const shapes = new Map<string, { solid: Geometry3D; lines: Lines }>()

function model(kind: Kind, p: Plan, H: number, sh: number, color: Rgba, openings: boolean, floors: boolean) {
  const key = `${kind}|${p.body.w}|${p.body.d}|${p.body.h}|${sh}|${H.toFixed(4)}|${color.map((c) => c.toFixed(3)).join()}|${openings}|${floors}`
  let hit = shapes.get(key)
  if (!hit) {
    const faces = p.parts.flatMap((part) => {
      const poly = clipBelow(part.poly, H)
      return poly.length >= 3 ? prism(poly, part.z0, part.z1) : []
    })
    hit = { solid: shaded(faces, color), lines: linesOf(kind, p, H, sh, openings, floors) }
    if (shapes.size > 64) shapes.clear()
    shapes.set(key, hit)
  }
  return hit
}

function strokes(lines: readonly [Vec, Vec][], w: number): Transform3D[] {
  return lines.map(([a, b]) => bar(a, b, w, w / 2))
}

export default component3d({
  key: "building",
  state: {
    kind: Types.oneOf(["house", "block", "tower"] as const, { animatable: false }),
    /** Across the front, in drawing units of ten metres. */
    width: Types.number(1.2, { min: 0.2, max: 8, step: 0.05, animatable: false }),
    depth: Types.number(0.8, { min: 0.2, max: 8, step: 0.05, animatable: false }),
    storeys: Types.number(3, { min: 1, max: 40, step: 1, animatable: false }),
    storeyHeight: Types.number(0.32, { min: 0.1, max: 1, step: 0.01, animatable: false }),
    color: Types.color("#E9E6DD"),
    lineColor: Types.color("#1A2230"),
    /** Hairline weight, as a multiple of the drafting pen. */
    lineWidth: Types.number(1, { min: 0.25, max: 6, step: 0.05 }),
    openings: Types.boolean(true, { animatable: false }),
    floorLines: Types.boolean(true, { animatable: false }),
    hiddenLines: Types.boolean(true, { animatable: false }),
    /** Drafting dimensions for its width and height, in metres. */
    dimensions: Types.boolean(false, { animatable: false }),
    /** How large the dimensions are drawn: arrows, offsets and lettering together. */
    labelSize: Types.number(1.6, { min: 0.5, max: 8, step: 0.1 }),
    raised: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    measured: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
  },
  commands: {
    raise: {
      args: {},
      entrance: true,
      run: (timeline) => timeline.animate((t) => ({ raised: t }), { eased: false }),
    },
    measure: {
      args: {},
      entrance: true,
      run: (timeline) => timeline.animate((t) => ({ measured: t }), { eased: false }),
    },
  },
  render: (ctx, s) => {
    const raised = ctx.declaring ? 1 : clamp01(s.raised)
    if (raised <= 0) return
    const kind = (["house", "block", "tower"].includes(s.kind) ? s.kind : "block") as Kind
    const sh = Math.max(0.05, s.storeyHeight)
    const p = plan(kind, Math.max(0.1, s.width), Math.max(0.1, s.depth), Math.max(1, Math.round(s.storeys)), sh)
    const H = heightAt(p.levels, raised)
    if (H <= 1e-4) return
    const line = s.lineColor as unknown as Rgba
    const lw = 0.0055 * Math.max(0.1, s.lineWidth)
    const { solid, lines } = model(kind, p, H, sh, s.color as unknown as Rgba, s.openings, s.floorLines)
    const g = new Graphics3D()
    g.mesh(solid, PAINTED)
    const ink = flat(line)
    g.instances(BAR, ink, strokes(lines.edges, lw))
    if (lines.fine.length) g.instances(BAR, ink, strokes(lines.fine, lw * 0.55))
    if (p.mast && H >= p.levels[p.levels.length - 1]! - 1e-6) g.instances(BAR, ink, [bar(p.mast[0], p.mast[1], lw * 1.2)])
    if (s.hiddenLines) {
      const hidden = Mat.basic({ color: line, opacity: 0.26, transparent: true, depthTest: false, depthWrite: false }) as Material3D
      g.instances(BAR, hidden, dashed(lines.edges, lw * 0.7, Math.max(0.03, p.body.h / 40)))
    }
    const shown = clamp01(s.measured)
    if (s.dimensions && raised >= 1 && shown > 0) {
      const { w, d } = p.body
      const top = p.levels[p.levels.length - 1]!
      const u = Math.max(0.2, s.labelSize)
      const mirror = Math.cos((s.rotationY * Math.PI) / 180) < 0
      const bars: Transform3D[] = []
      dimension(bars, [-w / 2, 0, d / 2], [w / 2, 0, d / 2], [0, -0.09 * u, 0.0], shown, u, mirror, metres(w))
      dimension(bars, [w / 2, 0, d / 2], [w / 2, top, d / 2], [0.1 * u, 0, 0], shown, u, mirror, metres(top))
      g.instances(BAR, flat([line[0], line[1], line[2], shown]), bars)
    }
    ctx.draw(g)
  },
})

