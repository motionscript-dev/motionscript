import {
    Flow,
    Graphics2D,
    Paint,
    Types,
    component2d,
    type FillResolved,
    type NodeOf,
    // Named so this component's emitted type reaches the shape surface it spreads through the sdk, not core.
    type Alignment as _Alignment,
    type Fill as _Fill,
    type FlowMode as _FlowMode,
    type FlowResolved as _FlowResolved,
    type GapSize as _GapSize,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type Vector2 as _Vector2,
    type Size2D,
    type StrokeResolved,
} from "@motionscript/sdk"
import { snapValue } from "@motionscript/sdk/component"

import { geoChoice, geoChunkPath, geoChunks, type GeoChunk } from "../border/drawing"
import { geoGlobeGeometry, geoOutlines, type GeoBorders, type GeoContour, type GeoOutlines } from "../border/geometry"
import { geoLoader } from "../border/loader"
import { geoRegistry } from "../border/registry"
import { geoFilesFor, normalizeIso, selectGeoFeatures } from "../border/selection"
import { GEO_WORLD } from "./world"

const { overlay: _overlay, ...paintState } = Paint.state
const { overlayTo: _overlayTo, ...paintCommands } = Paint.commands

/** A command arg a row may leave out, keeping the globe's own value; `hint` is what an editor offers. */
function hinted(hint: number) {
    return Types.custom<number | undefined>(undefined, { default: hint, step: 1, unit: "°" } as never)
}

/** `degrees` folded into `(-180, 180]`. */
function wrapDegrees(degrees: number): number {
    const wrapped = ((degrees % 360) + 360) % 360
    return wrapped > 180 ? wrapped - 360 : wrapped
}

interface Drawn {
    key: string
    land: GeoOutlines
    highlight: GeoOutlines | null
    graticuleChunks: GeoChunk[]
    landChunks: GeoChunk[]
    highlightChunks: GeoChunk[]
    coastChunks: GeoChunk[]
}

interface Kept {
    drawn: Drawn | null
    readonly warned: Set<string>
}

const kept = new WeakMap<object, Kept>()

function keptBy(state: object): Kept {
    let entry = kept.get(state)
    if (!entry) kept.set(state, (entry = { drawn: null, warned: new Set() }))
    return entry
}

/** A selection simplified, once every file it needs has landed. */
function outlinesOf(codes: readonly string[], borders: GeoBorders, detail: number, own: Kept): GeoOutlines | null {
    const selection = selectGeoFeatures(codes, "country", "all")
    for (const code of selection.unknown) {
        if (own.warned.has(code)) continue
        own.warned.add(code)
        console.warn(`[GeoGlobe] no region with code ${code}`)
    }
    if (selection.pending || selection.features.length === 0) return null
    return geoOutlines({
        selectionKey: `${geoRegistry.generation}:${selection.files}:${codes.join(",")}`,
        features: selection.features,
        frame: "all",
        borders,
        detail,
    })
}

interface Turned {
    readonly highlight: readonly string[]
    readonly borders: GeoBorders
    readonly detail: number
    readonly longitude: number
    readonly latitude: number
    readonly graticuleStep: number
}

/** The globe turned to its longitude and latitude, as paths `diameter` px across; rebuilt only when one of those changes. */
function drawnOf(state: Turned, diameter: number): Drawn | null {
    const own = keptBy(state)
    const land = outlinesOf(GEO_WORLD, state.borders, state.detail, own)
    if (!land) return null
    const highlight = state.highlight.length > 0 ? outlinesOf(state.highlight, "outline", state.detail, own) : null
    const key = `${state.longitude}|${state.latitude}|${state.graticuleStep}|${diameter}`
    const cached = own.drawn
    if (cached && cached.key === key && cached.land === land && cached.highlight === highlight) return cached

    const turned = geoGlobeGeometry({
        land,
        highlight,
        longitude: state.longitude,
        latitude: state.latitude,
        graticuleStep: state.graticuleStep,
    })
    const chunks = (contours: GeoContour[], total: number) => geoChunks(contours, total, diameter)
    const drawn: Drawn = {
        key,
        land,
        highlight,
        graticuleChunks: chunks(turned.graticule, turned.graticuleLength),
        landChunks: chunks(turned.land, turned.landLength),
        highlightChunks: chunks(turned.highlight, turned.highlightLength),
        coastChunks: chunks(turned.coast, turned.coastLength),
    }
    own.drawn = drawn
    return drawn
}

// `Paint.inset` reads the stroke alone; the globe spreads Paint without its overlay.
const inset = (state: object) => Paint.inset(state as Parameters<typeof Paint.inset>[0])

const centred = (strokes: StrokeResolved[]) => strokes.map((layer) => (layer.align === 0 ? layer : { ...layer, align: 0 }))

/**
 * The whole world on an orthographic sphere, the box's inscribed circle,
 * turned so `longitude`/`latitude` faces the viewer.
 *
 *   <GeoGlobe longitude={-20} latitude={15} land="#e9e4d4" graticule={{ weight: 1, fill: "white/20" }} />
 *
 * `fill` and `stroke` paint the sphere (the ocean and its rim); `land` and
 * `coast` the countries, `graticule` the parallels and meridians every
 * `graticuleStep` degrees, and `highlightFill` the countries in `highlight`.
 * It reads every country file of the data, like a `geoBorder` of all of them,
 * so it draws once they have all landed. `turnTo` and `spin` turn it; each
 * new angle projects the world again (about 10 ms at the default
 * `detail`), and a still globe costs nothing.
 */
export const GeoGlobe = component2d({
    key: "geoGlobe",
    state: {
        ...paintState,
        ...Flow.state,
        land: Types.fill("#e9e4d4"),
        coast: Types.stroke({ weight: 1, fill: "#1b3a57" }),
        borders: geoChoice(["all", "outline"], "outline"),
        graticule: Types.stroke([]),
        graticuleStep: Types.number(30, { min: 5, max: 90, step: 5, unit: "°" }),
        longitude: Types.number(0, { step: 1, unit: "°" }),
        latitude: Types.number(20, { min: -90, max: 90, step: 1, unit: "°" }),
        detail: Types.number(0.45, { min: 0, max: 1, step: 0.01 }),
        highlight: Types.custom<string | readonly string[], string[]>([], { resolve: normalizeIso, lerp: snapValue }),
        highlightFill: Types.fill("#e4572e"),
    },
    defaults: { fill: "#1f4e79" },
    commands: {
        ...paintCommands,
        landTo: { args: ["land"] },
        coastTo: { args: ["coast"] },
        graticuleTo: { args: ["graticule"] },
        highlightFillTo: { args: ["highlightFill"] },
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
    // The data gates the draw, not layout: the box never waits on it.
    load: (loader, state) => {
        for (const file of geoFilesFor([...GEO_WORLD, ...state.highlight], "country")) loader.task(`geo:${file}`, geoLoader(file))
    },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, inset(state)),
    render: (ctx, state) => {
        const size: Size2D = ctx.size
        const diameter = Math.min(size.width, size.height)
        const { start, end } = state
        const paintParts = (chunks: GeoChunk[], paint: (g: Graphics2D) => void) => {
            if (chunks.length === 0) return
            const g = new Graphics2D()
            for (const part of chunks) if (geoChunkPath(g, part, size, start, end)) paint(g)
            ctx.draw(g)
        }
        const sphere = new Graphics2D().ellipse({ width: diameter, height: diameter })
        Paint.draw(ctx, state, sphere, {
            children: () => {
                ctx.inFront(() => {
                    const drawn = drawnOf(state, diameter)
                    if (!drawn) return
                    const graticule = state.graticule as StrokeResolved[]
                    const land = state.land as FillResolved[]
                    const highlight = state.highlightFill as FillResolved[]
                    const coast = state.coast as StrokeResolved[]
                    if (graticule.length > 0) paintParts(drawn.graticuleChunks, (g) => g.stroke(centred(graticule)))
                    if (land.length > 0) paintParts(drawn.landChunks, (g) => g.fill(land))
                    if (highlight.length > 0) paintParts(drawn.highlightChunks, (g) => g.fill(highlight))
                    if (coast.length > 0) paintParts(drawn.coastChunks, (g) => g.stroke(centred(coast)))
                })
                ctx.children()
            },
        })
    },
})

export type GeoGlobe = NodeOf<typeof GeoGlobe>
