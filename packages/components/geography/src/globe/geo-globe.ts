import {
    Fills,
    Flow,
    Graphics2D,
    Graphics3D,
    Paint,
    Scene3D,
    Types,
    View3D,
    component2d,
    type NodeOf,
    type Size2D,
    // Named so this component's emitted type reaches the shape surface it spreads through the sdk, not core.
    type Alignment as _Alignment,
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type FlowMode as _FlowMode,
    type FlowResolved as _FlowResolved,
    type GapSize as _GapSize,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
    type Vector2 as _Vector2,
} from "@motionscript/sdk"

import { drawGlobe, globeCommands, globeState, hinted, loadGlobe, wrapDegrees, type GlobeValues } from "./scene"

const { overlay: _overlay, ...paintState } = Paint.state
const { overlayTo: _overlayTo, ...paintCommands } = Paint.commands

// The camera sits this far out: the depth rule's gap (distance ÷ 2000) is then 0.0015 of the radius.
const CAMERA_DISTANCE = 3
const GAP = 0.002

/** The globe as a 3D scene seen square-on through a camera with no perspective, so the sphere is the box's inscribed circle. */
function sceneOf(s: GlobeValues, diameter: number): Scene3D | null {
    const g3 = new Graphics3D()
    // A px of a stroke or a fill is a px on screen at the middle of the globe.
    drawGlobe(g3, s, { radius: 1, unit: 2 / diameter, gap: GAP })
    if (g3.ops().length === 0) return null
    const scene = new Scene3D().orthographic({ frustumHeight: 2, position: [0, 0, CAMERA_DISTANCE], lookAt: [0, 0, 0] })
    if (s.shading === "lit") {
        scene
            .light({ type: "ambient", intensity: 0.55, color: "#ffffff" })
            .light({ type: "directional", intensity: 2.2, color: "#ffffff" }, { position: [-3, 4, 5] })
    }
    return scene.draw(g3)
}

/**
 * The whole world on a sphere, the box's inscribed circle, turned so
 * `longitude`/`latitude` faces the viewer: drop it on any board.
 *
 *   <GeoGlobe longitude={-20} latitude={15} land="#e9e4d4" graticule={{ weight: 1, fill: "white/20" }} />
 *
 * `fill` paints the ocean and `stroke` the rim; `land` and `coast` the
 * countries, `graticule` the parallels and meridians every `graticuleStep`
 * degrees (over the sea only), and `highlightFill` the countries in
 * `highlight`. The land is painted once onto the sphere, so a pattern turns
 * with the countries; a fill's pixels and a line's weight are screen pixels at
 * the middle of the globe. It reads every country file of the data, so it
 * draws once they have all landed. `geoGlobe3d` is the same globe in a 3D scene.
 */
export const GeoGlobe = component2d({
    key: "geoGlobe",
    state: { ...paintState, ...Flow.state, ...globeState },
    defaults: { fill: "#1f4e79" },
    load: (loader, state) => {
        View3D.load(loader)
        loadGlobe(loader, state)
    },
    commands: {
        ...paintCommands,
        ...globeCommands,
        /** Turn the globe the shorter way until `longitude`/`latitude` faces the viewer; a value left out stays as it is. */
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
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state as never)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state as never)),
    render: (ctx, state) => {
        const size: Size2D = ctx.size
        const diameter = Math.min(size.width, size.height)
        const circle = () => new Graphics2D().ellipse({ width: diameter, height: diameter })
        // The rim's draw-on trims the outline only; the globe inside draws whole.
        Paint.draw(ctx, state, circle(), {
            fill: [],
            children: () => {
                const scene = diameter > 0 ? sceneOf(state, diameter) : null
                if (scene) ctx.inFront(() => ctx.draw(circle().fill(Fills.canvas3D(scene, { maxPixelRatio: 2 }))))
                ctx.children()
            },
        })
    },
})

export type GeoGlobe = NodeOf<typeof GeoGlobe>
