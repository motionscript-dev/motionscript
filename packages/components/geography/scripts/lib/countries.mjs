import { geoArea, geoBounds, geoCentroid, geoContains } from "d3-geo"

// Features Natural Earth leaves without an ISO code that are countries in the
// de facto worldview this data follows, under user-assigned codes.
const OWN_CODE = {
  SOL: { code: "XS", name: "Somaliland", nameNl: "Somaliland" },
  CYN: { code: "XN", name: "Northern Cyprus", nameNl: "Noord-Cyprus" },
}

// Terra nullius and disputed reefs: nobody's outline should grow them.
const DROP = new Set(["BRT", "PGA", "BJN", "SER", "SCR"])

// Codeless fragments whose centroid falls outside every strict-ISO polygon (a
// sliver on a shared border, a base carved out of an island), assigned to the
// country whose outline has a notch without them.
const JOIN = { ESB: "CY", WSB: "CY", USG: "CU", KAS: "IN", SPI: "CL" }

const validCode = (code) => /^[A-Z]{2}$/.test(code)

/**
 * One country per ISO 3166-1 alpha-2 code from Natural Earth's default (de
 * facto) admin-0 file.
 *
 * Every source feature becomes a *unit*; a country lists the units it is made
 * of. Unassigned `-99` fragments join whichever country the strict-ISO file
 * puts them in, and codes the default file folds into a parent (GF, RE, SJ…)
 * come from that file as countries of their own while the parent keeps them.
 */
export function buildCountries(admin0, admin0Iso) {
  const units = []
  const byCode = new Map()
  const addUnit = (source, feature, code) => {
    const id = `${source}:${units.length}`
    units.push({ type: "Feature", id, properties: {}, geometry: feature.geometry })
    let country = byCode.get(code)
    if (!country) {
      country = { code, level: "country", parent: null, first: true, listed: true, units: [], primary: null }
      byCode.set(code, country)
    }
    country.units.push(id)
    const area = geoArea(feature)
    if (!country.primary || area > country.primary.area) {
      const p = feature.properties
      country.primary = { area, name: p.NAME, nameNl: p.NAME_NL ?? p.NAME }
    }
    return country
  }

  const isoFeatures = admin0Iso.features.map((feature) => ({
    feature,
    code: feature.properties.ISO_A2_EH,
    bounds: geoBounds(feature),
  }))

  for (const feature of admin0.features) {
    const p = feature.properties
    if (!feature.geometry || DROP.has(p.ADM0_A3)) continue
    const own = OWN_CODE[p.ADM0_A3]
    if (own) {
      const country = addUnit("a0", feature, own.code)
      country.primary = { area: Infinity, name: own.name, nameNl: own.nameNl }
      continue
    }
    if (validCode(p.ISO_A2_EH)) {
      addUnit("a0", feature, p.ISO_A2_EH)
      continue
    }
    if (JOIN[p.ADM0_A3]) {
      addUnit("a0", feature, JOIN[p.ADM0_A3])
      continue
    }
    const centroid = geoCentroid(feature)
    const owner = isoFeatures.find(
      ({ feature: candidate, code }) => validCode(code) && geoContains(candidate, centroid)
    )
    if (!owner) {
      console.warn(`admin-0: ${p.NAME} (${p.ADM0_A3}) has no code and no ISO owner; dropped`)
      continue
    }
    console.log(`admin-0: ${p.NAME} (${p.ADM0_A3}) → ${owner.code}`)
    addUnit("a0", feature, owner.code)
  }

  for (const { feature, code } of isoFeatures) {
    if (!validCode(code) || byCode.has(code)) continue
    console.log(`admin-0: ${code} (${feature.properties.NAME}) from the ISO file`)
    addUnit("iso", feature, code)
  }

  const features = [...byCode.values()].map(({ primary, ...country }) => ({
    ...country,
    name: primary.name,
    nameNl: primary.nameNl,
  }))
  return { units, features }
}
