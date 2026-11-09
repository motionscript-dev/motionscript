/**
 * Builds `data/v1/` from pinned Natural Earth downloads:
 *
 *   node scripts/generate.mjs [--update-lock]
 *
 * One topology holds every country and every subdivision, so a border two
 * regions share is one arc with one global id in every file that uses it — which
 * is what lets the renderer stroke it once even when the two regions come from
 * different files. Visvalingam weights are computed on that whole topology,
 * before splitting, for the same reason: a shared border simplifies identically
 * on both sides.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { geoArea, geoBounds, geoCentroid, geoContains } from "d3-geo"
import { geoStitch } from "d3-geo-projection"
import { feature as topoFeature, mergeArcs } from "topojson-client"
import { topology } from "topojson-server"
import { presimplify, sphericalTriangleArea } from "topojson-simplify"

import { buildCountries } from "./lib/countries.mjs"
import { boundsIntersect, mainlandParts } from "./lib/mainland.mjs"
import { NATURAL_EARTH_TAG, loadSources } from "./lib/sources.mjs"
import { buildStates } from "./lib/states.mjs"

export const FORMAT = 1
const QUANTIZATION = 1e6

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = join(packageDir, "data", `v${FORMAT}`)

const round = (value, digits = 4) => Number(value.toPrecision(digits))

// Two steps per octave of spherical area; 0 always survives (arc endpoints),
// 255 only at full detail (collinear points).
function weightBucket(weight) {
  if (weight === Infinity) return 0
  if (!(weight > 0)) return 255
  return Math.min(254, Math.max(1, Math.round(-2 * Math.log2(weight))))
}

/**
 * Stitching across the antimeridian can hand back a polygon whose first ring is
 * a lake — Russia's opens with Ladoga. Everything downstream takes ring 0 as
 * the exterior, so rings are re-sorted by winding: each hole joins the
 * smallest exterior that contains it.
 */
function exteriorsFirst(geometry) {
  const polygons =
    geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : null
  if (!polygons) return geometry
  const exteriors = []
  const holes = []
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const area = geoArea({ type: "Polygon", coordinates: [ring] })
      if (area > 2 * Math.PI) holes.push(ring)
      else exteriors.push({ ring, area, bounds: geoBounds({ type: "Polygon", coordinates: [ring] }), holes: [] })
    }
  }
  if (holes.length === 0 && polygons.every((p) => p.length === 1)) return geometry
  exteriors.sort((a, b) => a.area - b.area)
  for (const hole of holes) {
    // A vertex rather than the centroid: an enclave inside the hole (Nahwa in
    // Madha, inside the UAE) contains the centroid but not the hole.
    const probe = hole[0]
    const size = 4 * Math.PI - geoArea({ type: "Polygon", coordinates: [hole] })
    const owner = exteriors.find(
      ({ ring, area }) => area > size && geoContains({ type: "Polygon", coordinates: [ring] }, probe)
    )
    if (owner) owner.holes.push(hole)
    else console.warn(`a hole at ${probe.map((v) => v.toFixed(2))} is inside no exterior; dropped`)
  }
  return { type: "MultiPolygon", coordinates: exteriors.map(({ ring, holes }) => [ring, ...holes]) }
}

const { admin0, admin0Iso, admin1 } = await loadSources({
  packageDir,
  updateLock: process.argv.includes("--update-lock"),
})

console.log("building features…")
const countries = buildCountries(admin0, admin0Iso)
const states = buildStates(admin1)
const units = [...countries.units, ...states.units]
const features = [...countries.features, ...states.features]

console.log(`stitching ${units.length} units…`)
const stitched = geoStitch({ type: "FeatureCollection", features: units })
for (const unit of stitched.features) unit.geometry = exteriorsFirst(unit.geometry)

console.log("building topology…")
const topo = topology({ units: stitched }, QUANTIZATION)
const geometryById = new Map(topo.objects.units.geometries.map((g) => [g.id, g]))

const polygonsOf = (geometry) =>
  geometry.type === "Polygon" ? [geometry.arcs] : geometry.type === "MultiPolygon" ? geometry.arcs : []

console.log("assembling features…")
for (const feature of features) {
  const geometries = feature.units.map((id) => geometryById.get(id)).filter((g) => g && g.type)
  const polygons =
    geometries.length === 1 ? polygonsOf(geometries[0]) : mergeArcs(topo, geometries).arcs
  feature.parts = polygons.map((polygon) => {
    let arcs = polygon
    let geo = topoFeature(topo, { type: "Polygon", arcs })
    let area = geoArea(geo)
    if (area > 2 * Math.PI) {
      console.warn(`${feature.code}: a polygon is wound inside out; reversed`)
      arcs = arcs.map((ring) => ring.slice().reverse().map((arc) => ~arc))
      geo = topoFeature(topo, { type: "Polygon", arcs })
      area = geoArea(geo)
    }
    return { arcs, area, bounds: geoBounds(geo), centroid: geoCentroid(geo) }
  })
  feature.parts = feature.parts.filter((part) => part.area > 0)
  feature.area = feature.parts.reduce((sum, part) => sum + part.area, 0)
  feature.mainland = mainlandParts(feature.code, feature.parts)
}

const empty = features.filter((f) => f.parts.length === 0)
for (const f of empty) console.warn(`${f.code} (${f.name}) has no geometry; dropped`)
const kept = features.filter((f) => f.parts.length > 0)

const countryByCode = new Map(kept.filter((f) => f.level === "country").map((f) => [f.code, f]))
const mainlandBounds = new Map()
for (const country of countryByCode.values()) {
  const parts = country.mainland ? country.mainland.map((i) => country.parts[i]) : country.parts
  mainlandBounds.set(country.code, parts.map((p) => p.bounds))
}
for (const feature of kept) {
  if (feature.level !== "state") continue
  const bounds = mainlandBounds.get(feature.code.slice(0, 2))
  if (!bounds) continue
  const largest = feature.parts.reduce((a, b) => (b.area > a.area ? b : a))
  feature.remote = !bounds.some((b) => boundsIntersect(b, largest.bounds))
}

console.log("presimplifying…")
const simplified = presimplify(topo, sphericalTriangleArea)
const [kx, ky] = topo.transform.scale
const [tx, ty] = topo.transform.translate

function encodeArc(arc) {
  const out = []
  let px = 0
  let py = 0
  for (let i = 0; i < arc.length; i++) {
    const x = Math.round((arc[i][0] - tx) / kx)
    const y = Math.round((arc[i][1] - ty) / ky)
    out.push(i === 0 ? x : x - px, i === 0 ? y : y - py, weightBucket(arc[i][2]))
    px = x
    py = y
  }
  return out
}

function encodeFile(group) {
  const local = new Map()
  const arcIds = []
  const arcs = []
  const ref = (index) => {
    const global = index < 0 ? ~index : index
    let l = local.get(global)
    if (l === undefined) {
      l = arcIds.length
      local.set(global, l)
      arcIds.push(global)
      arcs.push(encodeArc(simplified.arcs[global]))
    }
    return index < 0 ? ~l : l
  }
  return {
    format: FORMAT,
    source: `Natural Earth ${NATURAL_EARTH_TAG}`,
    transform: { scale: [kx, ky], translate: [tx, ty] },
    arcIds,
    arcs,
    features: group.map((f) => ({
      code: f.code,
      name: f.name,
      nameNl: f.nameNl,
      parent: f.parent,
      first: f.first,
      listed: f.listed,
      ...(f.remote ? { remote: true } : {}),
      area: round(f.area),
      mainland: f.mainland,
      areas: f.parts.map((p) => round(p.area, 3)),
      polygons: f.parts.map((p) => p.arcs.map((ring) => ring.map(ref))),
    })),
  }
}

console.log("writing…")
rmSync(outDir, { recursive: true, force: true })
mkdirSync(join(outDir, "countries"), { recursive: true })
mkdirSync(join(outDir, "states"), { recursive: true })

const stateFiles = new Map()
for (const feature of kept) {
  if (feature.level === "country") {
    writeFileSync(join(outDir, "countries", `${feature.code}.json`), JSON.stringify(encodeFile([feature])))
  } else {
    const prefix = feature.code.slice(0, 2)
    stateFiles.set(prefix, [...(stateFiles.get(prefix) ?? []), feature])
  }
}
for (const [prefix, group] of stateFiles) {
  group.sort((a, b) => a.code.localeCompare(b.code))
  writeFileSync(join(outDir, "states", `${prefix}.json`), JSON.stringify(encodeFile(group)))
}

const regions = kept
  .filter((f) => f.listed)
  .sort((a, b) => (a.level === b.level ? a.code.localeCompare(b.code) : a.level === "country" ? -1 : 1))
  .map((f) => [f.code, f.name, f.nameNl, f.parent, f.first ? 1 : 0])
writeFileSync(
  join(outDir, "index.json"),
  JSON.stringify({ format: FORMAT, source: `Natural Earth ${NATURAL_EARTH_TAG}`, regions })
)

console.log(
  `done: ${countryByCode.size} countries, ${kept.length - countryByCode.size} subdivisions in ${stateFiles.size} files`
)
