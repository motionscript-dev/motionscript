import { Paint3D, type Material3D, type StrokeResolved, type Transform3D } from "@motionscript/sdk"
import { geoGraticule } from "d3-geo"

import type { GeoContour } from "../border/geometry"

type LonLat = readonly [number, number]
type Vec3 = readonly [number, number, number]

/** Lines on the unit sphere: `points` interleaved x/y/z. */
export interface GlobeLine {
    readonly points: Float32Array
    readonly length: number
}

export interface GlobeLineSet {
    readonly lines: readonly GlobeLine[]
    readonly length: number
}

// The land picture is equirectangular, so its edges are straight in lon/lat: lines follow them the same way, a degree at a time.
const STEP_DEGREES = 1
const RAD = Math.PI / 180

/** Where `lon`/`lat` sits on the unit sphere, matching the sphere mesh's map: longitude 0 on +x, the north pole on +y. */
export function globePoint(lon: number, lat: number): Vec3 {
    const cosLat = Math.cos(lat * RAD)
    return [cosLat * Math.cos(lon * RAD), Math.sin(lat * RAD), -cosLat * Math.sin(lon * RAD)]
}

function traced(line: readonly LonLat[]): GlobeLine | null {
    if (line.length < 2) return null
    const out: number[] = []
    const push = (lon: number, lat: number) => {
        const [x, y, z] = globePoint(lon, lat)
        out.push(x, y, z)
    }
    push(line[0][0], line[0][1])
    for (let i = 1; i < line.length; i++) {
        const [lon0, lat0] = line[i - 1]
        let dLon = line[i][0] - lon0
        // A border crossing the antimeridian goes the short way round.
        if (dLon > 180) dLon -= 360
        else if (dLon < -180) dLon += 360
        const dLat = line[i][1] - lat0
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dLon), Math.abs(dLat)) / STEP_DEGREES))
        for (let k = 1; k <= steps; k++) push(lon0 + (dLon * k) / steps, lat0 + (dLat * k) / steps)
    }
    const points = Float32Array.from(out)
    let length = 0
    for (let i = 3; i < points.length; i += 3) {
        length += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1])
    }
    return { points, length }
}

export function globeLineSet(lines: readonly (readonly LonLat[])[]): GlobeLineSet {
    const traces = lines.map(traced).filter((line): line is GlobeLine => line !== null)
    return { lines: traces, length: traces.reduce((total, line) => total + line.length, 0) }
}

const MASK_PER_DEGREE = 4
const MASK_WIDTH = 360 * MASK_PER_DEGREE
const MASK_HEIGHT = 180 * MASK_PER_DEGREE

/** Where there is land, in cells of a quarter degree, from the equirectangular map `geoWorldMap` draws (even-odd, so lakes stay water). */
export function landMask(contours: readonly GeoContour[]): Uint8Array {
    const rows: number[][] = Array.from({ length: MASK_HEIGHT }, () => [])
    for (const { points } of contours) {
        const n = points.length / 2
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n
            const x0 = (points[i * 2] + 0.5) * MASK_WIDTH
            const y0 = (0.25 - points[i * 2 + 1]) * MASK_WIDTH
            const x1 = (points[j * 2] + 0.5) * MASK_WIDTH
            const y1 = (0.25 - points[j * 2 + 1]) * MASK_WIDTH
            if (y0 === y1) continue
            const top = Math.min(y0, y1)
            const bottom = Math.max(y0, y1)
            for (let r = Math.max(0, Math.ceil(top - 0.5)); r < MASK_HEIGHT && r + 0.5 < bottom; r++) {
                rows[r].push(x0 + ((r + 0.5 - y0) / (y1 - y0)) * (x1 - x0))
            }
        }
    }
    const mask = new Uint8Array(MASK_WIDTH * MASK_HEIGHT)
    rows.forEach((xs, r) => {
        xs.sort((a, b) => a - b)
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const from = Math.max(0, Math.ceil(xs[k] - 0.5))
            const to = Math.min(MASK_WIDTH, Math.ceil(xs[k + 1] - 0.5))
            mask.fill(1, r * MASK_WIDTH + from, r * MASK_WIDTH + Math.max(from, to))
        }
    })
    return mask
}

function onLand(mask: Uint8Array, lon: number, lat: number): boolean {
    const col = ((Math.floor((lon + 180) * MASK_PER_DEGREE) % MASK_WIDTH) + MASK_WIDTH) % MASK_WIDTH
    const row = Math.max(0, Math.min(MASK_HEIGHT - 1, Math.floor((90 - lat) * MASK_PER_DEGREE)))
    return mask[row * MASK_WIDTH + col] === 1
}

const graticules = new WeakMap<Uint8Array, Map<number, GlobeLineSet>>()

/** The parallels and meridians every `step` degrees, cut where they cross land. */
export function graticuleLineSet(step: number, mask: Uint8Array): GlobeLineSet {
    let bySteps = graticules.get(mask)
    if (!bySteps) graticules.set(mask, (bySteps = new Map()))
    let set = bySteps.get(step)
    if (set) return set
    const runs: LonLat[][] = []
    const fine = 1 / MASK_PER_DEGREE
    for (const line of geoGraticule().step([step, step]).lines()) {
        const points = line.coordinates as unknown as LonLat[]
        // A parallel or a meridian is straight in lon/lat, so a run over the sea keeps a point every 90° or so and
        // `traced` fills it in (fewer than 180° apart, so it never takes the antimeridian's short way).
        let run: LonLat[] = []
        const visit = (lon: number, lat: number) => {
            if (onLand(mask, lon, lat)) {
                if (run.length > 1) runs.push(run)
                run = []
                return
            }
            const anchor = run[run.length - 2]
            if (run.length < 2 || Math.abs(lon - anchor[0]) + Math.abs(lat - anchor[1]) > 90) run.push([lon, lat])
            else run[run.length - 1] = [lon, lat]
        }
        visit(points[0][0], points[0][1])
        for (let i = 1; i < points.length; i++) {
            const [lon0, lat0] = points[i - 1]
            const [lon1, lat1] = points[i]
            const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / fine))
            for (let k = 1; k <= steps; k++) visit(lon0 + ((lon1 - lon0) * k) / steps, lat0 + ((lat1 - lat0) * k) / steps)
        }
        if (run.length > 1) runs.push(run)
    }
    bySteps.set(step, (set = globeLineSet(runs)))
    return set
}

/** The segments of `set` between `start` and `end` of its whole length, on a sphere of `radius`. */
export function globeSegments(set: GlobeLineSet, start: number, end: number, radius: number): Paint3D.Segment3D[] {
    const out: Paint3D.Segment3D[] = []
    const from = Math.max(0, start) * set.length
    const to = Math.min(1, end) * set.length
    if (!(to > from)) return out
    let at = 0
    for (const { points, length } of set.lines) {
        if (at + length <= from) {
            at += length
            continue
        }
        if (at >= to) break
        for (let i = 3; i < points.length; i += 3) {
            const p: Vec3 = [points[i - 3], points[i - 2], points[i - 1]]
            const q: Vec3 = [points[i], points[i + 1], points[i + 2]]
            const step = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
            const a = at
            at += step
            if (at <= from || step <= 0) continue
            if (a >= to) break
            const t0 = Math.max(0, (from - a) / step)
            const t1 = Math.min(1, (to - a) / step)
            const lerp = (t: number): Vec3 => [
                (p[0] + (q[0] - p[0]) * t) * radius,
                (p[1] + (q[1] - p[1]) * t) * radius,
                (p[2] + (q[2] - p[2]) * t) * radius,
            ]
            out.push([lerp(t0), lerp(t1)])
        }
    }
    return out
}

/** The bars one stroke layer draws, `unit` scene units to a stroke unit; `null` when the layer draws nothing. */
export function globeBars(
    layer: StrokeResolved,
    segments: readonly Paint3D.Segment3D[],
    unit: number,
): { material: Material3D; bars: Transform3D[] } | null {
    if (!(layer.weight > 0) || segments.length === 0) return null
    const solid = layer.fill.find((fill) => fill.type === "solid" && fill.blend === undefined)
    if (!solid || solid.type !== "solid") return null
    const [r, g, b, a = 1] = solid.color
    const alpha = a * (solid.opacity ?? 1)
    if (alpha <= 0) return null
    const w = layer.weight * unit
    const extend = layer.cap === "square" ? w / 2 : 0
    const dash = layer.dash && layer.dash.length > 0 ? layer.dash.map((d) => Math.max(0, d) * unit) : null
    const pattern = dash && (dash.length % 2 === 1 ? [...dash, ...dash] : dash)
    const live = pattern && pattern.reduce((sum, d) => sum + d, 0) > 1e-9 ? pattern : null
    const offset = layer.dashOffset * unit
    const bars: Transform3D[] = []
    for (const [p, q] of segments) {
        if (live === null) {
            bars.push(Paint3D.bar(p, q, w, extend))
            continue
        }
        const length = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
        const at = (s: number): Vec3 => {
            const t = s / length
            return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]
        }
        for (const [a0, a1] of Paint3D.dashes(length, live, offset)) bars.push(Paint3D.bar(at(a0), at(a1), w, extend))
    }
    // Blended, so they draw after the horizon's depth-only sphere and hide behind it.
    const material: Material3D = { type: "basic", color: [r, g, b, 1], opacity: alpha, transparent: true, depthWrite: false, toneMapped: false }
    return { material, bars }
}
