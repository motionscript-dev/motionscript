import { Paint, component3d } from "@motionscript/sdk"
import { buildingState, drawBuilding } from "./building-kit"

/** An office block with a plant room set back on its flat roof, drawn as a CAD model: it rises a storey at a time and is dimensioned in metres. */
export default component3d({
  key: "blockModel",
  state: buildingState(5, 20),
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
  render: (ctx, s) => drawBuilding(ctx, s, "block"),
})
