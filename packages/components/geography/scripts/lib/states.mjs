import { geoArea } from "d3-geo"

const trim = (value) => (typeof value === "string" ? value.trim() : value)

const GB_NATIONS = {
  England: { code: "GB-ENG", nameNl: "Engeland" },
  Scotland: { code: "GB-SCT", nameNl: "Schotland" },
  Wales: { code: "GB-WLS", nameNl: "Wales" },
  "Northern Ireland": { code: "GB-NIR", nameNl: "Noord-Ierland" },
}

// Natural Earth's Spanish `region_cod` is HASC; ISO 3166-2:ES names the
// autonomous communities differently for five of them.
const ES_COMMUNITIES = {
  "ES.AN": "ES-AN", "ES.AR": "ES-AR", "ES.AS": "ES-AS", "ES.CN": "ES-CN",
  "ES.CB": "ES-CB", "ES.CL": "ES-CL", "ES.CM": "ES-CM", "ES.CT": "ES-CT",
  "ES.EX": "ES-EX", "ES.GA": "ES-GA", "ES.PM": "ES-IB", "ES.LO": "ES-RI",
  "ES.MD": "ES-MD", "ES.MU": "ES-MC", "ES.NA": "ES-NC", "ES.PV": "ES-PV",
  "ES.VC": "ES-VC",
}

// FR overseas regions are a single département each, which is already its own
// first-level unit; Corsica's ISO code is not the one Natural Earth carries.
const FR_SINGLE = new Set(["FR-GUF", "FR-MTQ", "FR-GUA", "FR-LRE", "FR-MAY"])

// Codeless (`-99-…`) units, by `adm0_a3`, to the country whose subdivision map
// has a hole without them — the same assignments the admin-0 build makes.
const CODELESS_OWNER = {
  ESB: "CY", WSB: "CY", USG: "CU", KAS: "IN", KAB: "KZ", IOA: "AU",
  CSI: "AU", ATC: "AU", CLP: "FR", SPI: "CL", SOL: "XS", CYN: "XN",
}

/**
 * Where Natural Earth's admin-1 is second-level, the ISO first-level region a
 * unit belongs to. `null` means the unit is itself first-level.
 */
const FIRST_LEVEL = {
  FR: (p) => {
    const region = trim(p.region_cod)
    if (!region || FR_SINGLE.has(region)) return null
    return { code: region === "FR-COR" ? "FR-20R" : region, name: trim(p.region), nameNl: trim(p.region) }
  },
  GB: (p) => {
    const nation = GB_NATIONS[p.geonunit]
    return nation && { code: nation.code, name: p.geonunit, nameNl: nation.nameNl }
  },
  IT: (p) => {
    const region = trim(p.region_cod)
    return region && { code: region, name: trim(p.region), nameNl: trim(p.region) }
  },
  ES: (p) => {
    const code = ES_COMMUNITIES[trim(p.region_cod)]
    return code && { code, name: trim(p.region), nameNl: trim(p.region) }
  },
  PH: (p) => {
    const region = trim(p.region_cod)
    return region && { code: region, name: trim(p.region), nameNl: trim(p.region) }
  },
}

/**
 * First-level subdivisions keyed by ISO 3166-2 code, from Natural Earth's
 * admin-1 (lakes) file, grouped by code prefix — never `adm0_a3`, which files
 * Crimea under Russia and Puerto Rico outside the US.
 *
 * Placeholder codes (`XK-X02~`) and codeless `-99-…` units are kept as
 * unlisted units of their country, so a state map has no holes.
 */
export function buildStates(admin1) {
  const units = []
  const byCode = new Map()
  const regions = new Map()

  const featureFor = (code, props) => {
    let feature = byCode.get(code)
    if (!feature) {
      feature = { code, level: "state", units: [], ...props, primary: null }
      byCode.set(code, feature)
    }
    return feature
  }

  for (const source of admin1.features) {
    const p = source.properties
    let raw = trim(p.iso_3166_2) ?? ""
    if (!source.geometry) continue
    if (raw.startsWith("-99")) {
      const owner = CODELESS_OWNER[p.adm0_a3]
      if (!owner) continue
      raw = `${owner}-${raw.slice(4)}`
    }
    const listed = !raw.includes("~")
    const code = raw.replace("~", "")
    if (!/^[A-Z]{2}-[A-Z0-9]+$/.test(code)) {
      console.warn(`admin-1: unusable code ${JSON.stringify(raw)} (${p.name}); dropped`)
      continue
    }
    const country = code.slice(0, 2)
    const region = FIRST_LEVEL[country]?.(p) ?? null

    const id = `a1:${units.length}`
    units.push({ type: "Feature", id, properties: {}, geometry: source.geometry })

    const feature = featureFor(code, {
      parent: region ? region.code : country,
      first: !region,
      listed,
    })
    feature.units.push(id)
    const area = geoArea(source)
    if (!feature.primary || area > feature.primary.area) {
      feature.primary = { area, name: p.name ?? code, nameNl: p.name_nl ?? p.name ?? code }
    }

    if (region) {
      const group = regions.get(region.code) ?? { ...region, country, units: [] }
      group.units.push(id)
      regions.set(region.code, group)
    }
  }

  for (const region of regions.values()) {
    if (byCode.has(region.code)) throw new Error(`admin-1: region ${region.code} collides with a unit code`)
    byCode.set(region.code, {
      code: region.code,
      level: "state",
      parent: region.country,
      first: true,
      listed: true,
      units: region.units,
      primary: { area: 0, name: region.name, nameNl: region.nameNl },
    })
  }

  const features = [...byCode.values()].map(({ primary, ...feature }) => ({
    ...feature,
    name: primary.name,
    nameNl: primary.nameNl,
  }))
  return { units, features }
}
