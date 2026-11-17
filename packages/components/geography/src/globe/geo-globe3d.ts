import {
    Graphics3D,
    Paint3D,
    Types,
    component3d,
    type NodeOf,
    // Named so this component's emitted type reaches the 3D node surface it builds on through the sdk, not core.
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type Node3D as _Node3D,
    type Node3DProps as _Node3DProps,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk"

import { drawGlobe, globeCommands, globeState, hinted, loadGlobe, wrapDegrees } from "./scene"

const FRACTION = { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" } as const

// A canvas camera usually stands 5 to 10 radii off: the depth rule's gap (distance ÷ 2000) is then at most 0.005 of the radius.
const GAP = 0.005

/**
 * The whole world on a sphere of `radius` in a 3D scene, turned so
 * `longitude`/`latitude` faces +z; the node's own rotation tilts it.
 *
 * The same globe as `geoGlobe`: `fill` paints the ocean, `land`, `coast`,
 * `graticule` (over the sea only) and `highlightFill` the rest, and
 * `start`/`end` draw the lines on. A fill's pixels and a line's weight are
 * thousandths of a scene unit, as for every 3D line.
 */
export const GeoGlobe3d = component3d({
    key: "geoGlobe3d",
    state: {
        fill: Paint3D.state.fill,
        ...globeState,
        radius: Types.number(1, { min: 0.01, step: 0.1 }),
        start: Types.number(0, FRACTION),
        end: Types.number(1, FRACTION),
    },
    defaults: { fill: "#1f4e79" },
    load: (loader, state) => loadGlobe(loader, state),
    commands: {
        fillTo: Paint3D.commands.fillTo,
        ...globeCommands,
        progressTo: { args: ["start", "end"] },
        /** Turn the globe the shorter way until `longitude`/`latitude` faces +z; a value left out stays as it is. */
        turnTo: {
            args: { longitude: hinted(0), latitude: hinted(20) },
            run: (timeline, s) => {
                const { longitude, latitude } = timeline.args
                return timeline.tween({
                    longitude: longitude === undefined ? s.longitude : s.longitude + wrapDegrees(longitude - s.longitude),
                    latitude: latitude === undefined ? s.latitude : Math.max(-90, Math.min(90, latitude)),
                })
            },
        },
        /** Turn the globe about its axis by `degrees`, the way the Earth turns when positive. */
        spin: {
            args: { degrees: Types.number(360, { step: 15, unit: "°" }) },
            run: (timeline, s) => timeline.tween({ longitude: s.longitude - (timeline.args.degrees ?? 360) }),
        },
    },
    render: (ctx, s) => {
        const g3 = new Graphics3D()
        if (ctx.declaring) g3.sphere({ radius: s.radius })
        else drawGlobe(g3, s, { radius: s.radius, unit: Paint3D.STROKE_UNIT, gap: GAP })
        ctx.draw(g3)
    },
})

export type GeoGlobe3d = NodeOf<typeof GeoGlobe3d>
