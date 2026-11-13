import { Paint, component3d } from "@motionscript/sdk"
import { buildingState, drawBuilding } from "./building-kit"

/** A gable-roofed house with a front door, drawn as a CAD model: it rises a storey at a time and is dimensioned in metres. */
export default component3d({
  key: "houseModel",
  state: buildingState(2, 4),
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
  render: (ctx, s) => drawBuilding(ctx, s, "house"),
})
