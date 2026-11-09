import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const NATURAL_EARTH_TAG = "v5.1.2"

const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_TAG}/geojson/`

export const SOURCE_FILES = {
  admin0: "ne_10m_admin_0_countries_lakes.geojson",
  admin0Iso: "ne_10m_admin_0_countries_iso.geojson",
  admin1: "ne_10m_admin_1_states_provinces_lakes.geojson",
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

/**
 * Downloads (or reads from `.cache/`) every pinned source and checks it against
 * `sources.lock.json`. `--update-lock` records what was fetched instead of
 * refusing it — the only way the lock should ever change.
 */
export async function loadSources({ packageDir, updateLock }) {
  const cacheDir = join(packageDir, ".cache", NATURAL_EARTH_TAG)
  const lockPath = join(packageDir, "sources.lock.json")
  mkdirSync(cacheDir, { recursive: true })
  const lock = existsSync(lockPath)
    ? JSON.parse(readFileSync(lockPath, "utf8"))
    : { tag: NATURAL_EARTH_TAG, files: {} }
  if (lock.tag !== NATURAL_EARTH_TAG && !updateLock) {
    throw new Error(`sources.lock.json pins ${lock.tag}, generator wants ${NATURAL_EARTH_TAG}; rerun with --update-lock`)
  }
  lock.tag = NATURAL_EARTH_TAG

  const out = {}
  for (const [key, file] of Object.entries(SOURCE_FILES)) {
    const cached = join(cacheDir, file)
    const fromCache = existsSync(cached)
    let bytes
    if (fromCache) {
      bytes = readFileSync(cached)
    } else {
      const url = BASE + file
      console.log(`fetch ${url}`)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
      bytes = Buffer.from(await response.arrayBuffer())
    }
    const digest = sha256(bytes)
    const pinned = lock.files[file]
    if (updateLock) {
      lock.files[file] = { url: BASE + file, sha256: digest, bytes: bytes.length }
    } else if (!pinned) {
      throw new Error(`${file} is not in sources.lock.json; rerun with --update-lock`)
    } else if (pinned.sha256 !== digest) {
      throw new Error(`${file} does not match sources.lock.json (got ${digest}, pinned ${pinned.sha256})`)
    }
    // Cached only once checked, so a bad download is fetched again next run
    // rather than failing every run from the cache.
    if (!fromCache) writeFileSync(cached, bytes)
    out[key] = JSON.parse(bytes.toString("utf8"))
  }
  if (updateLock) writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n")
  return out
}
