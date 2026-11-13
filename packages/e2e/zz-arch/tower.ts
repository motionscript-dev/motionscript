import { Paint, component3d } from "@motionscript/sdk"
import { buildingState, drawBuilding } from "./building-kit"

/** A glass tower, its walls ruled in mullions, a crown and a mast on top, drawn as a CAD model: it rises a storey at a time and is dimensioned in metres. */
export default component3d({
  key: "towerModel",
  state: buildingState(12, 40),
  commands: {
    fillTo: Paint.commands.fillTo,
    strokeTo: Paint.commands.strokeTo,
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
  render: (ctx, s) => drawBuilding(ctx, s, "tower"),
})
