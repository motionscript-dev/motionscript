import {
  component2d,
  Types,
  type NodeOf,
  type Values,
  // Named so the emitted declaration reaches these through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"

import { ItemGrid, normalizeOrder, RADIAL_DIRECTIONS, radialTurnToTop, type RadialArrangement } from "../kit"

const own = {
  radius: Types.number(200, { min: 0, step: 1 }),
  startAngle: Types.number(0, { step: 1, unit: "°" }),
  sweep: Types.number(360, { min: -360, max: 360, step: 1, unit: "°" }),
  direction: Types.oneOf(RADIAL_DIRECTIONS, { default: "clockwise" }),
  rotateItems: false,
  spinSpeed: Types.number(0, { step: 1, unit: "°/s" }),
}

type Own = Values<typeof own>

function arrangement(s: Own): RadialArrangement {
  return {
    kind: "radial",
    radius: s.radius,
    startAngle: s.startAngle,
    sweep: s.sweep,
    direction: s.direction,
    rotateItems: s.rotateItems,
    spinSpeed: s.spinSpeed,
  }
}

const arranger: ItemGrid.Arranger<Own> = { arrangement }

/**
 * Children round a circle, or along an arc of one.
 *
 * A full circle spaces the items evenly with none on top of another; an arc
 * puts one at each end. Angles run clockwise from twelve o'clock, so `turnTo`
 * can bring any item to the top like a dial.
 */
export const RadialGrid = ItemGrid.define(component2d({
  key: "radialGrid",
  state: { ...ItemGrid.state, ...own },
  defaults: ItemGrid.defaults,
  commands: {
    ...ItemGrid.commands,
    /** Orbit the items round the centre by `degrees` — `360` is one full turn. */
    spin: {
      args: { degrees: Types.number(360, { step: 15, unit: "°" }) },
      run: (timeline, s) => timeline.tween({ startAngle: s.startAngle + (timeline.args.degrees ?? 360) }),
    },
    /** Turn the ring the shorter way round until an item (by its place in the layers) sits at the top. */
    turnTo: {
      args: { item: Types.number(0, { min: 0, step: 1 }) },
      run: (timeline, s, children) => {
        const count = children.length
        const slot = normalizeOrder(s.order, count).indexOf(Math.round(timeline.args.item ?? 0))
        const turn = slot < 0 ? 0 : radialTurnToTop(arrangement(s), count, slot)
        return timeline.tween({ startAngle: s.startAngle + turn })
      },
    },
    radiusTo: {
      args: { radius: ItemGrid.hinted(280, { min: 0 }) },
      run: (timeline, s) => timeline.tween({ radius: timeline.args.radius ?? s.radius }),
    },
    /** Open or close the arc like a fan — from `0` to `360` is a reveal of its own. */
    sweepTo: {
      args: { sweep: ItemGrid.hinted(360, { min: -360, max: 360, unit: "°" }) },
      run: (timeline, s) => timeline.tween({ sweep: timeline.args.sweep ?? s.sweep }),
    },
  },
  ...ItemGrid.fields(arranger),
}), arranger)

export type RadialGrid = NodeOf<typeof RadialGrid>
/** What a call or a document row may set. */
export type RadialGridProps = NonNullable<Parameters<typeof RadialGrid>[0]>
