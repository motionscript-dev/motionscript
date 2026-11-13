import { Geo, Graphics3D, Paint, Types, component3d, type Transform3D } from "@motionscript/sdk"
import {
  BAR,
  BLUE,
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

/** How deep the truss is, in drawing units of ten metres. */
const DEPTH = 0.612
/** How far a fully loaded truss sags at midspan, exaggerated as an analysis plot is. */
const SAG = 0.12
/** How thick a chord is; the web members are a share of it. */
const MEMBER = 0.0275

const lerp3 = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function grow(out: Transform3D[], a: Vec, b: Vec, t: number, w: number): void {
  if (t <= 0.001) return
  out.push(bar(a, lerp3(a, b, easeOut(t)), w, w / 2))
}

function plate(a: Vec, b: Vec, thick: number, wide: number): Transform3D {
  const t = bar(a, b, thick)
  return { ...t, scale: [(t.scale as Vec)[0], thick, wide] }
}

interface Member {
  a: number
  b: number
  /** Axial force under a unit panel load, tension positive. */
  f: number
  group: "bottom" | "post" | "vertical" | "diagonal" | "top"
}

/**
 * A Pratt truss of `n` panels: nodes 0..n along the bottom chord, then n+1.. for the top
 * nodes over 1..n-1. Forces are the classic hand calculation for equal loads at the
 * bottom panel points: chords from the bending moment, web members from the shear.
 */
function pratt(n: number, a: number, h: number): Member[] {
  const P = 1
  const R = (P * (n - 1)) / 2
  const M = (j: number) => P * a * ((n - 1) / 2 * j - (j * (j - 1)) / 2)
  const V = (i: number) => R - P * i
  const top = (i: number) => n + i
  const diag = Math.hypot(a, h)
  const half = (i: number) => Math.min(i, n - i)
  const out: Member[] = []
  for (let i = 0; i < n; i++) {
    const m = Math.min(i, n - 1 - i)
    out.push({ a: i, b: i + 1, f: M(Math.max(1, m)) / h, group: "bottom" })
  }
  for (let i = 1; i < n - 1; i++) {
    const m = Math.min(i + 1, n - i)
    out.push({ a: top(i), b: top(i + 1), f: -M(m) / h, group: "top" })
  }
  out.push({ a: 0, b: top(1), f: (-R * diag) / h, group: "post" }, { a: n, b: top(n - 1), f: (-R * diag) / h, group: "post" })
  for (let i = 1; i < n; i++) {
    const k = half(i)
    const f = k === 1 ? P : 2 * k === n ? P - 2 * V(k - 1) : P - V(k - 1)
    out.push({ a: i, b: top(i), f, group: "vertical" })
  }
  for (let i = 1; i < n / 2; i++) {
    const f = (V(i) * diag) / h
    out.push({ a: top(i), b: i + 1, f, group: "diagonal" }, { a: top(n - i), b: n - i - 1, f, group: "diagonal" })
  }
  return out
}

const BEARING = Geo.cone({ radius: 0.06, height: 0.08, segments: [4, 1] })
const ABUTMENT = [[-0.22, -0.55], [0.22, -0.55], [0.22, -0.05], [-0.22, -0.05]] as const

/** A Pratt truss footbridge: put up member by member, its members tinted by tension and compression under load. */
export default component3d({
  key: "trussBridge",
  state: {
    /** The members, unloaded. */
    fill: Types.fill(STEEL),
    /** The abutments' edges. */
    stroke: Types.stroke({ weight: 3.3, fill: INK, cap: "square" }),
    /** Panels along the span; rounded to an even number. */
    panels: Types.number(8, { min: 4, max: 20, step: 2, animatable: false }),
    /** One panel, in drawing units of ten metres. */
    bay: Types.number(0.5, { min: 0.1, max: 2, step: 0.01, animatable: false }),
    /** The deck's width, front to back. */
    width: Types.number(0.7, { min: 0.3, max: 4, step: 0.05, animatable: false }),
    /** The deck and abutments. */
    deck: Types.fill(PLATE),
    /** What a member in tension turns under load. */
    tension: Types.fill(BLUE),
    /** What a member in compression turns under load. */
    compression: Types.fill(ORANGE),
    /** The arrows the load comes down as. */
    arrows: Types.stroke({ weight: 8.8, fill: INK }),
    /** Drafting dimensions for its span and depth, in metres; empty draws none. */
    dimensions: Types.stroke([]),
    erected: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    loaded: Types.number(0, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
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
    load: (timeline) => timeline.tween({ loaded: 1 }),
    unload: (timeline) => timeline.tween({ loaded: 0 }),
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
    const ink = colorOf(s.stroke[0]?.fill) ?? ([0, 0, 0, 1] as Rgba)
    const member = colorOf(s.fill) ?? ([0.36, 0.42, 0.51, 1] as Rgba)
    const tension = colorOf(s.tension) ?? member
    const compression = colorOf(s.compression) ?? member
    const n = Math.max(4, Math.round(s.panels / 2) * 2)
    const a = s.bay
    const h = DEPTH
    const L = n * a
    const wide = Math.max(0.3, s.width)
    const loaded = clamp01(s.loaded)
    const sag = SAG * loaded
    const node = (i: number, side: number): Vec => {
      const x = i <= n ? i * a : (i - n) * a
      const y = i <= n ? 0 : h
      return [x - L / 2, y - sag * Math.sin((Math.PI * x) / L), (side * wide) / 2]
    }
    const members = pratt(n, a, h)
    const peak = Math.max(...members.map((m) => Math.abs(m.f)))
    const when: Record<Member["group"], [number, number]> = {
      bottom: [0.08, 0.35],
      vertical: [0.3, 0.55],
      post: [0.35, 0.55],
      diagonal: [0.45, 0.7],
      top: [0.6, 0.85],
    }
    for (const m of members) {
      const [from, until] = when[m.group]
      // Members go up from the left, each a little after the one before.
      const along = Math.min(node(m.a, 1)[0], node(m.b, 1)[0]) / L + 0.5
      const t = span(p, from + (until - from) * 0.5 * along, from + (until - from) * (0.5 + 0.5 * along))
      if (t <= 0) continue
      const k = Math.abs(m.f) / peak
      const tone = Math.abs(m.f) < 1e-6 ? member : mix(member, m.f > 0 ? tension : compression, loaded * (0.4 + 0.6 * k))
      const w = (m.group === "bottom" || m.group === "top" || m.group === "post" ? MEMBER : MEMBER * 0.7) * (1 + 0.6 * loaded * k)
      const bars: Transform3D[] = []
      for (const side of [-1, 1]) grow(bars, node(m.a, side), node(m.b, side), t, w)
      g.instances(BAR, flat(tone), bars)
    }
    // Floor beams and the deck between the two trusses; struts and lateral bracing over the top.
    const floor: Transform3D[] = []
    const struts: Transform3D[] = []
    const laid = span(p, 0.05, 0.3)
    const lid = span(p, 0.82, 1)
    for (let i = 0; i <= n; i++) grow(floor, node(i, -1), node(i, 1), span(laid, i / (n + 1), (i + 1) / (n + 1)), MEMBER * 0.6)
    for (let i = 1; i < n; i++) grow(struts, node(n + i, -1), node(n + i, 1), lid, MEMBER * 0.5)
    for (let i = 1; i < n - 1; i++) {
      grow(struts, node(n + i, -1), node(n + i + 1, 1), lid, MEMBER * 0.35)
      grow(struts, node(n + i, 1), node(n + i + 1, -1), lid, MEMBER * 0.35)
    }
    const quiet = flat(mix(member, ink, 0.15))
    if (floor.length) g.instances(BAR, quiet, floor)
    if (struts.length) g.instances(BAR, quiet, struts)
    const deck = colorOf(s.deck)
    if (laid > 0 && deck) {
      const plates: Transform3D[] = []
      for (let i = 0; i < n; i++) {
        const t = span(laid, i / n, (i + 1) / n)
        if (t <= 0) continue
        const a0 = node(i, 0)
        const a1 = node(i + 1, 0)
        const end = lerp3(a0, a1, t)
        plates.push(plate([a0[0], a0[1] - 0.012, 0], [end[0], end[1] - 0.012, 0], 0.016, wide + 0.04))
      }
      g.instances(BAR, flat(deck), plates)
    }
    // Abutments and bearings at each end.
    const ground = span(p, 0, 0.08)
    if (ground > 0) {
      const faces = boxFaces(-0.22, -0.55, -wide / 2 - 0.12, 0.22, -0.05, wide / 2 + 0.12)
      for (const end of [-1, 1]) {
        const x = end * (L / 2 + 0.1)
        body(g, faces, s.deck, ground, { position: [x, 0, 0] })
        lines(g, s.stroke, prismEdges(ABUTMENT, -wide / 2 - 0.12, wide / 2 + 0.12), { fade: ground, transform: { position: [x, 0, 0] } })
        for (const side of [-1, 1]) {
          g.mesh(BEARING, flat(mix(member, ink, 0.4)), { position: [(end * L) / 2, -0.04, (side * wide) / 2] })
        }
      }
    }
    // The load: a row of arrows coming down onto the top chord, joined at their tails.
    if (loaded > 0.001) {
      const drop = (1 - easeOut(loaded)) * 0.25
      const arrows: [Vec, Vec][] = []
      const reach = 0.42
      for (let i = 1; i < n; i++) {
        const tip = node(n + i, 0)
        const at: Vec = [tip[0], tip[1] + 0.06 + drop, 0]
        const tail: Vec = [at[0], h + 0.06 + drop + reach, 0]
        arrows.push([tail, at], [at, [at[0] - 0.035, at[1] + 0.06, 0]], [at, [at[0] + 0.035, at[1] + 0.06, 0]])
      }
      const first = node(n + 1, 0)
      const last = node(2 * n - 1, 0)
      arrows.push([[first[0], h + 0.06 + drop + reach, 0], [last[0], h + 0.06 + drop + reach, 0]])
      lines(g, s.arrows, arrows, { fade: loaded })
    }
    const shown = clamp01(s.measured)
    const pen = (s.dimensions[0]?.weight ?? 0) * 0.001
    if (pen > 0 && p >= 1 && shown > 0) {
      const u = dimensionScale(pen)
      const mirror = Math.cos((s.rotationY * Math.PI) / 180) < 0
      const bars: Transform3D[] = []
      dimension(bars, [-L / 2, -0.55, wide / 2 + 0.12], [L / 2, -0.55, wide / 2 + 0.12], [0, -0.08 * u, 0], shown, u, pen, mirror, metres(L))
      dimension(bars, [L / 2, 0, wide / 2], [L / 2, h, wide / 2], [0.1 * u, 0, 0], shown, u, pen, mirror, metres(h))
      drawDimensions(g, s.dimensions, bars, shown)
    }
    ctx.draw(g)
  },
})
