import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, mock, test } from "node:test"

import { NATURAL_EARTH_TAG, SOURCE_FILES, loadSources } from "../lib/sources.mjs"

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const BODY = { admin0: "a0", admin0Iso: "a0iso", admin1: "a1" }
const bytesOf = (key) => Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [], tag: BODY[key] }))

describe("loadSources", () => {
  let packageDir
  let cacheDir
  const lockPath = () => join(packageDir, "sources.lock.json")
  const lockWith = (overrides = {}) => ({
    tag: NATURAL_EARTH_TAG,
    files: Object.fromEntries(
      Object.entries(SOURCE_FILES).map(([key, file]) => [file, { url: "u", sha256: sha256(bytesOf(key)), bytes: bytesOf(key).length }])
    ),
    ...overrides,
  })
  const seedCache = () => {
    for (const [key, file] of Object.entries(SOURCE_FILES)) writeFileSync(join(cacheDir, file), bytesOf(key))
  }

  beforeEach(() => {
    packageDir = mkdtempSync(join(tmpdir(), "ms-geography-sources-"))
    cacheDir = join(packageDir, ".cache", NATURAL_EARTH_TAG)
    mkdirSync(cacheDir, { recursive: true })
    mock.method(console, "log", () => undefined)
    // A test that wants the network supplies it; none may reach the real one.
    mock.method(globalThis, "fetch", async () => {
      throw new Error("the network is not available to these tests")
    })
  })

  afterEach(() => {
    mock.restoreAll()
    rmSync(packageDir, { recursive: true, force: true })
  })

  test("reads each pinned source from the cache when it matches the lock, without the network", async () => {
    writeFileSync(lockPath(), JSON.stringify(lockWith()))
    seedCache()

    const sources = await loadSources({ packageDir, updateLock: false })

    assert.deepEqual(Object.keys(sources).sort(), ["admin0", "admin0Iso", "admin1"])
    assert.equal(sources.admin1.tag, "a1")
    assert.equal(globalThis.fetch.mock.callCount(), 0)
  })

  test("refuses a cached file whose hash is not the pinned one", async () => {
    writeFileSync(lockPath(), JSON.stringify(lockWith()))
    seedCache()
    writeFileSync(join(cacheDir, SOURCE_FILES.admin0), '{"tampered":true}')

    await assert.rejects(loadSources({ packageDir, updateLock: false }), /ne_10m_admin_0_countries_lakes\.geojson does not match sources\.lock\.json/)
  })

  test("refuses a source the lock does not list", async () => {
    const lock = lockWith()
    delete lock.files[SOURCE_FILES.admin1]
    writeFileSync(lockPath(), JSON.stringify(lock))
    seedCache()

    await assert.rejects(loadSources({ packageDir, updateLock: false }), /ne_10m_admin_1_states_provinces_lakes\.geojson is not in sources\.lock\.json; rerun with --update-lock/)
  })

  test("refuses a lock that pins another tag, unless it is being updated", async () => {
    writeFileSync(lockPath(), JSON.stringify(lockWith({ tag: "v0.0.1" })))
    seedCache()

    await assert.rejects(loadSources({ packageDir, updateLock: false }), /sources\.lock\.json pins v0\.0\.1, generator wants v5\.1\.2; rerun with --update-lock/)
    await assert.doesNotReject(loadSources({ packageDir, updateLock: true }))
  })

  test("downloads a missing source, checks it against the lock and caches it", async () => {
    writeFileSync(lockPath(), JSON.stringify(lockWith()))
    seedCache()
    rmSync(join(cacheDir, SOURCE_FILES.admin1))
    globalThis.fetch.mock.mockImplementation(async (url) => {
      assert.match(String(url), /natural-earth-vector\/v5\.1\.2\/geojson\/ne_10m_admin_1_states_provinces_lakes\.geojson$/)
      return new Response(bytesOf("admin1"))
    })

    await loadSources({ packageDir, updateLock: false })

    assert.equal(globalThis.fetch.mock.callCount(), 1)
    assert.deepEqual(readFileSync(join(cacheDir, SOURCE_FILES.admin1)), bytesOf("admin1"))
  })

  test("does not cache a download that fails the check, so the next run fetches it again", async () => {
    writeFileSync(lockPath(), JSON.stringify(lockWith()))
    seedCache()
    rmSync(join(cacheDir, SOURCE_FILES.admin1))
    globalThis.fetch.mock.mockImplementation(async () => new Response('{"wrong":true}'))

    await assert.rejects(loadSources({ packageDir, updateLock: false }), /does not match sources\.lock\.json/)

    assert.equal(existsSync(join(cacheDir, SOURCE_FILES.admin1)), false)
  })

  test("fails on a download that is not OK, naming the URL and the status", async () => {
    writeFileSync(lockPath(), JSON.stringify(lockWith()))
    seedCache()
    rmSync(join(cacheDir, SOURCE_FILES.admin0))
    globalThis.fetch.mock.mockImplementation(async () => new Response("", { status: 503 }))

    await assert.rejects(loadSources({ packageDir, updateLock: false }), /ne_10m_admin_0_countries_lakes\.geojson → HTTP 503/)
  })

  test("records what it read in the lock when asked to update it, and only then", async () => {
    seedCache()

    await assert.rejects(loadSources({ packageDir, updateLock: false }), /is not in sources\.lock\.json/)
    assert.equal(existsSync(lockPath()), false)

    await loadSources({ packageDir, updateLock: true })

    const lock = JSON.parse(readFileSync(lockPath(), "utf8"))
    assert.equal(lock.tag, NATURAL_EARTH_TAG)
    assert.deepEqual(Object.keys(lock.files).sort(), Object.values(SOURCE_FILES).sort())
    for (const [key, file] of Object.entries(SOURCE_FILES)) {
      assert.equal(lock.files[file].sha256, sha256(bytesOf(key)))
      assert.equal(lock.files[file].bytes, bytesOf(key).length)
      assert.equal(lock.files[file].url, `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_TAG}/geojson/${file}`)
    }
    assert.equal(readFileSync(lockPath(), "utf8").endsWith("\n"), true)
  })
})
