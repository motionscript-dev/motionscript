import {
  component2d,
  Types,
  type NodeOf,
  type Values,
  // Named so the emitted declaration reaches these through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"

import {
  ItemGrid,
  normalizeOrder,
  SPHERE_AXES,
  SPHERE_FACINGS,
  sphereFaceForward,
  wrapDegrees,
  type SphereArrangement,
  type SphereAxis,
} from "../kit"

const own = {
  radius: Types.number(220, { min: 0, step: 1 }),
  yaw: Types.number(0, { step: 1, unit: "°" }),
  pitch: Types.number(0, { step: 1, unit: "°" }),
  roll: Types.number(0, { step: 1, unit: "°" }),
  facing: Types.oneOf(SPHERE_FACINGS, { default: "outward" }),
  focalLength: Types.number(900, { min: 100, step: 10 }),
  depthFade: Types.number(0.5, { min: 0, max: 1, step: 0.05 }),
  cullBackfaces: false,
  spinSpeed: Types.number(0, { step: 1, unit: "°/s" }),
}

type Own = Values<typeof own>

function arrangement(s: Own): SphereArrangement {
  return {
    kind: "sphere",
    radius: s.radius,
    yaw: s.yaw,
    pitch: s.pitch,
    roll: s.roll,
    facing: s.facing,
    focalLength: s.focalLength,
    depthFade: s.depthFade,
    cullBackfaces: s.cullBackfaces,
    spinSpeed: s.spinSpeed,
  }
}

const arranger: ItemGrid.Arranger<Own> = { arrangement }

const AXIS_PROP: Record<SphereAxis, "yaw" | "pitch" | "roll"> = { x: "pitch", y: "yaw", z: "roll" }

/**
 * Children spread over a sphere — a Fibonacci lattice, as even as any number
 * of points gets — and seen through a camera of the grid's own, so the far
 * side is smaller, drawn first, and hidden where a face turns away.
 *
 * `outward` lays each item flat on the surface; `billboard` keeps each one
 * facing the viewer, like labels on a globe. `turnTo` brings any item round
 * to the front.
 */
export const SphereGrid = ItemGrid.define(component2d({
  key: "sphereGrid",
  state: { ...ItemGrid.state, ...own },
  defaults: ItemGrid.defaults,
  commands: {
    ...ItemGrid.commands,
    /** Turn the sphere about an axis by `degrees` — `y` spins it like a globe. */
    spin: {
      args: {
        axis: Types.oneOf(SPHERE_AXES, { default: "y" }),
        degrees: Types.number(360, { step: 15, unit: "°" }),
      },
      run: (timeline, s) => {
        const key = AXIS_PROP[timeline.args.axis ?? "y"] ?? "yaw"
        return timeline.tween({ [key]: s[key] + (timeline.args.degrees ?? 360) })
      },
    },
    /** Turn the sphere to a set orientation. */
    orientTo: {
      args: {
        yaw: ItemGrid.hinted(45, { unit: "°" }),
        pitch: ItemGrid.hinted(20, { unit: "°" }),
        roll: ItemGrid.hinted(0, { unit: "°" }),
      },
      run: (timeline, s) => timeline.tween({
        yaw: timeline.args.yaw ?? s.yaw,
        pitch: timeline.args.pitch ?? s.pitch,
        roll: timeline.args.roll ?? s.roll,
      }),
    },
    /**
     * Turn the sphere the shorter way until an item (by its place in the layers)
     * faces the viewer. It turns from the orientation the sphere is given: the
     * yaw its `spinSpeed` adds by the time the command runs is not counted, as
     * commands are built against the tree standing at time 0.
     */
    turnTo: {
      args: { item: Types.number(0, { min: 0, step: 1 }) },
      run: (timeline, s, children) => {
        const count = children.length
        const slot = normalizeOrder(s.order, count).indexOf(Math.round(timeline.args.item ?? 0))
        if (slot < 0) return timeline.tween({})
        const facing = sphereFaceForward(count, slot)
        return timeline.tween({
          yaw: s.yaw + wrapDegrees(facing.yaw - s.yaw),
          pitch: s.pitch + wrapDegrees(facing.pitch - s.pitch),
          roll: 0,
        })
      },
    },
    radiusTo: {
      args: { radius: ItemGrid.hinted(300, { min: 0 }) },
      run: (timeline, s) => timeline.tween({ radius: timeline.args.radius ?? s.radius }),
    },
    /** Dolly the camera: a shorter focal length exaggerates the depth, a longer one flattens it. */
    focalLengthTo: {
      args: { focalLength: ItemGrid.hinted(600, { min: 100 }) },
      run: (timeline, s) => timeline.tween({ focalLength: timeline.args.focalLength ?? s.focalLength }),
    },
  },
  ...ItemGrid.fields(arranger),
}), arranger)

export type SphereGrid = NodeOf<typeof SphereGrid>
