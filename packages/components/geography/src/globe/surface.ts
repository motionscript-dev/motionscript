import { Graphics2D, Tex, type FillResolved, type SurfaceTexture3D } from "@motionscript/sdk"

import { geoChunks } from "../border/drawing"
import { geoWorldMap, type GeoOutlines } from "../border/geometry"

/** The land picture's width in pixels (it is half as tall): sharp for a globe up to about 1300 px across. */
export const GLOBE_MAP_WIDTH = 4096

/** What the picture is painted from; `width` is the authored width of the map, the length of the equator in the units fills are measured in. */
export interface GlobeMapRequest {
    readonly width: number
    readonly ocean: readonly FillResolved[]
    readonly land: readonly FillResolved[]
    readonly landOutlines: GeoOutlines
    readonly highlight: readonly FillResolved[]
    readonly highlightOutlines: GeoOutlines | null
}

const traced = new WeakMap<GeoOutlines, { width: number; data: string[] }>()

function pathData(outlines: GeoOutlines, width: number): string[] {
    const kept = traced.get(outlines)
    if (kept?.width === width) return kept.data
    const contours = geoWorldMap(outlines)
    const data = geoChunks(contours, 0, width).map((chunk) => chunk.data)
    traced.set(outlines, { width, data })
    return data
}

/**
 * Every part is one union with two empty corner points, so a fill's box is the same 360° square for each: a grid has
 * square cells in degrees, lines up across countries and tiles across the seam.
 */
function paintRegion(g: Graphics2D, data: readonly string[], fills: readonly FillResolved[], width: number): void {
    if (data.length === 0 || fills.length === 0) return
    const half = width / 2
    const square = [-half, -half, half, half] as const
    for (const part of data) g.path({ data: part, centerBounds: square })
    g.path({ data: `M${-half} ${-half}L${-half} ${-half}M${half} ${half}L${half} ${half}`, centerBounds: square })
    g.fill(fills as FillResolved[])
}

export function globeMap(request: GlobeMapRequest): SurfaceTexture3D {
    const { width } = request
    const g = new Graphics2D()
    if (request.ocean.length > 0) g.rect({ width, height: width / 2 }).fill(request.ocean as FillResolved[])
    paintRegion(g, pathData(request.landOutlines, width), request.land, width)
    if (request.highlightOutlines) paintRegion(g, pathData(request.highlightOutlines, width), request.highlight, width)
    if (width !== GLOBE_MAP_WIDTH) g.scale(GLOBE_MAP_WIDTH / width)
    // Sharp to the limb, where the sphere squeezes the picture into a sliver.
    return Tex.surface(g, { width: GLOBE_MAP_WIDTH, height: GLOBE_MAP_WIDTH / 2, anisotropy: 16 })
}
