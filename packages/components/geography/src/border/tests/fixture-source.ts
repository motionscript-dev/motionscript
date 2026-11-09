/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { geoLoaderSource, type GeoSource } from "../registry"

// Cut from generated data by `packages/components/geography/scripts/fixture.mjs`: FR, DE and
// CH whole, and US-CA, US-NV and US-OR out of `states/US`.
const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

export const fixtureSource: GeoSource = geoLoaderSource(async (key) => {
    const path = join(root, `${key}.json`)
    return existsSync(path) ? readFileSync(path, "utf8") : null
})
