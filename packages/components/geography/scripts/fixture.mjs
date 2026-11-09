/**
 * Cuts the small committed fixture `@motionscript/geography`'s tests read from a
 * generated `data/`: whole files for a few neighbouring countries (so a shared
 * border spans two files) and a few US states out of `states/US`.
 *
 *   node scripts/fixture.mjs <out-dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "v1")
const out = process.argv[2]
if (!out) throw new Error("usage: node scripts/fixture.mjs <out-dir>")

const read = (file) => JSON.parse(readFileSync(join(dir, `${file}.json`), "utf8"))

function subset(data, codes) {
  const features = data.features.filter((f) => codes.includes(f.code))
  const local = new Map()
  const arcIds = []
  const arcs = []
  const ref = (index) => {
    const old = index < 0 ? ~index : index
    let l = local.get(old)
    if (l === undefined) {
      l = arcIds.length
      local.set(old, l)
      arcIds.push(data.arcIds[old])
      arcs.push(data.arcs[old])
    }
    return index < 0 ? ~l : l
  }
  return {
    ...data,
    arcIds,
    arcs,
    features: features.map((f) => ({ ...f, polygons: f.polygons.map((p) => p.map((r) => r.map(ref))) })),
  }
}

mkdirSync(join(out, "v1", "countries"), { recursive: true })
mkdirSync(join(out, "v1", "states"), { recursive: true })
for (const code of ["FR", "DE", "CH"]) {
  writeFileSync(join(out, "v1", "countries", `${code}.json`), JSON.stringify(read(`countries/${code}`)))
}
writeFileSync(
  join(out, "v1", "states", "US.json"),
  JSON.stringify(subset(read("states/US"), ["US-CA", "US-NV", "US-OR"]))
)
