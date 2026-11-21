import {
    Flow,
    Graphics2D,
    Paint,
    Shapes,
    Types,
    component2d,
    type EntryOptions,
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
    type Stroke as _Stroke,
    type Vector2 as _Vector2,
    type ShadowResolved,
    type Size2D,
    type StrokeResolved,
} from "@motionscript/sdk"
import { snapValue } from "@motionscript/sdk/component"

import { geoChoice as choice, geoChunkPath as pathOp, geoChunks as chunk, type GeoChunk } from "./drawing"
import {
    geoGeometry,
    lerpGeoProjection,
    type GeoBorders,
    type GeoGeometry,
    type GeoProjectionKind,
    type GeoProjectionValue,
} from "./geometry"
import { geoLoader } from "./loader"
import { geoRegistry } from "./registry"
import { geoFilesFor, normalizeIso, selectGeoFeatures, type GeoFrame, type GeoLevel } from "./selection"

interface Drawn {
    geometry: GeoGeometry
    width: number
    height: number
    fills: GeoChunk[]
    lines: GeoChunk[]
}

/** A node's own drawing state, kept by its fields' view (one object per node, the same every frame). */
interface Kept {
    drawn: Drawn | null
    readonly warned: Set<string>
}

const PROJECTIONS = ["conic", "mercator", "equirectangular", "orthographic"] as const

const kept = new WeakMap<object, Kept>()

function keptBy(state: object): Kept {
    let entry = kept.get(state)
    if (!entry) kept.set(state, (entry = { drawn: null, warned: new Set() }))
    return entry
}

interface Selected {
    readonly iso: readonly string[]
    readonly level: GeoLevel
    readonly frame: GeoFrame
    readonly projection: GeoProjectionValue
    readonly borders: GeoBorders
    readonly detail: number
}

/**
 * Every region as one shape, with two empty points at the box's corners: a fill measures itself against the node's box,
 * so a pattern lines up across borders and stays put whatever the selection or its detail.
 */
function land(shape: Drawn, size: Size2D): Graphics2D {
    const g = new Graphics2D()
    for (const part of shape.fills) pathOp(g, part, size, 0, 1)
    const x = size.width / 2
    const y = size.height / 2
    return g.path({ data: `M${-x} ${-y}L${-x} ${-y}M${x} ${y}L${x} ${y}`, centerBounds: [-x, -y, x, y] })
}

/** The selection's outlines cut into paths at `size`, or `null` while there is nothing to draw. */
function drawnOf(state: Selected, size: Size2D): Drawn | null {
    const own = keptBy(state)
    const codes = state.iso
    const { level, frame } = state
    const selection = selectGeoFeatures(codes, level, frame)
    for (const code of selection.unknown) {
        if (own.warned.has(code)) continue
        own.warned.add(code)
        console.warn(`[GeoBorder] no region with code ${code}`)
    }
    // Drawn once every file it needs has landed, and keyed on those files alone:
    // the world's 252 landing one by one would otherwise refit it 252 times.
    if (selection.pending || selection.features.length === 0) return null

    const geometry = geoGeometry({
        selectionKey: `${geoRegistry.generation}:${selection.files}:${level}:${frame}:${codes.join(",")}`,
        features: selection.features,
        frame,
        projection: state.projection,
        borders: state.borders,
        detail: state.detail,
    })
    if (!geometry) return null

    const { width, height } = size
    const cached = own.drawn
    if (cached && cached.geometry === geometry && cached.width === width && cached.height === height) return cached
    const scale = Math.min(width / geometry.width, height / geometry.height)
    const drawn: Drawn = {
        geometry,
        width,
        height,
        fills: chunk(geometry.fills, geometry.fillLength, scale),
        lines: chunk(geometry.lines, geometry.lineLength, scale),
    }
    own.drawn = drawn
    return drawn
}

/**
 * Country and subdivision outlines by ISO 3166 code, fitted into the node's box.
 *
 *   <GeoBorder iso={["FR", "DE"]} detail={0.4} stroke={{ weight: 2, fill: "white" }} />
 *
 * Geometry comes from whatever `geoRegistry` has been given — a URL, a loader,
 * or shapes defined by hand — and loads as a declared asset, so a frame never
 * draws half a country. Fill and stroke are separate geometry: the fill is each
 * region's polygons, the stroke is every border once, which is why a border two
 * selected regions share is not drawn twice and why `stroke.align` does not
 * apply. The fill is one shape measured against the node's box, so a grid or a
 * gradient runs on across borders; `start`/`end` draw the borders on and leave
 * the fill whole (fade it in with `fillTo`). `projectTo` morphs the drawing
 * from one projection into another, refitting it to the box as it goes.
 */
export const GeoBorder = component2d({
    key: "geoBorder",
    state: {
        ...Paint.state,
        ...Flow.state,
        iso: Types.custom<string | readonly string[], string[]>(["FR"], { resolve: normalizeIso, lerp: snapValue }),
        level: choice(["country", "state"], "country"),
        detail: Types.number(0.5, { min: 0, max: 1, step: 0.01 }),
        projection: Types.custom<GeoProjectionKind, GeoProjectionValue, EntryOptions & { readonly options: typeof PROJECTIONS }>(
            "conic",
            { lerp: lerpGeoProjection, options: PROJECTIONS }
        ),
        frame: choice(["mainland", "all"], "mainland"),
        borders: choice(["all", "outline"], "all"),
    },
    commands: {
        ...Paint.commands,
        projectTo: { args: ["projection"] },
    },
    // The data gates the draw, not layout: the box never waits on it.
    load: (loader, state) => {
        for (const file of geoFilesFor(state.iso, state.level)) loader.task(`geo:${file}`, geoLoader(file))
    },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => {
        const size = ctx.size
        const { start, end } = state
        const fill = state.fill as FillResolved[]
        const shadow = state.shadow as ShadowResolved[]
        const drawn = () => drawnOf(state, size)

        ctx.inFront(() => {
            const shape = drawn()
            if (!shape || shape.fills.length === 0 || fill.length === 0) return
            const g = land(shape, size)
            if (shadow.length > 0) g.shadow(shadow)
            ctx.draw(g.fill(fill))
        })

        // The box, not the outline, confines the children and is what picking
        // tests: a path clip has no winding test, and a country's bounding box is
        // what the selection shows.
        Paint.draw(ctx, state, null, { clipShape: Shapes.box(size) })

        ctx.inFront(() => {
            const overlay = state.overlay as FillResolved[]
            if (overlay.length > 0) {
                const shape = drawn()
                if (shape && shape.fills.length > 0) ctx.draw(land(shape, size).fill(overlay))
            }

            const stroke = state.stroke as StrokeResolved[]
            if (stroke.length === 0) return
            const shape = drawn()
            if (!shape || shape.lines.length === 0) return
            const centred = stroke.map((layer) => (layer.align === 0 ? layer : { ...layer, align: 0 }))
            const castsShadow = shadow.length > 0 && !fill.some((layer) => (layer.opacity ?? 1) > 0)
            const g = new Graphics2D()
            for (const part of shape.lines) {
                if (!pathOp(g, part, size, start, end)) continue
                if (castsShadow) g.shadow(shadow)
                g.stroke(centred)
            }
            ctx.draw(g)
        })
    },
})

export type GeoBorder = NodeOf<typeof GeoBorder>
