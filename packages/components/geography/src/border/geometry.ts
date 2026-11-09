import {
    geoArea,
    geoBounds,
    geoConicEqualArea,
    geoEquirectangular,
    geoMercator,
    geoOrthographic,
    geoPath,
    geoStream,
    type GeoPermissibleObjects,
    type GeoProjection,
} from "d3-geo"

import { ringCoordinates, type GeoArc, type GeoFeature, type GeoPolygon, type GeoRingRef } from "./format"
import type { GeoFrame } from "./selection"

export type GeoProjectionKind = "conic" | "mercator" | "equirectangular" | "orthographic"
export type GeoBorders = "all" | "outline"

export interface GeoContour {
    /** Interleaved x/y in unit space: the longer side spans 1, centred on the origin, y up. */
    points: Float32Array
    closed: boolean
    length: number
}

export interface GeoGeometry {
    /** The drawing's extent in unit space; the longer of the two is 1. */
    width: number
    height: number
    fills: GeoContour[]
    lines: GeoContour[]
    fillLength: number
    lineLength: number
    bytes: number
}

interface Part {
    polygon: GeoPolygon
    largest: boolean
}

interface Frame {
    projection: GeoProjection
    centerX: number
    centerY: number
    size: number
    width: number
    height: number
}

const FIT = 1024

// `detail` maps onto a weight threshold that is a fraction of the selection's
// own area, on a log scale — which is what makes a value look equally stylised
// on Monaco and on Russia. 0 keeps points worth 1% of the area; just below 1,
// points worth a billionth of it.
const POINT_BASE = 2
const POINT_RANGE = 7
const POLYGON_BASE = 1.5
const POLYGON_RANGE = 6

const clamp01 = (value: number) => (value > 1 ? 1 : value > 0 ? value : 0)

/** The highest weight bucket a point may carry and still be drawn. */
export function pointBucketLimit(detail: number, area: number): number {
    if (detail >= 1 || !(area > 0)) return 255
    const minWeight = area * 10 ** -(POINT_BASE + POINT_RANGE * clamp01(detail))
    return Math.floor(-2 * Math.log2(minWeight))
}

/** Rings smaller than this (steradians) are dropped, bar each region's largest. */
export function polygonAreaLimit(detail: number, area: number): number {
    if (detail >= 1) return 0
    return area * 10 ** -(POLYGON_BASE + POLYGON_RANGE * clamp01(detail))
}

function partsOf(features: readonly GeoFeature[], frame: GeoFrame): Part[] {
    const parts: Part[] = []
    for (const feature of features) {
        const mainland = frame === "mainland" ? feature.polygons.filter((p) => p.mainland) : []
        const polygons = mainland.length > 0 ? mainland : feature.polygons
        let largest: GeoPolygon | null = null
        for (const polygon of polygons) if (!largest || polygon.area > largest.area) largest = polygon
        for (const polygon of polygons) parts.push({ polygon, largest: polygon === largest })
    }
    return parts
}

function centerLongitude(west: number, east: number): number {
    if (west <= east) return (west + east) / 2
    const mid = (west + east + 360) / 2
    return mid > 180 ? mid - 360 : mid
}

function makeProjection(kind: GeoProjectionKind, west: number, south: number, east: number, north: number): GeoProjection {
    const lon = centerLongitude(west, east)
    const lat = (south + north) / 2
    switch (kind) {
        case "mercator":
            return geoMercator().rotate([-lon, 0])
        case "equirectangular":
            return geoEquirectangular().rotate([-lon, 0])
        case "orthographic":
            return geoOrthographic().rotate([-lon, -lat])
        case "conic": {
            const span = north - south
            return geoConicEqualArea()
                .rotate([-lon, 0])
                .center([0, lat])
                .parallels([south + span / 6, north - span / 6])
        }
    }
}

function fitFrame(kind: GeoProjectionKind, parts: readonly Part[]): Frame | null {
    if (parts.length === 0) return null
    const shape = {
        type: "MultiPolygon",
        coordinates: parts.map(({ polygon }) => [ringCoordinates(polygon.rings[0])]),
    } as GeoPermissibleObjects
    const [[west, south], [east, north]] = geoBounds(shape)

    for (const candidate of [kind, "equirectangular"] as const) {
        const projection = makeProjection(candidate, west, south, east, north).fitSize([FIT, FIT], shape)
        const [[x0, y0], [x1, y1]] = geoPath(projection).bounds(shape)
        const size = Math.max(x1 - x0, y1 - y0)
        if (!Number.isFinite(size) || size <= 0) continue
        return {
            projection,
            centerX: (x0 + x1) / 2,
            centerY: (y0 + y1) / 2,
            size,
            width: (x1 - x0) / size,
            height: (y1 - y0) / size,
        }
    }
    return null
}

function project(frame: Frame, object: GeoPermissibleObjects, closed: boolean): GeoContour[] {
    const contours: GeoContour[] = []
    let current: number[] | null = null
    const { centerX, centerY, size } = frame
    const sink = {
        point(x: number, y: number) {
            current?.push((x - centerX) / size, -(y - centerY) / size)
        },
        lineStart() {
            current = []
        },
        lineEnd() {
            const flat = current
            current = null
            if (!flat || flat.length < 4) return
            let isClosed = closed
            if (!closed) {
                const n = flat.length
                if (flat[0] === flat[n - 2] && flat[1] === flat[n - 1] && n >= 8) {
                    flat.length = n - 2
                    isClosed = true
                }
            }
            const points = Float32Array.from(flat)
            contours.push({ points, closed: isClosed, length: contourLength(points, isClosed) })
        },
        polygonStart() {},
        polygonEnd() {},
        sphere() {},
    }
    geoStream(object, frame.projection.stream(sink))
    return contours
}

function contourLength(points: Float32Array, closed: boolean): number {
    let length = 0
    const n = points.length / 2
    for (let i = 1; i < n; i++) {
        length += Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1])
    }
    if (closed && n > 1) length += Math.hypot(points[0] - points[n * 2 - 2], points[1] - points[n * 2 - 1])
    return length
}

// Longest edge, in degrees, that simplification may leave. d3 takes an edge as
// the short way round the sphere, so an edge across more than half the planet
// (Kaliningrad to Chukotka, once the coast between is dropped) turns inside out.
const MAX_EDGE_DEGREES = 20

type MaskFor = (arc: GeoArc) => Uint8Array

/** Which of an arc's points survive `limit`, the same whichever way the arc is walked. */
function keepMask(arc: GeoArc, limit: number): Uint8Array {
    const n = arc.buckets.length
    const mask = new Uint8Array(n)
    let lastLon = arc.points[0]
    let lastLat = arc.points[1]
    for (let i = 0; i < n; i++) {
        const lon = arc.points[i * 2]
        const lat = arc.points[i * 2 + 1]
        let far = false
        if (arc.buckets[i] > limit) {
            let dLon = Math.abs(lon - lastLon)
            if (dLon > 180) dLon = 360 - dLon
            far = Math.abs(lat - lastLat) > MAX_EDGE_DEGREES || dLon * Math.cos((lat * Math.PI) / 180) > MAX_EDGE_DEGREES
        }
        if (arc.buckets[i] <= limit || far) {
            mask[i] = 1
            lastLon = lon
            lastLat = lat
        }
    }
    return mask
}

function filteredPoints(refs: readonly GeoRingRef[], maskFor: MaskFor): [number, number][] {
    const out: [number, number][] = []
    for (const { arc, reversed } of refs) {
        const n = arc.buckets.length
        const mask = maskFor(arc)
        for (let j = out.length === 0 ? 0 : 1; j < n; j++) {
            const i = reversed ? n - 1 - j : j
            if (mask[i]) out.push([arc.points[i * 2], arc.points[i * 2 + 1]])
        }
    }
    return out
}

/** A ring keeps at least three vertices, raising its arcs' limits if the global one would collapse it. */
function ringLimit(ring: readonly GeoRingRef[], limit: number): number {
    let kept = 0
    for (const { arc } of ring) {
        for (let i = 0; i < arc.buckets.length - 1; i++) if (arc.buckets[i] <= limit) kept++
    }
    if (kept >= 3) return limit
    const buckets: number[] = []
    for (const { arc } of ring) for (let i = 0; i < arc.buckets.length - 1; i++) buckets.push(arc.buckets[i])
    buckets.sort((a, b) => a - b)
    return Math.max(limit, buckets[Math.min(2, buckets.length - 1)] ?? limit)
}

/**
 * Whether a simplified ring still winds the way its original did. Dropping
 * points can fold a small ring over itself, and d3 reads an exterior wound the
 * wrong way as the rest of the planet — one such island fills the whole frame.
 */
function windsAsOriginal(ring: [number, number][], exterior: boolean): boolean {
    if (ring.length < 4) return true
    const inverted = geoArea({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI
    return inverted !== exterior
}

interface Chain {
    refs: GeoRingRef[]
    closed: boolean
}

const endKey = (arc: GeoArc, last: boolean) => {
    const i = last ? arc.buckets.length - 1 : 0
    return `${arc.points[i * 2]},${arc.points[i * 2 + 1]}`
}

/** Joins arcs that meet end to end with nothing else at the joint, so a border draws as one line with real joins. */
function chainArcs(arcs: readonly GeoArc[]): Chain[] {
    const atNode = new Map<string, GeoArc[]>()
    for (const arc of arcs) {
        for (const key of [endKey(arc, false), endKey(arc, true)]) {
            const list = atNode.get(key)
            if (list) list.push(arc)
            else atNode.set(key, [arc])
        }
    }
    const visited = new Set<GeoArc>()
    const chains: Chain[] = []
    const refStart = ({ arc, reversed }: GeoRingRef) => endKey(arc, reversed)
    const refEnd = ({ arc, reversed }: GeoRingRef) => endKey(arc, !reversed)
    const nextAt = (node: string): GeoArc | null => {
        const list = atNode.get(node)!
        if (list.length !== 2) return null
        return list.find((arc) => !visited.has(arc)) ?? null
    }

    for (const arc of arcs) {
        if (visited.has(arc)) continue
        visited.add(arc)
        const refs: GeoRingRef[] = [{ arc, reversed: false }]
        for (let next = nextAt(refEnd(refs[refs.length - 1])); next; next = nextAt(refEnd(refs[refs.length - 1]))) {
            visited.add(next)
            refs.push({ arc: next, reversed: endKey(next, false) !== refEnd(refs[refs.length - 1]) })
        }
        for (let prev = nextAt(refStart(refs[0])); prev; prev = nextAt(refStart(refs[0]))) {
            visited.add(prev)
            refs.unshift({ arc: prev, reversed: endKey(prev, true) !== refStart(refs[0]) })
        }
        chains.push({ refs, closed: refStart(refs[0]) === refEnd(refs[refs.length - 1]) })
    }
    return chains
}

function buildGeometry(
    features: readonly GeoFeature[],
    frame: GeoFrame,
    fitted: Frame,
    borders: GeoBorders,
    detail: number
): GeoGeometry {
    const parts = partsOf(features, frame)
    const area = parts.reduce((sum, { polygon }) => sum + polygon.area, 0)
    const pointLimit = pointBucketLimit(detail, area)
    const polygonLimit = polygonAreaLimit(detail, area)

    const kept: GeoRingRef[][][] = []
    for (const { polygon, largest } of parts) {
        if (!largest && polygon.area < polygonLimit) continue
        kept.push(polygon.rings.filter((_, i) => i === 0 || polygon.ringAreas[i] >= polygonLimit))
    }

    const limits = new Map<GeoArc["key"], number>()
    const usage = new Map<GeoArc["key"], { arc: GeoArc; count: number }>()
    for (const rings of kept) {
        for (const ring of rings) {
            const limit = ringLimit(ring, pointLimit)
            for (const { arc } of ring) {
                limits.set(arc.key, Math.max(limits.get(arc.key) ?? 0, limit))
                const use = usage.get(arc.key)
                if (use) use.count++
                else usage.set(arc.key, { arc, count: 1 })
            }
        }
    }

    const masks = new Map<GeoArc["key"], Uint8Array>()
    const maskFor: MaskFor = (arc) => {
        let mask = masks.get(arc.key)
        if (!mask) {
            mask = keepMask(arc, limits.get(arc.key) ?? 255)
            masks.set(arc.key, mask)
        }
        return mask
    }

    if (pointLimit < 255) {
        for (const rings of kept) {
            rings.forEach((ring, index) => {
                let limit = Math.min(...ring.map(({ arc }) => limits.get(arc.key) ?? pointLimit))
                while (limit < 255 && !windsAsOriginal(filteredPoints(ring, maskFor), index === 0)) {
                    limit = Math.min(255, limit + 2)
                    for (const { arc } of ring) {
                        limits.set(arc.key, Math.max(limits.get(arc.key) ?? 0, limit))
                        masks.delete(arc.key)
                    }
                }
            })
        }
    }

    const fills = project(
        fitted,
        {
            type: "MultiPolygon",
            coordinates: kept.flatMap((rings) => {
                const [exterior, ...holes] = rings.map((ring) => filteredPoints(ring, maskFor))
                return exterior.length < 4 ? [] : [[exterior, ...holes.filter((hole) => hole.length >= 4)]]
            }),
        } as GeoPermissibleObjects,
        true
    )

    const lineArcs = [...usage.values()].filter(({ count }) => borders === "all" || count === 1).map(({ arc }) => arc)
    const lines: GeoContour[] = []
    for (const chain of chainArcs(lineArcs)) {
        lines.push(
            ...project(fitted, { type: "LineString", coordinates: filteredPoints(chain.refs, maskFor) } as GeoPermissibleObjects, false)
        )
    }

    const sum = (contours: GeoContour[]) => contours.reduce((total, c) => total + c.length, 0)
    const bytes = [...fills, ...lines].reduce((total, c) => total + c.points.byteLength + 32, 0)
    return {
        width: fitted.width,
        height: fitted.height,
        fills,
        lines,
        fillLength: sum(fills),
        lineLength: sum(lines),
        bytes,
    }
}

class ByteCache<V extends { bytes: number }> {
    private _entries = new Map<string, V>()
    private _bytes = 0

    constructor(private readonly _budget: number) {}

    get(key: string): V | undefined {
        const value = this._entries.get(key)
        if (value) {
            this._entries.delete(key)
            this._entries.set(key, value)
        }
        return value
    }

    set(key: string, value: V): void {
        const previous = this._entries.get(key)
        if (previous) this._bytes -= previous.bytes
        this._entries.delete(key)
        this._entries.set(key, value)
        this._bytes += value.bytes
        for (const [oldest, entry] of this._entries) {
            if (this._bytes <= this._budget || this._entries.size <= 1) break
            this._entries.delete(oldest)
            this._bytes -= entry.bytes
        }
    }

    clear(): void {
        this._entries.clear()
        this._bytes = 0
    }
}

const frames = new ByteCache<Frame & { bytes: number }>(64)
const geometries = new ByteCache<GeoGeometry>(64 * 1024 * 1024)

export interface GeoGeometryRequest {
    /** Identifies `features` and `frame`: equal keys must mean equal selections. */
    selectionKey: string
    features: readonly GeoFeature[]
    frame: GeoFrame
    projection: GeoProjectionKind
    borders: GeoBorders
    detail: number
}

/**
 * The drawing for a selection, cached. The projection is fitted to the
 * selection at full detail, so a `detail` tween never moves or rescales it.
 */
export function geoGeometry(request: GeoGeometryRequest): GeoGeometry | null {
    const detail = Math.round(clamp01(request.detail) * 100) / 100
    const frameKey = `${request.selectionKey}|${request.projection}`
    const key = `${frameKey}|${request.borders}|${detail}`
    const cached = geometries.get(key)
    if (cached) return cached

    let fitted: Frame | undefined = frames.get(frameKey)
    if (!fitted) {
        const made = fitFrame(request.projection, partsOf(request.features, request.frame))
        if (!made) return null
        fitted = made
        frames.set(frameKey, { ...made, bytes: 1 })
    }
    const geometry = buildGeometry(request.features, request.frame, fitted, request.borders, detail)
    geometries.set(key, geometry)
    return geometry
}

export function clearGeoGeometry(): void {
    frames.clear()
    geometries.clear()
}
