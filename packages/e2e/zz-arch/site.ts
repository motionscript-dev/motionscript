import { Graphics3D, Paint, Types, component3d, type Transform3D } from "@motionscript/sdk"
import { OUTLINE, PLATE, body, boxFaces, clamp01, easeOut, lines, prismEdges, span, type Vec } from "./cad-kit"

/** How thick the plate is, in drawing units of ten metres. */
const THICK = 0.12

/** The ruled plate a massing model stands on: it rises out of the paper, then its grid is ruled from the middle outward. */
export default component3d({
  key: "sitePlate",
  state: {
    /** The plate. */
    fill: Types.fill(PLATE),
    /** The plate's edges. */
    stroke: Types.stroke(OUTLINE),
    width: Types.number(6, { min: 1, max: 30, step: 0.1, animatable: false }),
    depth: Types.number(4, { min: 1, max: 30, step: 0.1, animatable: false }),
    /** The ruled grid's cell, in drawing units of ten metres. */
    cell: Types.number(0.25, { min: 0.05, max: 2, step: 0.01, animatable: false }),
    /** The ruled grid; empty draws none. */
    grid: Types.stroke({ weight: 2.75, fill: "#1A223038" }),
    laid: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
  },
  commands: {
    fillTo: Paint.commands.fillTo,
    strokeTo: Paint.commands.strokeTo,
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
    const rise = easeOut(span(p, 0, 0.35))
    const t: Transform3D = { position: [0, -THICK * (1 - rise), 0] }
    body(g, boxFaces(-W / 2, -THICK, -D / 2, W / 2, 0, D / 2), s.fill, rise, t)
    lines(g, s.stroke, prismEdges([[-W / 2, -THICK], [W / 2, -THICK], [W / 2, 0], [-W / 2, 0]], -D / 2, D / 2), { fade: rise, transform: t })
    const rule = span(p, 0.3, 0.75)
    if (rule > 0) {
      const ruled: [Vec, Vec][] = []
      const c = Math.max(0.02, s.cell)
      const within = (v: number, half: number) => Math.abs(v) <= half * easeOut(rule) + 1e-6
      for (let x = -Math.floor(W / 2 / c) * c; x <= W / 2 + 1e-6; x += c) {
        if (Math.abs(x) >= W / 2 - 1e-6 || !within(x, W / 2)) continue
        ruled.push([[x, 0.001, -D / 2], [x, 0.001, D / 2]])
      }
      for (let z = -Math.floor(D / 2 / c) * c; z <= D / 2 + 1e-6; z += c) {
        if (Math.abs(z) >= D / 2 - 1e-6 || !within(z, D / 2)) continue
        ruled.push([[-W / 2, 0.001, z], [W / 2, 0.001, z]])
      }
      lines(g, s.grid, ruled)
    }
    ctx.draw(g)
  },
})

