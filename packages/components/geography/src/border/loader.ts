import type { LoaderFn } from "@motionscript/sdk"

import { decodeGeoFile, type DecodedGeoFile, type GeoFileData } from "./format"
import { GEO_DATA_VERSION, geoRegistry } from "./registry"

export type GeoFileEntry =
    | { status: "ready"; file: DecodedGeoFile }
    | { status: "missing" }
    | { status: "failed"; error: unknown }

const entries = new Map<string, GeoFileEntry>()
const inflight = new Map<string, Promise<GeoFileEntry>>()
const loaders = new Map<string, LoaderFn>()
const warned = new Set<string>()
let version = 0

export function countryFileKey(code: string): string {
    return `${GEO_DATA_VERSION}/countries/${code}`
}

export function statesFileKey(country: string): string {
    return `${GEO_DATA_VERSION}/states/${country}`
}

/** Bumps whenever a file lands, so derived geometry keyed on it rebuilds. */
export function geoDataVersion(): number {
    return version
}

export function geoFileEntry(key: string): GeoFileEntry | undefined {
    return entries.get(key)
}

async function fetchEntry(key: string): Promise<GeoFileEntry> {
    try {
        let data = (await geoRegistry.resolve(key)) as GeoFileData | null
        // A country with no subdivisions has no states file; its outline stands in.
        if (data === null && key.includes("/states/")) {
            data = (await geoRegistry.resolve(key.replace("/states/", "/countries/"))) as GeoFileData | null
        }
        return data === null ? { status: "missing" } : { status: "ready", file: decodeGeoFile(data) }
    } catch (error) {
        return { status: "failed", error }
    }
}

/**
 * Loads one data file into the shared cache. Never rejects: a rejected loader
 * is retried on every tick and fails an export outright, where a recorded
 * failure draws nothing and is tried again by the next call.
 */
export function loadGeoFile(key: string): Promise<GeoFileEntry> {
    const current = entries.get(key)
    if (current?.status === "ready") return Promise.resolve(current)
    let job = inflight.get(key)
    if (!job) {
        job = fetchEntry(key).then((entry) => {
            inflight.delete(key)
            entries.set(key, entry)
            version++
            if (entry.status === "ready") {
                warned.delete(key)
            } else if (!warned.has(key)) {
                warned.add(key)
                if (entry.status === "failed") console.warn(`[GeoBorder] could not load ${key}:`, entry.error)
                else console.warn(`[GeoBorder] no geo source has ${key}`)
            }
            return entry
        })
        inflight.set(key, job)
    }
    return job
}

/**
 * The loader an `AssetScope` declares for a file: one function per key, so
 * every node that needs the file declares the same one. Nothing is disposed —
 * decoded data is shared by every engine in the process.
 */
export function geoLoader(key: string): LoaderFn {
    let load = loaders.get(key)
    if (!load) {
        load = async () => {
            await loadGeoFile(key)
        }
        loaders.set(key, load)
    }
    return load
}

/** Forgets every loaded file — for tests. */
export function clearGeoFiles(): void {
    entries.clear()
    inflight.clear()
    warned.clear()
    version++
}
