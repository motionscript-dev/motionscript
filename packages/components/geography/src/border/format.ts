import { geoArea } from "d3-geo"

/** The on-disk shape `@motionscript/geography` writes; see its `generate.mjs`. */
export const GEO_DATA_FORMAT = 1

export interface GeoFileData {
    format: number
    source?: string
    transform: { scale: [number, number]; translate: [number, number] }
    /** Global arc id per local arc — identical across files for a shared border. */
    arcIds: number[]
    /** Per arc, flat `[x0, y0, w0, dx, dy, w, …]`: delta-encoded quantized lon/lat and a weight bucket. */
    arcs: number[][]
    features: GeoFeatureData[]
}

export interface GeoFeatureData {
    code: string
    name: string
    nameNl?: string
    parent: string | null
    first: boolean
    listed: boolean
    remote?: boolean
    area: number
    mainland: number[] | null
    areas: number[]
    /** Polygons → rings → arc refs (`~i` is arc `i` reversed). */
    polygons: number[][][]
}

/** `[code, name, nameNl, parent, first]` per listed region. */
export type GeoIndexEntry = [string, string, string, string | null, 0 | 1]

export interface GeoIndex {
    format: number
    source?: string
    regions: GeoIndexEntry[]
}

export interface GeoArc {
    /** Identity for de-duplicating a border drawn by two regions, across files. */
    key: number | string
    /** Interleaved lon/lat, in degrees. */
    points: Float64Array
    /** Per point: 0 always survives, higher buckets are less significant; see `thresholdBucket`. */
    buckets: Uint8Array
}

export interface GeoRingRef {
    arc: GeoArc
    reversed: boolean
}

export interface GeoPolygon {
    rings: GeoRingRef[][]
    /** Per ring, in steradians — exterior first, then holes. */
    ringAreas: number[]
    area: number
    mainland: boolean
}

export interface GeoFeature {
    code: string
    name: string
    nameNl: string
    parent: string | null
    first: boolean
    listed: boolean
    remote: boolean
    polygons: GeoPolygon[]
}

export interface DecodedGeoFile {
    features: Map<string, GeoFeature>
}

function decodeArc(encoded: number[], key: number, [kx, ky]: [number, number], [tx, ty]: [number, number]): GeoArc {
    const count = encoded.length / 3
    const points = new Float64Array(count * 2)
    const buckets = new Uint8Array(count)
    let x = 0
    let y = 0
    for (let i = 0; i < count; i++) {
        x += encoded[i * 3]
        y += encoded[i * 3 + 1]
        points[i * 2] = x * kx + tx
        points[i * 2 + 1] = y * ky + ty
        buckets[i] = encoded[i * 3 + 2]
    }
    return { key, points, buckets }
}

export function ringCoordinates(ring: readonly GeoRingRef[]): [number, number][] {
    const out: [number, number][] = []
    for (const { arc, reversed } of ring) {
        const n = arc.buckets.length
        for (let j = out.length === 0 ? 0 : 1; j < n; j++) {
            const i = reversed ? n - 1 - j : j
            out.push([arc.points[i * 2], arc.points[i * 2 + 1]])
        }
    }
    return out
}

/** A ring's area in steradians, whichever way it winds. */
export function ringArea(ring: readonly GeoRingRef[]): number {
    const coordinates = ringCoordinates(ring)
    if (coordinates.length < 4) return 0
    const area = geoArea({ type: "Polygon", coordinates: [coordinates] })
    return area > 2 * Math.PI ? 4 * Math.PI - area : area
}

export function decodeGeoFile(data: GeoFileData): DecodedGeoFile {
    if (data.format !== GEO_DATA_FORMAT) {
        throw new Error(`geo data format ${data.format} is not supported (expected ${GEO_DATA_FORMAT})`)
    }
    const arcs = data.arcs.map((encoded, i) =>
        decodeArc(encoded, data.arcIds[i], data.transform.scale, data.transform.translate)
    )
    const ref = (index: number): GeoRingRef =>
        index < 0 ? { arc: arcs[~index], reversed: true } : { arc: arcs[index], reversed: false }

    const features = new Map<string, GeoFeature>()
    for (const f of data.features) {
        const mainland = f.mainland ? new Set(f.mainland) : null
        features.set(f.code, {
            code: f.code,
            name: f.name,
            nameNl: f.nameNl ?? f.name,
            parent: f.parent,
            first: f.first,
            listed: f.listed,
            remote: f.remote === true,
            polygons: f.polygons.map((rings, i) => {
                const resolved = rings.map((ring) => ring.map(ref))
                return {
                    rings: resolved,
                    ringAreas: resolved.map((ring, r) => (r === 0 ? f.areas[i] : ringArea(ring))),
                    area: f.areas[i],
                    mainland: mainland === null || mainland.has(i),
                }
            }),
        })
    }
    return { features }
}
