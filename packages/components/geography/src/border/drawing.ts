import { Graphics2D, Types, type EntryOptions, type PathBounds, type Size2D, type Type } from "@motionscript/sdk"
import { snapValue } from "@motionscript/sdk/component"

import type { GeoContour } from "./geometry"

export interface GeoChunk {
    data: string
    /** Where this chunk's contours sit along the whole drawing, as fractions of its length. */
    from: number
    to: number
}

// A renderer's cost for one path grows faster than its contour count, and a shape
// drawn as several paths under one paint is unioned every frame — so a region
// is cut into paths of bounded size, each painted on its own.
const CONTOURS_PER_PATH = 256
const POINTS_PER_PATH = 40_000

const coordinate = (value: number) => String(Math.round(value * 100) / 100)

/** Unit-space contours (y up) as path data at `scale` px a unit, cut into paths of bounded size. */
export function geoChunks(contours: readonly GeoContour[], total: number, scale: number): GeoChunk[] {
    const chunks: GeoChunk[] = []
    let parts: string[] = []
    let count = 0
    let points = 0
    let from = 0
    let length = 0
    const flush = () => {
        if (count === 0) return
        const to = total > 0 ? Math.min(1, length / total) : 1
        chunks.push({ data: parts.join(""), from, to })
        from = to
        parts = []
        count = 0
        points = 0
    }
    for (const contour of contours) {
        const p = contour.points
        // Path data is y-down; the unit geometry is y-up.
        for (let i = 0; i < p.length; i += 2) {
            parts.push(i === 0 ? "M" : "L", coordinate(p[i] * scale), " ", coordinate(-p[i + 1] * scale))
        }
        if (contour.closed) parts.push("Z")
        count++
        points += p.length / 2
        length += contour.length
        if (count >= CONTOURS_PER_PATH || points >= POINTS_PER_PATH) flush()
    }
    flush()
    return chunks
}

/** Adds `chunk` to `g` in a box of `size`, trimmed by `start`/`end` along the whole drawing; `false` when none of it is drawn. */
export function geoChunkPath(g: Graphics2D, chunk: GeoChunk, size: Size2D, start: number, end: number): boolean {
    const { width, height } = size
    const centerBounds: PathBounds = [-width / 2, -height / 2, width / 2, height / 2]
    if (start <= 0 && end >= 1) {
        g.path({ data: chunk.data, centerBounds })
        return true
    }
    const span = chunk.to - chunk.from
    if (span <= 0) return false
    const localStart = Math.max(0, (start - chunk.from) / span)
    const localEnd = Math.min(1, (end - chunk.from) / span)
    if (localEnd <= localStart) return false
    g.path({ data: chunk.data, centerBounds, start: localStart, end: localEnd })
    return true
}

/** One of `values`, switched at the end of a `to`, with its choices listed as its `options`. */
export function geoChoice<const V extends readonly string[]>(values: V, initial: V[number]): Type<V[number]> {
    return Types.custom<V[number], V[number], EntryOptions & { readonly options: V }>(initial, { lerp: snapValue, options: values })
}
