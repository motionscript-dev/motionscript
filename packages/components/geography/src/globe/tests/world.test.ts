/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import type { GeoIndex } from "../../border/format"
import { GEO_WORLD } from "../world"

// `data/` is generated, so this runs where it has been (a dev checkout, a pack), and skips elsewhere.
const index = join(dirname(fileURLToPath(import.meta.url)), "../../../data/v1/index.json")

describe.skipIf(!existsSync(index))("the world list", () => {
    it("is every country file the generated data ships", () => {
        const data = JSON.parse(readFileSync(index, "utf8")) as GeoIndex
        const countries = data.regions.filter(([, , , parent]) => parent === null).map(([code]) => code).sort()
        expect([...GEO_WORLD].sort()).toEqual(countries)
    })
})
