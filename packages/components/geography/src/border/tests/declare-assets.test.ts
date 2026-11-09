import { describe, expect, it } from "vitest"
import { AssetDeclaration, ManifestAssetCatalog } from "@motionscript/core"

import { GeoBorder } from "../geo-border"

const catalog = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} })

function loaders(props: ConstructorParameters<typeof GeoBorder>[0]) {
    const scope = new AssetDeclaration(catalog)
    new GeoBorder(props).declareAssets(scope)
    return [...scope.declarations.values()].flatMap((d) => (d.type === "loader" ? [d] : []))
}

describe("GeoBorder declares its data files", () => {
    it("one country file per country", () => {
        expect(loaders({ iso: ["FR", "DE"] }).map((d) => d.key)).toEqual(["geo:v1/countries/FR", "geo:v1/countries/DE"])
    })

    it("one subdivision file for several states of a country", () => {
        expect(loaders({ iso: "us-ca, US-NV" }).map((d) => d.key)).toEqual(["geo:v1/states/US"])
    })

    it("the subdivision file for a bare country at state level", () => {
        expect(loaders({ iso: "US", level: "state" }).map((d) => d.key)).toEqual(["geo:v1/states/US"])
    })

    it("gates the draw, not layout: the box never waits on data", () => {
        expect(loaders({ iso: "FR" }).map((d) => d.gate)).toEqual(["render"])
    })

    it("hands every node the same loader for a file", () => {
        const [a] = loaders({ iso: "FR" })
        const [b] = loaders({ iso: ["FR"], detail: 0.1 })
        expect(a.load).toBe(b.load)
    })
})
