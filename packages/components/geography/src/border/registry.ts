import { geoArea } from "d3-geo"

import {
    GEO_DATA_FORMAT,
    type GeoFeature,
    type GeoFileData,
    type GeoIndex,
    type GeoPolygon,
    type GeoRingRef,
} from "./format"
import { ringBuckets } from "./simplify"

/** Prefix every data key carries; bumped with the file format. */
export const GEO_DATA_VERSION = `v${GEO_DATA_FORMAT}`

/**
 * Answers a data key — `v1/countries/FR`, `v1/states/US`, `v1/index` — with the
 * parsed file, or `null` when this source does not have it. A throw means "could
 * not tell" (offline, a 500) and is retried on the next load.
 */
export type GeoSource = (key: string) => Promise<unknown>

type Position = readonly [number, number] | readonly number[]
type GeoPolygonShape =
    | { type: "Polygon"; coordinates: readonly (readonly Position[])[] }
    | { type: "MultiPolygon"; coordinates: readonly (readonly (readonly Position[])[])[] }
/** GeoJSON in lon/lat: a Polygon, a MultiPolygon, or a Feature holding one. */
export type GeoShape = GeoPolygonShape | { type: "Feature"; geometry: GeoPolygonShape; properties?: { name?: string } | null }

export interface GeoDefinition {
    shape: GeoShape
    name?: string
    /** The country a subdivision code expands under, when it has one. */
    parent?: string
}

/** Fetches `<base>/<key>.json`; `base` may instead map a key to its URL. */
export function geoUrlSource(base: string | ((key: string) => string), init?: RequestInit): GeoSource {
    return async (key) => {
        const url = typeof base === "function" ? base(key) : `${base.replace(/\/+$/, "")}/${key}.json`
        const response = await fetch(url, init)
        // Some object stores answer a missing key with 400, not 404.
        if (response.status === 404 || response.status === 400) return null
        if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
        return response.json()
    }
}

/** Wraps a function returning the file as text, bytes or parsed JSON (e.g. `fs.readFile`). */
export function geoLoaderSource(
    load: (key: string) => Promise<string | ArrayBuffer | Uint8Array | object | null | undefined>
): GeoSource {
    return async (key) => {
        const value = await load(key)
        if (value == null) return null
        if (typeof value === "string") return JSON.parse(value)
        if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
            return JSON.parse(new TextDecoder().decode(value))
        }
        return value
    }
}

function definedFeature(code: string, definition: GeoDefinition, serial: number): GeoFeature {
    const shape = definition.shape.type === "Feature" ? definition.shape.geometry : definition.shape
    const feature = definition.shape.type === "Feature" ? definition.shape : null
    const polygons: readonly (readonly (readonly Position[])[])[] =
        shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates
    let arcIndex = 0

    /**
     * One ring, wound the way d3 reads it. d3 takes the *inside* of a ring to be
     * the side its points go clockwise around, so an exterior must be small
     * (`geoArea` under a hemisphere) and a hole its complement. GeoJSON (RFC 7946)
     * writes the opposite way round, counter-clockwise exteriors, and a ring
     * taken as written would fill the rest of the sphere; so a ring that reads
     * the wrong way for its place is reversed.
     */
    const toRing = (ring: readonly Position[], exterior: boolean): GeoRingRef => {
        const closed = ring.length > 0 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        let coordinates = closed ? ring : [...ring, ring[0]]
        const encloses = geoArea({ type: "Polygon", coordinates: [coordinates as [number, number][]] }) <= 2 * Math.PI
        if (encloses !== exterior) coordinates = [...coordinates].reverse()
        const points = new Float64Array(coordinates.length * 2)
        coordinates.forEach(([lon, lat], i) => {
            points[i * 2] = lon
            points[i * 2 + 1] = lat
        })
        return { arc: { key: `define:${serial}:${code}:${arcIndex++}`, points, buckets: ringBuckets(points) }, reversed: false }
    }

    const measured: GeoPolygon[] = polygons.map((rings) => {
        const resolved = rings.map((ring, i) => [toRing(ring, i === 0)])
        const ringAreas = rings.map((ring) => {
            const area = geoArea({ type: "Polygon", coordinates: [ring as [number, number][]] })
            return area > 2 * Math.PI ? 4 * Math.PI - area : area
        })
        const area = Math.max(0, ringAreas[0] - ringAreas.slice(1).reduce((a, b) => a + b, 0))
        return { rings: resolved, ringAreas, area, mainland: true }
    })

    const name = definition.name ?? feature?.properties?.name ?? code
    return {
        code,
        name,
        nameNl: name,
        parent: definition.parent ?? (code.includes("-") ? code.slice(0, 2) : null),
        first: true,
        listed: false,
        remote: false,
        polygons: measured,
    }
}

class GeoRegistry {
    private _sources: GeoSource[] = []
    private _defined = new Map<string, { serial: number; feature: GeoFeature }>()
    private _generation = 0
    private _serial = 0

    /** Bumps whenever a source or a definition is added or removed. */
    get generation(): number {
        return this._generation
    }

    get hasSources(): boolean {
        return this._sources.length > 0
    }

    /** Adds a source after every source already registered. Returns its removal. */
    use(source: GeoSource): () => void {
        this._sources.push(source)
        this._generation++
        return () => {
            const i = this._sources.indexOf(source)
            if (i < 0) return
            this._sources.splice(i, 1)
            this._generation++
        }
    }

    /**
     * Shapes (GeoJSON, lon/lat) under codes of your choosing, checked before any
     * source. A definition replaces generated data for the same code.
     */
    define(shapes: Record<string, GeoShape | GeoDefinition>): () => void {
        const serial = ++this._serial
        const codes = Object.entries(shapes).map(([rawCode, value]) => {
            const code = rawCode.trim().toUpperCase()
            const definition = "shape" in value ? value : { shape: value }
            this._defined.set(code, { serial, feature: definedFeature(code, definition, serial) })
            return code
        })
        this._generation++
        return () => {
            for (const code of codes) {
                if (this._defined.get(code)?.serial === serial) this._defined.delete(code)
            }
            this._generation++
        }
    }

    defined(code: string): GeoFeature | undefined {
        return this._defined.get(code)?.feature
    }

    /** Removes every source and definition — for tests. */
    reset(): void {
        this._sources = []
        this._defined.clear()
        this._generation++
    }

    /**
     * Asks each source in registration order; the first non-null answer wins.
     * Resolves `null` only when every source answered that it has no such file.
     */
    async resolve(key: string): Promise<GeoFileData | GeoIndex | null> {
        if (this._sources.length === 0) {
            throw new Error("No geo source registered — call geoRegistry.use(geoUrlSource(…)) before rendering GeoBorder")
        }
        let failure: unknown = null
        for (const source of [...this._sources]) {
            try {
                const value = await source(key)
                if (value != null) return value as GeoFileData | GeoIndex
            } catch (error) {
                failure ??= error
            }
        }
        if (failure) throw failure
        return null
    }

    /** Every listed region's code, names and parent, for a picker. */
    async index(): Promise<GeoIndex | null> {
        return (await this.resolve(`${GEO_DATA_VERSION}/index`)) as GeoIndex | null
    }
}

export const geoRegistry = new GeoRegistry()
