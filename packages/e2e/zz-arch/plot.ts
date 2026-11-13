import { Graphics3D, Paint, Types, component3d, type Transform3D } from "@motionscript/sdk"
import { ORANGE, body, boxFaces, clamp01, easeOut, lines, type Vec } from "./cad-kit"

/** How far the plot sits above the plate it is pegged out on. */
const LIFT = 0.003

/** The plot a building goes on, pegged out on a site plate in dashes. Place it with its position. */
export default component3d({
  key: "sitePlot",
  state: {
    /** The ground inside the plot; empty shows the plate through it. */
    fill: Types.fill([]),
    /** The dashed boundary. */
    stroke: Types.stroke({ weight: 8.8, fill: ORANGE, dash: [33, 27] }),
    width: Types.number(1.6, { min: 0.1, max: 30, step: 0.05, animatable: false }),
    depth: Types.number(1.2, { min: 0.1, max: 30, step: 0.05, animatable: false }),
    pegged: Types.number(1, { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" }),
  },
  commands: {
    fillTo: Paint.commands.fillTo,
    strokeTo: Paint.commands.strokeTo,
    peg: {
      args: {},
      entrance: true,
      run: (timeline) => timeline.animate((t) => ({ pegged: t }), { eased: false }),
    },
  },
  render: (ctx, s) => {
    const p = ctx.declaring ? 1 : easeOut(clamp01(s.pegged))
    if (p <= 0) return
    const g = new Graphics3D()
    const x = s.width / 2
    const z = s.depth / 2
    const t: Transform3D = { position: [0, LIFT, 0] }
    body(g, boxFaces(-x, -LIFT / 2, -z, x, 0, z), s.fill, p, t)
    const ring: [Vec, Vec][] = [
      [[-x, 0, -z], [x, 0, -z]],
      [[x, 0, -z], [x, 0, z]],
      [[x, 0, z], [-x, 0, z]],
      [[-x, 0, z], [-x, 0, -z]],
    ]
    lines(g, s.stroke, ring, { fade: p, transform: t })
    ctx.draw(g)
  },
})
