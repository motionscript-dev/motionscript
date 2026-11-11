import { Geo, Graphics3D, Types, component3d, type Transform3D } from "@motionscript/sdk"
import {
  BAR,
  PAINTED,
  bar,
  boxFaces,
  clamp01,
  dimension,
  easeOut,
  flat,
  metres,
  mix,
  prismEdges,
  shaded,
  solid,
  span,
  type Rgba,
  type Vec,
} from "./cad-kit"

type Kind = "frame" | "truss"

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

// --- A building frame -------------------------------------------------------------------

function drawFrame(g: Graphics3D, s: Record<string, any>, p: number, member: Rgba, slabColor: Rgba, brace: Rgba, line: Rgba, lw: number) {
  const nx = Math.max(1, Math.round(s.baysX))
  const nz = Math.max(1, Math.round(s.baysZ))
  const storeys = Math.max(1, Math.round(s.storeys))
  const bay = s.bay
  const sh = s.storeyHeight
  const W = nx * bay
  const D = nz * bay
  const x = (i: number) => -W / 2 + i * bay
  const z = (j: number) => -D / 2 + j * bay
  const cw = lw * 5
  const columns: Transform3D[] = []
  const beams: Transform3D[] = []
  const braces: Transform3D[] = []
  const edges: [Vec, Vec][] = []
  // Pad footings show from the start.
  const pads: Transform3D[] = []
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) pads.push(plate([x(i) - 0.06, -0.015, z(j)], [x(i) + 0.06, -0.015, z(j)], 0.03, 0.12))
  g.instances(BAR, flat(mix(slabColor, line, 0.25)), pads)
  for (let k = 0; k < storeys; k++) {
    const t = p * storeys - k
    if (t <= 0) break
    const y0 = k * sh
    const y1 = (k + 1) * sh
    const up = span(t, 0, 0.4)
    const across = span(t, 0.3, 0.7)
    const deck = span(t, 0.6, 1)
    const cross = span(t, 0.5, 0.9)
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) grow(columns, [x(i), y0, z(j)], [x(i), y1, z(j)], up, cw)
    for (let j = 0; j <= nz; j++) for (let i = 0; i < nx; i++) grow(beams, [x(i), y1, z(j)], [x(i + 1), y1, z(j)], across, cw * 0.85)
    for (let i = 0; i <= nx; i++) for (let j = 0; j < nz; j++) grow(beams, [x(i), y1, z(j)], [x(i), y1, z(j + 1)], across, cw * 0.85)
    // Cross-bracing in the end bays of the two long faces.
    for (const j of [0, nz]) {
      for (const i of [0, nx - 1]) {
        grow(braces, [x(i), y0, z(j)], [x(i + 1), y1, z(j)], cross, cw * 0.55)
        grow(braces, [x(i + 1), y0, z(j)], [x(i), y1, z(j)], cross, cw * 0.55)
      }
    }
    if (deck > 0) {
      const lift = (1 - easeOut(deck)) * sh * 0.35
      const top = y1 + 0.012 + lift
      const o = bay * 0.08
      solid(g, shaded(boxFaces(-W / 2 - o, top - 0.024, -D / 2 - o, W / 2 + o, top, D / 2 + o), slabColor), PAINTED, deck)
      if (deck > 0.98) edges.push(...prismEdges([[-W / 2 - o, top - 0.024], [W / 2 + o, top - 0.024], [W / 2 + o, top], [-W / 2 - o, top]], -D / 2 - o, D / 2 + o))
    }
  }
  g.instances(BAR, flat(member), columns)
  if (beams.length) g.instances(BAR, flat(mix(member, line, 0.2)), beams)
  if (braces.length) g.instances(BAR, flat(brace), braces)
  if (edges.length) g.instances(BAR, flat(line), edges.map(([a, b]) => bar(a, b, lw * 0.6, lw * 0.3)))
  return { W, D, H: storeys * sh }
}

// --- A truss bridge ----------------------------------------------------------------------

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

function drawTruss(g: Graphics3D, s: Record<string, any>, p: number, member: Rgba, slabColor: Rgba, line: Rgba, lw: number) {
  const n = Math.max(4, Math.round(s.panels / 2) * 2)
  const a = s.bay
  const h = s.storeyHeight * 1.7
  const L = n * a
  const wide = Math.max(0.3, s.baysZ * a * 0.7)
  const loaded = clamp01(s.loaded)
  const sag = s.deflection * loaded
  const node = (i: number, side: number): Vec => {
    const x = i <= n ? i * a : (i - n) * a
    const y = i <= n ? 0 : h
    return [x - L / 2, y - sag * Math.sin((Math.PI * x) / L), side * wide / 2]
  }
  const members = pratt(n, a, h)
  const peak = Math.max(...members.map((m) => Math.abs(m.f)))
  const tension = s.tensionColor as unknown as Rgba
  const compression = s.compressionColor as unknown as Rgba
  const when: Record<Member["group"], [number, number]> = {
    bottom: [0.08, 0.35],
    vertical: [0.3, 0.55],
    post: [0.35, 0.55],
    diagonal: [0.45, 0.7],
    top: [0.6, 0.85],
  }
  const base = lw * 5
  for (const m of members) {
    const [from, until] = when[m.group]
    // Members go up from the left, each a little after the one before.
    const along = Math.min(node(m.a, 1)[0], node(m.b, 1)[0]) / L + 0.5
    const t = span(p, from + (until - from) * 0.5 * along, from + (until - from) * (0.5 + 0.5 * along))
    if (t <= 0) continue
    const k = Math.abs(m.f) / peak
    const tone = Math.abs(m.f) < 1e-6 ? member : mix(member, m.f > 0 ? tension : compression, loaded * (0.4 + 0.6 * k))
    const w = (m.group === "bottom" || m.group === "top" || m.group === "post" ? base : base * 0.7) * (1 + 0.6 * loaded * k)
    const bars: Transform3D[] = []
    for (const side of [-1, 1]) grow(bars, node(m.a, side), node(m.b, side), t, w)
    g.instances(BAR, flat(tone), bars)
  }
  // Floor beams and the deck between the two trusses; struts and lateral bracing over the top.
  const floor: Transform3D[] = []
  const struts: Transform3D[] = []
  const deck = span(p, 0.05, 0.3)
  const lid = span(p, 0.82, 1)
  for (let i = 0; i <= n; i++) grow(floor, node(i, -1), node(i, 1), span(deck, i / (n + 1), (i + 1) / (n + 1)), base * 0.6)
  for (let i = 1; i < n; i++) grow(struts, node(n + i, -1), node(n + i, 1), lid, base * 0.5)
  for (let i = 1; i < n - 1; i++) {
    grow(struts, node(n + i, -1), node(n + i + 1, 1), lid, base * 0.35)
    grow(struts, node(n + i, 1), node(n + i + 1, -1), lid, base * 0.35)
  }
  const quiet = mix(member, line, 0.15)
  if (floor.length) g.instances(BAR, flat(quiet), floor)
  if (struts.length) g.instances(BAR, flat(quiet), struts)
  if (deck > 0) {
    const plates: Transform3D[] = []
    for (let i = 0; i < n; i++) {
      const t = span(deck, i / n, (i + 1) / n)
      if (t <= 0) continue
      const a0 = node(i, 0)
      const a1 = node(i + 1, 0)
      const end = lerp3(a0, a1, t)
      plates.push(plate([a0[0], a0[1] - 0.012, 0], [end[0], end[1] - 0.012, 0], 0.016, wide + 0.04))
    }
    g.instances(BAR, flat(slabColor), plates)
  }
  // Abutments and bearings at each end.
  const ground = span(p, 0, 0.08)
  if (ground > 0) {
    const abut = shaded(boxFaces(-0.22, -0.55, -wide / 2 - 0.12, 0.22, -0.05, wide / 2 + 0.12), slabColor)
    for (const end of [-1, 1]) {
      const x = end * (L / 2 + 0.1)
      solid(g, abut, PAINTED, ground, { position: [x, 0, 0] })
      g.instances(
        BAR,
        flat([line[0], line[1], line[2], ground]),
        prismEdges([[-0.22, -0.55], [0.22, -0.55], [0.22, -0.05], [-0.22, -0.05]], -wide / 2 - 0.12, wide / 2 + 0.12).map(([u, v]) =>
          bar([u[0] + x, u[1], u[2]], [v[0] + x, v[1], v[2]], lw * 0.6, lw * 0.3),
        ),
      )
      for (const side of [-1, 1]) {
        g.mesh(BEARING, flat(mix(member, line, 0.4)), { position: [end * L / 2, -0.04, (side * wide) / 2], scale: [1, 1, 1] })
      }
    }
  }
  // The load: a row of arrows coming down onto the top chord, joined at their tails.
  if (loaded > 0.001) {
    const drop = (1 - easeOut(loaded)) * 0.25
    const arrows: Transform3D[] = []
    const reach = 0.42
    for (let i = 1; i < n; i++) {
      const tip = node(n + i, 0)
      const at: Vec = [tip[0], tip[1] + 0.06 + drop, 0]
      const tail: Vec = [at[0], h + 0.06 + drop + reach, 0]
      arrows.push(bar(tail, at, lw * 1.6))
      arrows.push(bar(at, [at[0] - 0.035, at[1] + 0.06, 0], lw * 1.6), bar(at, [at[0] + 0.035, at[1] + 0.06, 0], lw * 1.6))
    }
    const first = node(n + 1, 0)
    const last = node(2 * n - 1, 0)
    arrows.push(bar([first[0], h + 0.06 + drop + reach, 0], [last[0], h + 0.06 + drop + reach, 0], lw * 1.6))
    const ink = s.loadColor as unknown as Rgba
    g.instances(BAR, flat([ink[0], ink[1], ink[2], loaded]), arrows)
  }
  return { L, h }
}

const BEARING = Geo.cone({ radius: 0.06, height: 0.08, segments: [4, 1] })

export default component3d({
  key: "structure",
  state: {
    kind: Types.oneOf(["frame", "truss"] as const, { animatable: false }),
    /** Bays along the front (a frame). */
    baysX: Types.number(3, { min: 1, max: 12, step: 1, animatable: false }),
    /** Bays front to back (a frame); for a truss, how wide its deck is. */
    baysZ: Types.number(2, { min: 1, max: 12, step: 1, animatable: false }),
    storeys: Types.number(4, { min: 1, max: 30, step: 1, animatable: false }),
    /** Panels along a truss; rounded to an even number. */
    panels: Types.number(8, { min: 4, max: 20, step: 2, animatable: false }),
    bay: Types.number(0.6, { min: 0.1, max: 2, step: 0.01, animatable: false }),
    storeyHeight: Types.number(0.36, { min: 0.1, max: 1, step: 0.01, animatable: false }),
    color: Types.color("#5B6B82"),
    slabColor: Types.color("#E4E1D8"),
    braceColor: Types.color("#E8642C"),
    lineColor: Types.color("#1A2230"),
    tensionColor: Types.color("#2563EB"),
    compressionColor: Types.color("#E8642C"),
    loadColor: Types.color("#1A2230"),
    lineWidth: Types.number(1, { min: 0.25, max: 6, step: 0.05 }),
    /** How far a fully loaded truss sags at midspan, exaggerated as an analysis plot is. */
    deflection: Types.number(0.12, { min: 0, max: 1, step: 0.01 }),
    dimensions: Types.boolean(false, { animatable: false }),
    /** How large the dimensions are drawn: arrows, offsets and lettering together. */
    labelSize: Types.number(1.6, { min: 0.5, max: 8, step: 0.1 }),
    erected: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    loaded: Types.number(0, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
    measured: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
  },
  commands: {
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
    const line = s.lineColor as unknown as Rgba
    const lw = 0.0055 * Math.max(0.1, s.lineWidth)
    const member = s.color as unknown as Rgba
    const slab = s.slabColor as unknown as Rgba
    const shown = clamp01(s.measured)
    const mirror = Math.cos((s.rotationY * Math.PI) / 180) < 0
    const bars: Transform3D[] = []
    if (s.kind === "truss") {
      const { L, h } = drawTruss(g, s, p, member, slab, line, lw)
      if (s.dimensions && p >= 1 && shown > 0) {
        const u = Math.max(0.2, s.labelSize)
        const wide = Math.max(0.3, s.baysZ * s.bay * 0.7)
        dimension(bars, [-L / 2, -0.55, wide / 2 + 0.12], [L / 2, -0.55, wide / 2 + 0.12], [0, -0.08 * u, 0], shown, u, mirror, metres(L))
        dimension(bars, [L / 2, 0, wide / 2], [L / 2, h, wide / 2], [0.1 * u, 0, 0], shown, u, mirror, metres(h))
      }
    } else {
      const { W, D, H } = drawFrame(g, s, p, member, slab, s.braceColor as unknown as Rgba, line, lw)
      if (s.dimensions && p >= 1 && shown > 0) {
        const u = Math.max(0.2, s.labelSize)
        dimension(bars, [-W / 2, 0, D / 2], [W / 2, 0, D / 2], [0, -0.08 * u, 0], shown, u, mirror, metres(W))
        dimension(bars, [W / 2, 0, D / 2], [W / 2, H, D / 2], [0.1 * u, 0, 0], shown, u, mirror, metres(H))
      }
    }
    if (bars.length) g.instances(BAR, flat([line[0], line[1], line[2], shown]), bars)
    ctx.draw(g)
  },
})
