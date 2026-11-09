import { afterEach, describe, expect, it, vi } from "vitest"

import { clearGeoFiles, countryFileKey, loadGeoFile, statesFileKey } from "../loader"
import { geoRegistry, geoUrlSource } from "../registry"
import { selectGeoFeatures } from "../selection"
import { fixtureSource } from "./fixture-source"

const square = {
    type: "Polygon" as const,
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
}

afterEach(() => {
    geoRegistry.reset()
    clearGeoFiles()
    vi.restoreAllMocks()
})

describe("geoRegistry", () => {
    it("says what to do when nothing is registered, instead of drawing nothing silently", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const entry = await loadGeoFile(countryFileKey("FR"))
        expect(entry.status).toBe("failed")
        expect(String((entry as { error: unknown }).error)).toMatch(/No geo source registered/)
    })

    it("asks sources in order and falls through a source that lacks the file", async () => {
        const empty = vi.fn(async () => null)
        geoRegistry.use(empty)
        geoRegistry.use(fixtureSource)
        const entry = await loadGeoFile(countryFileKey("FR"))
        expect(empty).toHaveBeenCalledWith("v1/countries/FR")
        expect(entry.status).toBe("ready")
    })

    it("retries a file that failed, rather than remembering the failure", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        let calls = 0
        geoRegistry.use(async (key) => {
            if (calls++ === 0) throw new Error("offline")
            return fixtureSource(key)
        })
        expect((await loadGeoFile(countryFileKey("DE"))).status).toBe("failed")
        expect((await loadGeoFile(countryFileKey("DE"))).status).toBe("ready")
    })

    it("stands a country's outline in for its states when it has no subdivisions file", async () => {
        geoRegistry.use(fixtureSource)
        await loadGeoFile(statesFileKey("CH"))
        const selection = selectGeoFeatures(["CH"], "state", "mainland")
        expect(selection.features.map((f) => f.code)).toEqual(["CH"])
    })

    it("prefers a defined shape over any source, and forgets it when disposed", async () => {
        geoRegistry.use(fixtureSource)
        await loadGeoFile(countryFileKey("FR"))
        const dispose = geoRegistry.define({ FR: { shape: square, name: "Not France" } })
        expect(selectGeoFeatures(["FR"], "country", "all").features[0].name).toBe("Not France")
        dispose()
        expect(selectGeoFeatures(["FR"], "country", "all").features[0].name).toBe("France")
    })

    it("treats the 400 some object stores answer for a missing key as absent", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 400 }))
        await expect(geoUrlSource("https://example.test/geo")("v1/countries/ZZ")).resolves.toBeNull()
        expect(fetch).toHaveBeenCalledWith("https://example.test/geo/v1/countries/ZZ.json", undefined)
    })
})
