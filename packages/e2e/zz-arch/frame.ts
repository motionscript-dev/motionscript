import { Graphics3D, Paint, Types, component3d, type FillResolved, type Transform3D } from "@motionscript/sdk"
import {
  BAR,
  INK,
  ORANGE,
  PLATE,
  STEEL,
  bar,
  body,
  boxFaces,
  clamp01,
  colorOf,
  dimension,
  dimensionScale,
  drawDimensions,
  easeOut,
  flat,
  lines,
  metres,
  mix,
  prismEdges,
  span,
  type Rgba,
  type Vec,
} from "./cad-kit"

/** One storey of the frame, in drawing units of ten metres. */
const STOREY = 0.36
/** How thick a column is; beams and braces are a share of it. */
const MEMBER = 0.0275

const lerp3 = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** A member drawn `t` of the way from `a` toward `b`, as it is being put up. */
function grow(out: Transform3D[], a: Vec, b: Vec, t: number, w: number): void {
  if (t <= 0.001) return
  out.push(bar(a, lerp3(a, b, easeOut(t)), w, w / 2))
}

/** A flat plate lying between two points of its centre line, `thick` deep and `wide` across. */
function plate(a: Vec, b: Vec, thick: number, wide: number): Transform3D {
  const t = bar(a, b, thick)
  return { ...t, scale: [(t.scale as Vec)[0], thick, wide] }
}

/** `paint` as one flat material, or nothing. */
function painted(g: Graphics3D, paint: readonly FillResolved[], bars: Transform3D[], tint?: (c: Rgba) => Rgba): void {
  const c = colorOf(paint)
  if (c && bars.length) g.instances(BAR, flat(tint ? tint(c) : c), bars)
}

/** A steel building frame, put up a storey at a time: columns, beams, braced end bays, a slab on each floor. */
export default component3d({
  key: "steelFrame",
  state: {
    /** The columns and beams. */
    fill: Types.fill(STEEL),
    /** The slabs' edges. */
    stroke: Types.stroke({ weight: 3.3, fill: INK, cap: "square" }),
    /** Bays along the front. */
    baysX: Types.number(3, { min: 1, max: 12, step: 1, animatable: false }),
    /** Bays front to back. */
    baysZ: Types.number(2, { min: 1, max: 12, step: 1, animatable: false }),
    storeys: Types.number(4, { min: 1, max: 30, step: 1, animatable: false }),
    /** One bay, in drawing units of ten metres. */
    bay: Types.number(0.6, { min: 0.1, max: 2, step: 0.01, animatable: false }),
    /** The floor slabs and footings. */
    slabs: Types.fill(PLATE),
    /** Cross-bracing in the end bays; empty draws none. */
    braces: Types.fill(ORANGE),
    /** Drafting dimensions for its width and height, in metres; empty draws none. */
    dimensions: Types.stroke([]),
    erected: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    measured: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
  },
  commands: {
    fillTo: Paint.commands.fillTo,
    strokeTo: Paint.commands.strokeTo,
    erect: {
      args: {},
      entrance: true,
      run: (timeline) => timeline.animate((t) => ({ erected: t }), { eased: false }),
    },
    measure: {
      args: {},
      entrance: true,
      run: (timeline) => timeline.animate((t) => ({ measured: t }), { eased: false }),
    },
  },
  render: (ctx, s) => {
    const p = ctx.declaring ? 1 : clamp01(s.erected)
    if (p <= 0) return
    const g = new Graphics3D()
    const nx = Math.max(1, Math.round(s.baysX))
    const nz = Math.max(1, Math.round(s.baysZ))
    const storeys = Math.max(1, Math.round(s.storeys))
    const bay = s.bay
    const W = nx * bay
    const D = nz * bay
    const H = storeys * STOREY
    const x = (i: number) => -W / 2 + i * bay
    const z = (j: number) => -D / 2 + j * bay
    const ink = colorOf(s.stroke[0]?.fill) ?? ([0, 0, 0, 1] as Rgba)
    const columns: Transform3D[] = []
    const beams: Transform3D[] = []
    const braces: Transform3D[] = []
    const edges: [Vec, Vec][] = []
    // Pad footings show from the start.
    const pads: Transform3D[] = []
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) pads.push(plate([x(i) - 0.06, -0.015, z(j)], [x(i) + 0.06, -0.015, z(j)], 0.03, 0.12))
    painted(g, s.slabs, pads, (c) => mix(c, ink, 0.25))
    for (let k = 0; k < storeys; k++) {
      const t = p * storeys - k
      if (t <= 0) break
      const y0 = k * STOREY
      const y1 = (k + 1) * STOREY
      const up = span(t, 0, 0.4)
      const across = span(t, 0.3, 0.7)
      const deck = span(t, 0.6, 1)
      const cross = span(t, 0.5, 0.9)
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) grow(columns, [x(i), y0, z(j)], [x(i), y1, z(j)], up, MEMBER)
      for (let j = 0; j <= nz; j++) for (let i = 0; i < nx; i++) grow(beams, [x(i), y1, z(j)], [x(i + 1), y1, z(j)], across, MEMBER * 0.85)
      for (let i = 0; i <= nx; i++) for (let j = 0; j < nz; j++) grow(beams, [x(i), y1, z(j)], [x(i), y1, z(j + 1)], across, MEMBER * 0.85)
      for (const j of [0, nz]) {
        for (const i of [0, nx - 1]) {
          grow(braces, [x(i), y0, z(j)], [x(i + 1), y1, z(j)], cross, MEMBER * 0.55)
          grow(braces, [x(i + 1), y0, z(j)], [x(i), y1, z(j)], cross, MEMBER * 0.55)
        }
      }
      if (deck > 0) {
        const lift = (1 - easeOut(deck)) * STOREY * 0.35
        const top = y1 + 0.012 + lift
        const o = bay * 0.08
        body(g, boxFaces(-W / 2 - o, top - 0.024, -D / 2 - o, W / 2 + o, top, D / 2 + o), s.slabs, deck)
        if (deck > 0.98) edges.push(...prismEdges([[-W / 2 - o, top - 0.024], [W / 2 + o, top - 0.024], [W / 2 + o, top], [-W / 2 - o, top]], -D / 2 - o, D / 2 + o))
      }
    }
    painted(g, s.fill, columns)
    painted(g, s.fill, beams, (c) => mix(c, ink, 0.2))
    painted(g, s.braces, braces)
    lines(g, s.stroke, edges)
    const shown = clamp01(s.measured)
    const pen = (s.dimensions[0]?.weight ?? 0) * 0.001
    if (pen > 0 && p >= 1 && shown > 0) {
      const u = dimensionScale(pen)
      const mirror = Math.cos((s.rotationY * Math.PI) / 180) < 0
      const bars: Transform3D[] = []
      dimension(bars, [-W / 2, 0, D / 2], [W / 2, 0, D / 2], [0, -0.08 * u, 0], shown, u, pen, mirror, metres(W))
      dimension(bars, [W / 2, 0, D / 2], [W / 2, H, D / 2], [0.1 * u, 0, 0], shown, u, pen, mirror, metres(H))
      drawDimensions(g, s.dimensions, bars, shown)
    }
    ctx.draw(g)
  },
})
