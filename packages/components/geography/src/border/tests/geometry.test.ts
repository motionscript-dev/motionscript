import { geoArea } from "d3-geo"
import { beforeAll, describe, expect, it } from "vitest"

import { clearGeoGeometry, geoGeometry, type GeoBorders, type GeoProjectionKind } from "../geometry"
import { countryFileKey, geoFileEntry, loadGeoFile, statesFileKey } from "../loader"
import { geoRegistry } from "../registry"
import { selectGeoFeatures, type GeoFrame, type GeoLevel } from "../selection"
import { fixtureSource } from "./fixture-source"

beforeAll(async () => {
    geoRegistry.use(fixtureSource)
    for (const key of [countryFileKey("FR"), countryFileKey("DE"), countryFileKey("CH"), statesFileKey("US")]) {
        await loadGeoFile(key)
    }
})

interface Options {
    detail?: number
    borders?: GeoBorders
    frame?: GeoFrame
    level?: GeoLevel
    projection?: GeoProjectionKind
}

function draw(codes: string[], { detail = 1, borders = "all", frame = "all", level = "country", projection = "conic" }: Options = {}) {
    clearGeoGeometry()
    const selection = selectGeoFeatures(codes, level, frame)
    const geometry = geoGeometry({ selectionKey: codes.join(), features: selection.features, frame, projection, borders, detail })
    if (!geometry) throw new Error(`no geometry for ${codes}`)
    return geometry
}

/** d3's reading of one stored ring on its own: the small region it encloses, or the rest of the sphere. */
function areaOf(ring: Float64Array): number {
    const coordinates: [number, number][] = []
    for (let i = 0; i < ring.length; i += 2) coordinates.push([ring[i], ring[i + 1]])
    return geoArea({ type: "Polygon", coordinates: [coordinates] })
}

const points = (contours: { points: Float32Array }[]) => contours.reduce((n, c) => n + c.points.length / 2, 0)

describe("GeoBorder geometry", () => {
    it("gives a border two files share the same arc id in both", () => {
        const fr = geoFileEntry(countryFileKey("FR"))
        const de = geoFileEntry(countryFileKey("DE"))
        if (fr?.status !== "ready" || de?.status !== "ready") throw new Error("fixture not loaded")
        const keys = (entry: typeof fr) =>
            new Set(
                [...entry.file.features.values()].flatMap((f) => f.polygons.flatMap((p) => p.rings.flat().map((r) => r.arc.key)))
            )
        const deKeys = keys(de)
        expect([...keys(fr)].filter((key) => deKeys.has(key)).length).toBeGreaterThan(0)
    })

    it("strokes a shared border once, and leaves it out of an outline", () => {
        const together = draw(["FR", "DE"])
        const outline = draw(["FR", "DE"], { borders: "outline" })
        expect(outline.lineLength).toBeLessThan(together.lineLength)
        expect(points(outline.lines)).toBeLessThan(points(together.lines))
    })

    it("keeps more of the outline as detail rises", () => {
        const counts = [0, 0.25, 0.5, 0.75, 1].map((detail) => points(draw(["FR"], { detail }).fills))
        for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
        expect(counts[0]).toBeLessThan(counts[4] / 10)
    })

    it("never loses a region entirely, however low the detail", () => {
        const geometry = draw(["FR", "CH", "US-NV"], { detail: 0 })
        expect(geometry.fills.length).toBeGreaterThanOrEqual(3)
        for (const contour of geometry.fills) expect(contour.points.length / 2).toBeGreaterThanOrEqual(3)
    })

    it("does not move or rescale the drawing when only detail changes", () => {
        const low = draw(["FR"], { detail: 0.2 })
        const high = draw(["FR"], { detail: 1 })
        expect(low.width).toBeCloseTo(high.width, 6)
        expect(low.height).toBeCloseTo(high.height, 6)
    })

    it("frames metropolitan France without the overseas departments", () => {
        const mainland = draw(["FR"], { frame: "mainland" })
        const all = draw(["FR"], { frame: "all" })
        expect(points(mainland.fills)).toBeLessThan(points(all.fills))
        expect(mainland.width / mainland.height).toBeGreaterThan(0.7)
        expect(mainland.width / mainland.height).toBeLessThan(1.3)
    })

    it("keeps a shape across the antimeridian in one piece", () => {
        const dispose = geoRegistry.define({
            "XX-DATELINE": { type: "Polygon", coordinates: [[[170, -10], [170, 10], [-170, 10], [-170, -10], [170, -10]]] },
        })
        const geometry = draw(["XX-DATELINE"], { projection: "equirectangular" })
        dispose()
        expect(geometry.width).toBeCloseTo(1, 1)
        expect(geometry.height).toBeCloseTo(1, 1)
    })

    it("reads a counter-clockwise ring, as GeoJSON writes it, as the small region it encloses", () => {
        // The same box as the dateline test, wound both ways: d3 reads a clockwise exterior as the
        // inside, so a counter-clockwise one used to fill the rest of the sphere.
        const clockwise = [[170, -10], [170, 10], [-170, 10], [-170, -10], [170, -10]]
        const dispose = geoRegistry.define({
            "XX-CW": { type: "Polygon", coordinates: [clockwise] },
            "XX-CCW": { type: "Polygon", coordinates: [[...clockwise].reverse()] },
        })
        const cw = draw(["XX-CW"], { projection: "equirectangular" })
        const ccw = draw(["XX-CCW"], { projection: "equirectangular" })
        dispose()
        expect(ccw.width).toBeCloseTo(cw.width, 6)
        expect(ccw.height).toBeCloseTo(cw.height, 6)
        expect(points(ccw.fills)).toBe(points(cw.fills))
    })

    it("keeps a hole a hole whichever way it is wound", () => {
        const outer = [[-20, -20], [-20, 20], [20, 20], [20, -20], [-20, -20]]
        const hole = [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]]
        const dispose = geoRegistry.define({
            "XX-RING": { type: "Polygon", coordinates: [[...outer].reverse(), hole] },
            "XX-RING2": { type: "Polygon", coordinates: [outer, [...hole].reverse()] },
        })
        const a = geoRegistry.defined("XX-RING")!.polygons[0]
        const b = geoRegistry.defined("XX-RING2")!.polygons[0]
        dispose()
        // Every ring is stored so that d3 reads the exterior as the small region and the hole as its complement.
        for (const polygon of [a, b]) {
            const [exterior, inner] = polygon.rings.map((rings) => areaOf(rings[0].arc.points))
            expect(exterior).toBeLessThan(2 * Math.PI)
            expect(inner).toBeGreaterThan(2 * Math.PI)
        }
    })

    it("draws the lines between neighbouring states only when borders is all", () => {
        const codes = ["US-CA", "US-NV", "US-OR"]
        expect(selectGeoFeatures(codes, "state", "mainland").features.map((f) => f.code)).toEqual(codes)
        expect(draw(codes).lineLength).toBeGreaterThan(draw(codes, { borders: "outline" }).lineLength)
    })
})
