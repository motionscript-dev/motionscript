import {
    Paint3D,
    Types,
    type Graphics3D,
    type FillResolved,
    type Loader,
    type Material3D,
    type Quaternion,
    type StrokeResolved,
    type SurfaceTexture3D,
    type Values,
    // Named so the emitted types reach these through the sdk, not core.
    type Fill as _Fill,
    type Stroke as _Stroke,
} from "@motionscript/sdk"
import { snapValue } from "@motionscript/sdk/component"

import { geoChoice } from "../border/drawing"
import { geoOutlines, geoWorldMap, type GeoBorders, type GeoOutlines } from "../border/geometry"
import { geoLoader } from "../border/loader"
import { geoRegistry } from "../border/registry"
import { geoFilesFor, normalizeIso, selectGeoFeatures } from "../border/selection"
import { globeBars, globeLineSet, globeSegments, graticuleLineSet, landMask, type GlobeLineSet } from "./lines"
import { globeMap } from "./surface"
import { GEO_WORLD } from "./world"

/** A command arg a row may leave out, keeping the globe's own value; `hint` is what an editor offers. */
export function hinted(hint: number) {
    return Types.custom<number | undefined>(undefined, { default: hint, step: 1, unit: "°" } as never)
}

/** `degrees` folded into `(-180, 180]`. */
export function wrapDegrees(degrees: number): number {
    const wrapped = ((degrees % 360) + 360) % 360
    return wrapped > 180 ? wrapped - 360 : wrapped
}

/** What both globes draw: the world painted on a sphere, its lines laid on it, turned to face `longitude`/`latitude`. */
export const globeState = {
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
    /** `lit` shades the ball under a light; `flat` shows every colour exactly as set. */
    shading: geoChoice(["flat", "lit"], "flat"),
    /** `shown` sees through a translucent ocean to the far side, a glass globe. */
    farSide: geoChoice(["hidden", "shown"], "hidden"),
}

export const globeCommands = {
    landTo: { args: ["land"] },
    coastTo: { args: ["coast"] },
    graticuleTo: { args: ["graticule"] },
    highlightFillTo: { args: ["highlightFill"] },
} as const

export type GlobeValues = Values<typeof globeState> & {
    readonly fill: readonly FillResolved[]
    readonly start: number
    readonly end: number
}

/** Every country file the globe reads, and those `highlight` adds: the data gates the draw, never the box. */
export function loadGlobe(loader: Loader, s: { readonly highlight: readonly string[] }): void {
    for (const file of geoFilesFor([...GEO_WORLD, ...s.highlight], "country")) loader.task(`geo:${file}`, geoLoader(file))
}

/** How one globe sits in its scene. */
export interface GlobeView {
    readonly radius: number
    /** Scene units per stroke unit: a line's `weight` and a fill's pixels are this many units. */
    readonly unit: number
    /** How far inside the surface the horizon's depth-only sphere sits, and how far above it the lines run. */
    readonly gap: number
}

interface Kept {
    map: { key: string; land: GeoOutlines; highlight: GeoOutlines | null; texture: SurfaceTexture3D } | null
    lineSets: { land: GeoOutlines; borders: GeoBorders; step: number; coast: GlobeLineSet; graticule: GlobeLineSet | null } | null
    bars: Map<string, { key: string; drawn: ReturnType<typeof globeBars> }>
    readonly warned: Set<string>
}

const kept = new WeakMap<object, Kept>()

function keptBy(state: object): Kept {
    let entry = kept.get(state)
    if (!entry) kept.set(state, (entry = { map: null, lineSets: null, bars: new Map(), warned: new Set() }))
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

/** The turn that brings `longitude`/`latitude` round to face +z, north up: about y, then about x. */
export function globeTurn(longitude: number, latitude: number): Quaternion {
    const half = Math.PI / 360
    const y = (-90 - longitude) * half
    const x = Math.max(-90, Math.min(90, latitude)) * half
    const sx = Math.sin(x)
    const cx = Math.cos(x)
    const sy = Math.sin(y)
    const cy = Math.cos(y)
    return { x: sx * cy, y: cx * sy, z: sx * sy, w: cx * cy }
}

/** Whether a fill hides what is under it everywhere: one solid colour layer at full alpha. */
function covers(fill: readonly FillResolved[]): boolean {
    return fill.some((layer) => layer.type === "solid" && layer.blend === undefined && (layer.color[3] ?? 1) >= 1 && (layer.opacity ?? 1) >= 1)
}

function mapOf(s: GlobeValues, view: GlobeView, land: GeoOutlines, highlight: GeoOutlines | null, own: Kept): SurfaceTexture3D {
    const width = (2 * Math.PI * view.radius) / view.unit
    const key = `${width}|${JSON.stringify(s.fill)}|${JSON.stringify(s.land)}|${JSON.stringify(s.highlightFill)}`
    const cached = own.map
    if (cached && cached.key === key && cached.land === land && cached.highlight === highlight) return cached.texture
    const texture = globeMap({ width, ocean: s.fill, land: s.land, landOutlines: land, highlight: s.highlightFill, highlightOutlines: highlight })
    own.map = { key, land, highlight, texture }
    return texture
}

const tracedLand = new WeakMap<GeoOutlines, { mask: Uint8Array; coast: GlobeLineSet }>()

function lineSetsOf(s: GlobeValues, land: GeoOutlines, own: Kept): NonNullable<Kept["lineSets"]> {
    const step = s.graticuleStep
    const cached = own.lineSets
    if (cached && cached.land === land && cached.borders === s.borders && cached.step === step) return cached
    let traced = tracedLand.get(land)
    if (!traced) tracedLand.set(land, (traced = { mask: landMask(geoWorldMap(land)), coast: globeLineSet(land.lines) }))
    const graticule = step > 0 ? graticuleLineSet(step, traced.mask) : null
    const sets = { land, borders: s.borders, step, coast: traced.coast, graticule }
    own.lineSets = sets
    own.bars.clear()
    return sets
}

function drawLines(
    g3: Graphics3D,
    name: string,
    set: GlobeLineSet,
    stroke: readonly StrokeResolved[],
    s: GlobeValues,
    view: GlobeView,
    turn: Quaternion,
    own: Kept,
): void {
    stroke.forEach((layer, i) => {
        const slot = `${name}:${i}`
        const key = `${JSON.stringify(layer)}|${s.start}|${s.end}|${view.radius}|${view.unit}|${view.gap}`
        let entry = own.bars.get(slot)
        if (entry?.key !== key) {
            const radius = view.radius * (1 + view.gap) + (layer.weight * view.unit) / 2
            const drawn = globeBars(layer, globeSegments(set, s.start, s.end, radius), view.unit)
            own.bars.set(slot, (entry = { key, drawn }))
        }
        if (entry.drawn) g3.instances(Paint3D.BAR, entry.drawn.material, entry.drawn.bars, { transform: { quaternion: turn, renderOrder: 2 } })
    })
}

/** The globe drawn into `g3` in its own space, or nothing while its data loads. */
export function drawGlobe(g3: Graphics3D, s: GlobeValues, view: GlobeView): void {
    const own = keptBy(s)
    const land = outlinesOf(GEO_WORLD, s.borders, s.detail, own)
    if (!land) return
    const highlight = s.highlight.length > 0 ? outlinesOf(s.highlight, "outline", s.detail, own) : null
    const turn = globeTurn(s.longitude, s.latitude)
    const flat = s.shading === "flat"
    const glass = s.farSide === "shown"
    const solid = covers(s.fill)
    const map = mapOf(s, view, land, highlight, own)
    const surface: Material3D = flat
        ? { type: "basic", color: [1, 1, 1, 1], map, toneMapped: false }
        : { type: "standard", color: [1, 1, 1, 1], map, roughness: 0.85, metalness: 0 }
    const sphere = { type: "sphere", radius: view.radius, segments: [360, 180] } as const
    const blended = !solid
    g3.mesh(
        sphere,
        {
            ...surface,
            ...(blended ? { transparent: true } : {}),
            ...(glass && blended ? { faces: "both" } : {}),
        } as Material3D,
        { quaternion: turn, renderOrder: 1 },
    )
    if (blended && !glass) {
        // Depth only: hides the far side's lines behind an ocean that shows the background.
        g3.mesh(
            { ...sphere, radius: view.radius * (1 - view.gap) },
            { type: "basic", color: [0, 0, 0, 1], opacity: 0.001, transparent: true, depthWrite: true, toneMapped: false },
            { renderOrder: 0 },
        )
    }
    const sets = lineSetsOf(s, land, own)
    if (sets.graticule) drawLines(g3, "graticule", sets.graticule, s.graticule as StrokeResolved[], s, view, turn, own)
    drawLines(g3, "coast", sets.coast, s.coast as StrokeResolved[], s, view, turn, own)
}
