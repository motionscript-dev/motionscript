/**
 * Checks `data/v1/` before it is packed: every file the index names exists and
 * decodes, arc endpoints always survive simplification, and coverage has not
 * silently regressed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const FORMAT = 1
const MAX_FILE_BYTES = 1.5 * 1024 * 1024
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", `v${FORMAT}`)

const failures = []
const fail = (message) => failures.push(message)

if (!existsSync(join(dir, "index.json"))) {
  console.error(`${dir} is missing. Run \`pnpm --filter @motionscript/geography generate\` first.`)
  process.exit(1)
}

const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"))
if (index.format !== FORMAT) fail(`index.json format ${index.format}, expected ${FORMAT}`)

const files = new Map()
function load(file) {
  if (!files.has(file)) {
    const path = join(dir, `${file}.json`)
    if (!existsSync(path)) {
      files.set(file, null)
    } else {
      if (statSync(path).size > MAX_FILE_BYTES) fail(`${file}.json is over ${MAX_FILE_BYTES} bytes`)
      files.set(file, JSON.parse(readFileSync(path, "utf8")))
    }
  }
  return files.get(file)
}

for (const kind of ["countries", "states"]) {
  for (const name of readdirSync(join(dir, kind))) {
    const data = load(`${kind}/${name.replace(/\.json$/, "")}`)
    if (data.format !== FORMAT) fail(`${kind}/${name}: format ${data.format}`)
    if (data.arcIds.length !== data.arcs.length) fail(`${kind}/${name}: arcIds and arcs differ in length`)
    data.arcs.forEach((arc, i) => {
      if (arc.length % 3 !== 0 || arc.length < 6) fail(`${kind}/${name}: arc ${i} is malformed`)
      if (arc[2] !== 0 || arc[arc.length - 1] !== 0) fail(`${kind}/${name}: arc ${i} can lose an endpoint`)
    })
    for (const feature of data.features) {
      if (feature.polygons.length !== feature.areas.length) fail(`${feature.code}: areas and polygons differ`)
      for (const polygon of feature.polygons)
        for (const ring of polygon)
          for (const ref of ring) {
            const local = ref < 0 ? ~ref : ref
            if (local >= data.arcs.length) fail(`${feature.code}: arc ${ref} out of range`)
          }
      if (feature.mainland?.some((i) => i >= feature.polygons.length)) fail(`${feature.code}: mainland index out of range`)
    }
  }
}

const codes = new Set()
for (const [code, name, , parent, first] of index.regions) {
  if (codes.has(code)) fail(`index lists ${code} twice`)
  codes.add(code)
  if (!name) fail(`${code} has no name`)
  if (code.includes("~") || code.startsWith("-99")) fail(`${code} is a placeholder code`)
  const file = code.includes("-") ? `states/${code.slice(0, 2)}` : `countries/${code}`
  const data = load(file)
  if (!data) fail(`${code}: ${file}.json is missing`)
  else if (!data.features.some((f) => f.code === code)) fail(`${code}: not in ${file}.json`)
  if (code.includes("-") && first && parent !== code.slice(0, 2)) fail(`${code}: first-level with parent ${parent}`)
}

const countries = [...codes].filter((c) => !c.includes("-"))
if (countries.length < 249) fail(`only ${countries.length} countries`)

const US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ")
for (const s of US_STATES) if (!codes.has(`US-${s}`)) fail(`US-${s} is missing`)

const firstLevel = (prefix) => index.regions.filter(([c, , , p, f]) => f && p === prefix).length
for (const [prefix, expected] of [["FR", 18], ["GB", 4], ["IT", 20], ["ES", 19], ["CA", 13], ["DE", 16], ["AU", 8]]) {
  const got = firstLevel(prefix)
  if (got < expected) fail(`${prefix} has ${got} first-level subdivisions, expected at least ${expected}`)
}

if (failures.length) {
  console.error(failures.slice(0, 50).join("\n"))
  console.error(`${failures.length} problem(s)`)
  process.exit(1)
}
console.log(`ok: ${countries.length} countries, ${codes.size - countries.length} subdivisions, ${files.size} files`)
