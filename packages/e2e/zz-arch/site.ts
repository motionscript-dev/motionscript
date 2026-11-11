import { Graphics3D, Types, component3d, type Transform3D } from "@motionscript/sdk"
import { BAR, PAINTED, bar, boxFaces, clamp01, dashed, easeOut, flat, prismEdges, shaded, solid, span, type Rgba, type Vec } from "./cad-kit"

const THICK = 0.12

export default component3d({
  key: "sitePlate",
  state: {
    width: Types.number(6, { min: 1, max: 30, step: 0.1, animatable: false }),
    depth: Types.number(4, { min: 1, max: 30, step: 0.1, animatable: false }),
    /** The ruled grid's cell, in drawing units of ten metres. */
    cell: Types.number(0.25, { min: 0.05, max: 2, step: 0.01, animatable: false }),
    color: Types.color("#E4E1D8"),
    gridColor: Types.color("#1A2230"),
    lineColor: Types.color("#1A2230"),
    /** The plot being built on, outlined in dashes. */
    plot: Types.boolean(true, { animatable: false }),
    plotX: Types.number(0, { step: 0.05, animatable: false }),
    plotZ: Types.number(0, { step: 0.05, animatable: false }),
    plotWidth: Types.number(1.6, { min: 0.1, step: 0.05, animatable: false }),
    plotDepth: Types.number(1.2, { min: 0.1, step: 0.05, animatable: false }),
    plotColor: Types.color("#E8642C"),
    lineWidth: Types.number(1, { min: 0.25, max: 6, step: 0.05 }),
    laid: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
  },
  commands: {
    lay: {
      args: {},
      entrance: true,
      run: (timeline) => timeline.animate((t) => ({ laid: t }), { eased: false }),
    },
  },
  render: (ctx, s) => {
    const p = ctx.declaring ? 1 : clamp01(s.laid)
    if (p <= 0) return
    const g = new Graphics3D()
    const W = s.width
    const D = s.depth
    const line = s.lineColor as unknown as Rgba
    const grid = s.gridColor as unknown as Rgba
    const lw = 0.0055 * Math.max(0.1, s.lineWidth)
    // The plate rises out of the paper, then its grid is ruled from the middle outward, then the plot is pegged out.
    const rise = easeOut(span(p, 0, 0.35))
    const y = -THICK * (1 - rise)
    const t = { position: [0, y, 0] as Vec }
    solid(g, shaded(boxFaces(-W / 2, -THICK, -D / 2, W / 2, 0, D / 2), s.color as unknown as Rgba), PAINTED, rise, t)
    const edge = prismEdges([[-W / 2, -THICK], [W / 2, -THICK], [W / 2, 0], [-W / 2, 0]], -D / 2, D / 2)
    g.instances(BAR, flat([line[0], line[1], line[2], rise]), edge.map(([a, b]) => bar(a, b, lw, lw / 2)), { transform: t })
    const rule = span(p, 0.3, 0.75)
    if (rule > 0) {
      const lines: Transform3D[] = []
      const c = Math.max(0.02, s.cell)
      const ruled = (v: number, half: number) => Math.abs(v) <= half * easeOut(rule) + 1e-6
      for (let x = -Math.floor(W / 2 / c) * c; x <= W / 2 + 1e-6; x += c) {
        if (Math.abs(x) >= W / 2 - 1e-6 || !ruled(x, W / 2)) continue
        lines.push(bar([x, 0.001, -D / 2], [x, 0.001, D / 2], lw * 0.5))
      }
      for (let z = -Math.floor(D / 2 / c) * c; z <= D / 2 + 1e-6; z += c) {
        if (Math.abs(z) >= D / 2 - 1e-6 || !ruled(z, D / 2)) continue
        lines.push(bar([-W / 2, 0.001, z], [W / 2, 0.001, z], lw * 0.5))
      }
      g.instances(BAR, flat([grid[0], grid[1], grid[2], 0.22]), lines)
    }
    const peg = span(p, 0.7, 1)
    if (s.plot && peg > 0) {
      const x0 = s.plotX - s.plotWidth / 2
      const x1 = s.plotX + s.plotWidth / 2
      const z0 = s.plotZ - s.plotDepth / 2
      const z1 = s.plotZ + s.plotDepth / 2
      const h = 0.003
      const ring: [Vec, Vec][] = [
        [[x0, h, z0], [x1, h, z0]],
        [[x1, h, z0], [x1, h, z1]],
        [[x1, h, z1], [x0, h, z1]],
        [[x0, h, z1], [x0, h, z0]],
      ]
      const tone = s.plotColor as unknown as Rgba
      g.instances(BAR, flat([tone[0], tone[1], tone[2], peg]), dashed(ring, lw * 1.6, 0.06))
    }
    ctx.draw(g)
  },
})
