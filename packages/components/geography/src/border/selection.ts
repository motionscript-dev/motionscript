import type { GeoFeature } from "./format"
import { countryFileKey, geoFileEntry, statesFileKey } from "./loader"
import { geoRegistry } from "./registry"

export type GeoLevel = "country" | "state"
export type GeoFrame = "mainland" | "all"

const CODE = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/

/** `"fr, de"`, `["FR", "de"]` → `["FR", "DE"]`; unique, in order, empties dropped. */
export function normalizeIso(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,;]+/) : []
    const out: string[] = []
    for (const item of raw) {
        if (typeof item !== "string") continue
        const code = item.trim().toUpperCase()
        if (code && !out.includes(code)) out.push(code)
    }
    return out
}

function isSubdivision(code: string): boolean {
    return code.includes("-")
}

/** Every data file a selection reads, for `declareAssets`. Depends on nothing but its arguments. */
export function geoFilesFor(codes: readonly string[], level: GeoLevel): string[] {
    const files = new Set<string>()
    for (const code of codes) {
        if (!CODE.test(code) || geoRegistry.defined(code)) continue
        if (isSubdivision(code)) files.add(statesFileKey(code.slice(0, 2)))
        else files.add(level === "state" ? statesFileKey(code) : countryFileKey(code))
    }
    return [...files]
}

export interface GeoSelection {
    features: GeoFeature[]
    /** A file this selection needs has not landed yet. */
    pending: boolean
    /** Codes whose file loaded without them. */
    unknown: string[]
}

/**
 * The features a selection draws. A bare country code at state level is its
 * first-level subdivisions — minus the remote ones when framing the mainland —
 * or the country itself when it has none.
 */
export function selectGeoFeatures(codes: readonly string[], level: GeoLevel, frame: GeoFrame): GeoSelection {
    const features: GeoFeature[] = []
    const seen = new Set<string>()
    const unknown: string[] = []
    let pending = false

    const add = (feature: GeoFeature) => {
        if (seen.has(feature.code)) return
        seen.add(feature.code)
        features.push(feature)
    }

    for (const code of codes) {
        const defined = geoRegistry.defined(code)
        if (defined) {
            add(defined)
            continue
        }
        if (!CODE.test(code)) {
            unknown.push(code)
            continue
        }
        const subdivision = isSubdivision(code)
        const key = subdivision || level === "state" ? statesFileKey(code.slice(0, 2)) : countryFileKey(code)
        const entry = geoFileEntry(key)
        if (!entry || entry.status !== "ready") {
            if (!entry) pending = true
            continue
        }
        const file = entry.file.features
        if (subdivision || level === "country") {
            const feature = file.get(code)
            if (feature) add(feature)
            else unknown.push(code)
            continue
        }
        const children = [...file.values()].filter(
            (f) => f.parent === code && f.first && !(frame === "mainland" && f.remote)
        )
        if (children.length > 0) children.forEach(add)
        else if (file.get(code)) add(file.get(code)!)
        else unknown.push(code)
    }

    return { features, pending, unknown }
}
