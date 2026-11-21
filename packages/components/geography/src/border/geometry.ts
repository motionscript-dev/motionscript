import {
    geoArea,
    geoBounds,
    geoClipAntimeridian,
    geoClipCircle,
    geoConicEqualArea,
    geoConicEqualAreaRaw,
    geoEquirectangular,
    geoEquirectangularRaw,
    geoMercator,
    geoMercatorRaw,
    geoOrthographic,
    geoOrthographicRaw,
    geoPath,
    geoProjection,
    geoStream,
    type GeoPermissibleObjects,
    type GeoProjection,
    type GeoRawProjection,
} from "d3-geo"

import { ringCoordinates, type GeoArc, type GeoFeature, type GeoPolygon, type GeoRingRef } from "./format"
import type { GeoFrame } from "./selection"

export type GeoProjectionKind = "conic" | "mercator" | "equirectangular" | "orthographic"
export type GeoBorders = "all" | "outline"

/** A projection part way through a tween from one kind to another. */
export interface GeoProjectionBlend {
    readonly from: GeoProjectionKind
    readonly to: GeoProjectionKind
    /** 0 at `from`, 1 at `to`. */
    readonly t: number
}

export type GeoProjectionValue = GeoProjectionKind | GeoProjectionBlend

const nearestKind = (value: GeoProjectionValue): GeoProjectionKind =>
    typeof value === "string" ? value : value.t < 0.5 ? value.from : value.to

/**
 * Tweens one projection into another. A tween that starts part way through another one
 * starts from whichever end that one was nearer.
 */
export function lerpGeoProjection(from: GeoProjectionValue, to: GeoProjectionValue, t: number): GeoProjectionValue {
    if (t <= 0) return from
    if (t >= 1) return to
    const a = nearestKind(from)
    const b = nearestKind(to)
    return a === b ? a : { from: a, to: b, t }
}

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
    /** The projection before rotation, scale and translation: what a blend between two frames mixes. */
    raw: GeoRawProjection
    kind: GeoProjectionKind
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

const RADIANS = Math.PI / 180
// Where Mercator's square world ends, as its own projection clips it.
const MERCATOR_LAT = 2 * Math.atan(Math.exp(Math.PI)) - Math.PI / 2

const mercatorRaw: GeoRawProjection = (lambda, phi) =>
    geoMercatorRaw(lambda, phi > MERCATOR_LAT ? MERCATOR_LAT : phi < -MERCATOR_LAT ? -MERCATOR_LAT : phi)

function makeProjection(
    kind: GeoProjectionKind,
    west: number,
    south: number,
    east: number,
    north: number
): { projection: GeoProjection; raw: GeoRawProjection } {
    const lon = centerLongitude(west, east)
    const lat = (south + north) / 2
    switch (kind) {
        case "mercator":
            return { projection: geoMercator().rotate([-lon, 0]), raw: mercatorRaw }
        case "equirectangular":
            return { projection: geoEquirectangular().rotate([-lon, 0]), raw: geoEquirectangularRaw }
        case "orthographic":
            return { projection: geoOrthographic().rotate([-lon, -lat]), raw: geoOrthographicRaw }
        case "conic": {
            const span = north - south
            const parallels: [number, number] = [south + span / 6, north - span / 6]
            return {
                projection: geoConicEqualArea().rotate([-lon, 0]).center([0, lat]).parallels(parallels),
                raw: geoConicEqualAreaRaw(parallels[0] * RADIANS, parallels[1] * RADIANS),
            }
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
        const made = makeProjection(candidate, west, south, east, north)
        const projection = made.projection.fitSize([FIT, FIT], shape)
        const [[x0, y0], [x1, y1]] = geoPath(projection).bounds(shape)
        const size = Math.max(x1 - x0, y1 - y0)
        if (!Number.isFinite(size) || size <= 0) continue
        return {
            projection,
            raw: made.raw,
            kind: candidate,
            centerX: (x0 + x1) / 2,
            centerY: (y0 + y1) / 2,
            size,
            width: (x1 - x0) / size,
            height: (y1 - y0) / size,
        }
    }
    return null
}

/** The affine its fitted projection puts between `raw` and unit space, which is the same scale on both axes. */
function unitAffine(frame: Frame): { k: number; x: number; y: number } {
    const p = frame.projection
    const k = p.scale()
    const [tx, ty] = p.translate()
    const [lambda, phi] = p.center()
    const [cx, cy] = frame.raw(lambda * RADIANS, phi * RADIANS)
    return { k: k / frame.size, x: (tx - k * cx - frame.centerX) / frame.size, y: (frame.centerY - ty - k * cy) / frame.size }
}

const wrap180 = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

/**
 * Two fitted frames mixed point by point in unit space, so the drawing at `t` 0 and 1 is
 * each end's own. A blend with orthographic narrows the clip towards its hemisphere as it
 * goes, and cuts at the antimeridian as the flat maps do.
 */
function blendFrames(a: Frame, b: Frame, t: number): Frame {
    const ma = unitAffine(a)
    const mb = unitAffine(b)
    const s = 1 - t
    const raw: GeoRawProjection = (lambda, phi) => {
        const [xa, ya] = a.raw(lambda, phi)
        const [xb, yb] = b.raw(lambda, phi)
        return [s * (ma.k * xa + ma.x) + t * (mb.k * xb + mb.x), s * (ma.k * ya + ma.y) + t * (mb.k * yb + mb.y)]
    }
    const [la, pa, ga] = a.projection.rotate()
    const [lb, pb, gb] = b.projection.rotate()
    // d3 puts the raw projection's (0, 0) at the translate; here that point is not the origin.
    const [ox, oy] = raw(0, 0)
    const projection = geoProjection(raw)
        .rotate([la + wrap180(lb - la) * t, pa + (pb - pa) * t, ga + (gb - ga) * t])
        .scale(1)
        .translate([ox, -oy])
        .precision(Math.SQRT1_2 / FIT)
    const globe = (a.kind === "orthographic" ? s : 0) + (b.kind === "orthographic" ? t : 0)
    if (globe > 0) {
        const circle = geoClipCircle((90 + 90 * (1 - globe)) * RADIANS)
        projection.preclip((stream) => geoClipAntimeridian(circle(stream)))
    }
    return {
        projection,
        raw,
        kind: t < 0.5 ? a.kind : b.kind,
        centerX: 0,
        centerY: 0,
        size: 1,
        width: s * a.width + t * b.width,
        height: s * a.height + t * b.height,
    }
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

type LonLat = [number, number]

export interface GeoOutlines {
    /** Kept polygons in lon/lat degrees, exterior ring first, every ring closed. */
    polygons: LonLat[][][]
    /** Borders in lon/lat degrees: every border, or the outer ones only for `outline`. */
    lines: LonLat[][]
    bytes: number
}

/** A polygon's identity across files: a territory its country's file also holds is the same arcs. */
const polygonKey = (polygon: GeoPolygon) => [...new Set(polygon.rings[0].map(({ arc }) => String(arc.key)))].sort().join(",")

function simplify(features: readonly GeoFeature[], frame: GeoFrame, borders: GeoBorders, detail: number): GeoOutlines {
    const parts = partsOf(features, frame)
    const area = parts.reduce((sum, { polygon }) => sum + polygon.area, 0)
    const pointLimit = pointBucketLimit(detail, area)
    const polygonLimit = polygonAreaLimit(detail, area)

    // Two selected regions can both carry one polygon (France and Guadeloupe):
    // filled twice it darkens, and its coast would count as a shared border.
    const seen = new Set<string>()
    const kept: GeoRingRef[][][] = []
    for (const { polygon, largest } of parts) {
        if (!largest && polygon.area < polygonLimit) continue
        const key = polygonKey(polygon)
        if (seen.has(key)) continue
        seen.add(key)
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

    const polygons = kept.flatMap((rings) => {
        const [exterior, ...holes] = rings.map((ring) => filteredPoints(ring, maskFor))
        return exterior.length < 4 ? [] : [[exterior, ...holes.filter((hole) => hole.length >= 4)]]
    })
    const lineArcs = [...usage.values()].filter(({ count }) => borders === "all" || count === 1).map(({ arc }) => arc)
    const lines = chainArcs(lineArcs).map((chain) => filteredPoints(chain.refs, maskFor))

    let points = 0
    for (const polygon of polygons) for (const ring of polygon) points += ring.length
    for (const line of lines) points += line.length
    return { polygons, lines, bytes: points * 48 + 64 }
}

const multiPolygon = (polygons: LonLat[][][]) => ({ type: "MultiPolygon", coordinates: polygons }) as GeoPermissibleObjects
const lineString = (line: LonLat[]) => ({ type: "LineString", coordinates: line }) as GeoPermissibleObjects

const totalLength = (contours: readonly GeoContour[]) => contours.reduce((total, c) => total + c.length, 0)
const byteSize = (contours: readonly GeoContour[]) => contours.reduce((total, c) => total + c.points.byteLength + 32, 0)

function buildGeometry(outlines: GeoOutlines, fitted: Frame): GeoGeometry {
    const fills = project(fitted, multiPolygon(outlines.polygons), true)
    const lines = outlines.lines.flatMap((line) => project(fitted, lineString(line), false))
    return {
        width: fitted.width,
        height: fitted.height,
        fills,
        lines,
        fillLength: totalLength(fills),
        lineLength: totalLength(lines),
        bytes: byteSize(fills) + byteSize(lines),
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
const outlinesCache = new ByteCache<GeoOutlines>(64 * 1024 * 1024)
const geometries = new ByteCache<GeoGeometry>(64 * 1024 * 1024)
// Apart from the ends', so the frames of one tween never push those out.
const blends = new ByteCache<GeoGeometry>(16 * 1024 * 1024)

const roundDetail = (detail: number) => Math.round(clamp01(detail) * 100) / 100

export interface GeoOutlinesRequest {
    /** Identifies `features`: equal keys must mean equal selections. */
    selectionKey: string
    features: readonly GeoFeature[]
    frame: GeoFrame
    borders: GeoBorders
    detail: number
}

/** A selection simplified for `detail`, before any projection; cached, so a globe can turn without simplifying again. */
export function geoOutlines(request: GeoOutlinesRequest): GeoOutlines {
    const detail = roundDetail(request.detail)
    const key = `${request.selectionKey}|${request.frame}|${request.borders}|${detail}`
    const cached = outlinesCache.get(key)
    if (cached) return cached
    const outlines = simplify(request.features, request.frame, request.borders, detail)
    outlinesCache.set(key, outlines)
    return outlines
}

export interface GeoGeometryRequest extends GeoOutlinesRequest {
    projection: GeoProjectionValue
}

function fittedFrame(request: GeoGeometryRequest, kind: GeoProjectionKind): Frame | null {
    const frameKey = `${request.selectionKey}|${kind}`
    const cached = frames.get(frameKey)
    if (cached) return cached
    const made = fitFrame(kind, partsOf(request.features, request.frame))
    if (made) frames.set(frameKey, { ...made, bytes: 1 })
    return made
}

/**
 * The drawing for a selection, cached. The projection is fitted to the
 * selection at full detail, so a `detail` tween never moves or rescales it.
 * A blend mixes the two ends' fits, extent included, so a box fitting the
 * drawing scales smoothly from one end's shape to the other's.
 */
export function geoGeometry(request: GeoGeometryRequest): GeoGeometry | null {
    const detail = roundDetail(request.detail)
    const { projection } = request
    const blend = typeof projection === "string" ? null : projection
    const t = blend ? Math.round(clamp01(blend.t) * 1000) / 1000 : 0
    if (blend && (t === 0 || t === 1 || blend.from === blend.to)) {
        return geoGeometry({ ...request, projection: t === 1 ? blend.to : blend.from })
    }
    const kinds = blend ? `${blend.from}>${blend.to}@${t}` : (projection as GeoProjectionKind)
    const key = `${request.selectionKey}|${kinds}|${request.frame}|${request.borders}|${detail}`
    const cache = blend ? blends : geometries
    const cached = cache.get(key)
    if (cached) return cached

    let fitted: Frame | null
    if (blend) {
        const a = fittedFrame(request, blend.from)
        const b = fittedFrame(request, blend.to)
        fitted = a && b ? blendFrames(a, b, t) : null
    } else {
        fitted = fittedFrame(request, projection as GeoProjectionKind)
    }
    if (!fitted) return null
    const geometry = buildGeometry(geoOutlines({ ...request, detail }), fitted)
    cache.set(key, geometry)
    return geometry
}

/**
 * `outlines` on an equirectangular world map in unit space: 360° of longitude spans 1 and 180° of latitude 0.5,
 * centred on the origin, y up. d3 cuts each ring at the antimeridian and closes a ring round a pole along the map's
 * edge, so Antarctica fills to the bottom.
 */
export function geoWorldMap(outlines: GeoOutlines): GeoContour[] {
    const cached = worldMaps.get(outlines)
    if (cached) return cached
    const frame: Frame = {
        projection: geoEquirectangular().scale(1 / (2 * Math.PI)).translate([0, 0]),
        raw: geoEquirectangularRaw,
        kind: "equirectangular",
        centerX: 0,
        centerY: 0,
        size: 1,
        width: 1,
        height: 0.5,
    }
    const contours = project(frame, multiPolygon(outlines.polygons), true)
    worldMaps.set(outlines, contours)
    return contours
}

const worldMaps = new WeakMap<GeoOutlines, GeoContour[]>()

export function clearGeoGeometry(): void {
    frames.clear()
    outlinesCache.clear()
    geometries.clear()
    blends.clear()
}
