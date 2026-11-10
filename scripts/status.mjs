/**
 * Where the repository stands, for a maintainer and for the workspace status
 * mod (`--json` is the shape it reads):
 *
 *   branches    alpha against main (origin's when fetched), uncommitted changes
 *   versions    the checkout's version and npm's `alpha` and `latest` tags
 *   changesets  the ones the next release consumes
 *   build       each package whose dist/ is older than its source
 *   apps        which example app is serving
 *
 *   node scripts/status.mjs [--json] [--fetch] [--npm]
 *   node scripts/status.mjs --stop <port>
 *
 * `--fetch` fetches origin first and `--npm` asks the registry, both network
 * calls. `--stop` ends whatever listens on the port, with its child processes.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { connect } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const WORK = "alpha"
const RELEASE = "main"
const APPS = {
  react: { port: 5174, command: "pnpm dev react", argv: ["react"] },
  engine: { port: 5175, command: "pnpm dev engine", argv: ["engine"] },
}

function git(...gitArgs) {
  const result = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" })
  // trimEnd: the first `status --porcelain` row starts with a meaningful space.
  return { ok: result.status === 0, out: (result.stdout ?? "").trimEnd() }
}
const sha = (ref) => (git("rev-parse", "--verify", "-q", ref).out || null)
const count = (range) => Number(git("rev-list", "--count", range).out)
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

// ── Stop ──────────────────────────────────────────────────────────────

function listeners(port) {
  if (process.platform === "win32") {
    const rows = (spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout ?? "").split(/\r?\n/)
    const pids = rows
      .map((row) => row.trim().split(/\s+/))
      .filter((cols) => cols[0] === "TCP" && cols[3] === "LISTENING" && cols[1].endsWith(`:${port}`))
      .map((cols) => cols[4])
    return [...new Set(pids)].filter((pid) => pid !== "0")
  }
  return (spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout ?? "").split(/\s+/).filter(Boolean)
}

if (args[0] === "--stop") {
  const port = Number(args[1])
  if (!port) {
    console.error("[status] --stop takes a port.")
    process.exit(1)
  }
  const pids = listeners(port)
  for (const pid of pids) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", pid, "/T", "/F"])
    else spawnSync("kill", [pid])
  }
  console.log(pids.length ? `[status] stopped ${pids.join(", ")} on :${port}` : `[status] nothing listens on :${port}`)
  process.exit(0)
}

// ── Report ────────────────────────────────────────────────────────────

function branches() {
  const side = (name) => {
    const local = sha(`refs/heads/${name}`)
    const remote = sha(`refs/remotes/origin/${name}`)
    return {
      name,
      local: Boolean(local),
      remote: Boolean(remote),
      unpushed: local && remote ? count(`${remote}..${local}`) : null,
      unpulled: local && remote ? count(`${local}..${remote}`) : null,
      tip: remote ?? local,
    }
  }
  const work = side(WORK)
  const release = side(RELEASE)
  const compared = work.remote && release.remote ? "origin" : "local"
  const both = work.tip && release.tip
  const fetchHead = join(root, ".git", "FETCH_HEAD")
  const dirty = git("status", "--porcelain").out.split("\n").filter(Boolean)
  return {
    current: git("branch", "--show-current").out || null,
    work,
    release,
    compared,
    ahead: both ? count(`${release.tip}..${work.tip}`) : null,
    behind: both ? count(`${work.tip}..${release.tip}`) : null,
    dirty: dirty.slice(0, 20),
    dirtyCount: dirty.length,
    fetchedAt: existsSync(fetchHead) ? statSync(fetchHead).mtime.toISOString() : null,
  }
}

async function npmTags() {
  try {
    const response = await fetch("https://registry.npmjs.org/@motionscript%2fcore", {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(8000),
    })
    const tags = (await response.json())["dist-tags"] ?? {}
    return { alpha: tags.alpha ?? null, latest: tags.latest ?? null }
  } catch {
    return null
  }
}

function versions(npm) {
  const pre = join(root, ".changeset/pre.json")
  return {
    local: readJson(join(root, "packages/core/package.json")).version,
    preMode: existsSync(pre) && readJson(pre).mode === "pre",
    npm,
  }
}

const BUMPS = ["patch", "minor", "major"]

export function parseChangeset(id, text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n?([\s\S]*)$/.exec(text)
  const releases = (match?.[1] ?? "")
    .split(/\r?\n/)
    .map((line) => /^\s*["']?([^"':]+)["']?\s*:\s*(patch|minor|major)\s*$/.exec(line))
    .filter(Boolean)
    .map(([, name, bump]) => ({ name, bump }))
  const body = (match?.[2] ?? text).trim()
  const bump = releases.reduce((top, { bump }) => (BUMPS.indexOf(bump) > BUMPS.indexOf(top) ? bump : top), releases.length ? "patch" : null)
  return {
    id,
    bump,
    packages: releases.map(({ name }) => name),
    summary: (body.split(/\r?\n/).find((line) => line.trim()) ?? "").replace(/\*\*/g, "").trim(),
    breaking: /\*\*Breaking:\*\*/.test(body),
  }
}

function changesets() {
  const dir = join(root, ".changeset")
  const pre = existsSync(join(dir, "pre.json")) ? readJson(join(dir, "pre.json")) : null
  const consumed = new Set(pre?.mode === "pre" ? pre.changesets : [])
  const untracked = new Set(
    git("status", "--porcelain", "--untracked-files=all", "--", ".changeset").out.split("\n").filter((row) => row.startsWith("??")).map((row) => row.slice(3).trim())
  )
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .map((file) => file.slice(0, -3))
    .filter((id) => !consumed.has(id))
    .map((id) => ({ ...parseChangeset(id, readFileSync(join(dir, `${id}.md`), "utf8")), committed: !untracked.has(`.changeset/${id}.md`) }))
}

const SKIP = new Set(["node_modules", "dist", ".turbo", "target", "out", ".cache", "data"])
function newest(dir) {
  if (!existsSync(dir)) return 0
  let latest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name) && !entry.name.startsWith(".")) latest = Math.max(latest, newest(join(dir, entry.name)))
    } else {
      latest = Math.max(latest, statSync(join(dir, entry.name)).mtimeMs)
    }
  }
  return latest
}
function newestBuilt(dir) {
  if (!existsSync(dir)) return 0
  let latest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    latest = Math.max(latest, entry.isDirectory() ? newestBuilt(path) : statSync(path).mtimeMs)
  }
  return latest
}

function packageDirs(dir, depth = 0) {
  if (depth > 1) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name === "node_modules") return []
    const path = join(dir, entry.name)
    return existsSync(join(path, "package.json")) ? [path] : packageDirs(path, depth + 1)
  })
}

function build() {
  const packages = packageDirs(join(root, "packages"))
    .map((dir) => ({ dir, pkg: readJson(join(dir, "package.json")) }))
    .filter(({ pkg }) => pkg.scripts?.build)
    .map(({ dir, pkg }) => {
      const renderer = pkg.name === "@motionscript/renderer"
      const source = Math.max(...(renderer ? ["crates", "web/src"] : ["src"]).map((sub) => newest(join(dir, sub))))
      const built = newestBuilt(join(dir, "dist"))
      return { name: pkg.name, built: built > 0, builtAt: built ? new Date(built).toISOString() : null, stale: built > 0 && source > built }
    })
  const builtTimes = packages.filter((p) => p.builtAt).map((p) => Date.parse(p.builtAt))
  return {
    packages,
    missing: packages.filter((p) => !p.built).map((p) => p.name),
    stale: packages.filter((p) => p.stale).map((p) => p.name),
    builtAt: builtTimes.length ? new Date(Math.max(...builtTimes)).toISOString() : null,
  }
}

function portOpen(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: "localhost" })
    socket.setTimeout(800, () => (socket.destroy(), done(false)))
    socket.once("connect", () => (socket.destroy(), done(true)))
    socket.once("error", () => done(false))
  })
}

async function apps() {
  const entries = await Promise.all(
    Object.entries(APPS).map(async ([name, app]) => [name, { running: await portOpen(app.port), url: `http://localhost:${app.port}`, port: app.port, command: app.command, argv: app.argv }])
  )
  return Object.fromEntries(entries)
}

if (args.includes("--fetch")) git("fetch", "--quiet", "--prune", "origin")
const [npm, appState] = await Promise.all([args.includes("--npm") ? npmTags() : Promise.resolve(null), apps()])
const report = {
  generatedAt: new Date().toISOString(),
  branches: branches(),
  versions: versions(npm),
  changesets: changesets(),
  build: build(),
  apps: appState,
}

if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const b = report.branches
  const sync =
    b.ahead === null ? `${WORK} or ${RELEASE} doesn't exist yet` : b.ahead === 0 && b.behind === 0 ? "in sync" : `${WORK} ${b.ahead} ahead, ${b.behind} behind ${RELEASE}`
  console.log(`Branches (${b.compared})\n  on ${b.current ?? "a detached HEAD"}; ${sync}; ${b.dirtyCount} uncommitted change(s)`)
  const v = report.versions
  console.log(`Versions\n  checkout ${v.local}${v.preMode ? " (pre mode)" : ""}; npm ${v.npm ? `alpha ${v.npm.alpha}, latest ${v.npm.latest}` : "not asked (--npm)"}`)
  console.log(`Changesets\n${report.changesets.map((c) => `  ${c.bump ?? "empty"}  ${c.id}  ${c.summary}`).join("\n") || "  none pending"}`)
  const d = report.build
  console.log(`Build\n  ${d.missing.length ? `not built: ${d.missing.join(", ")}` : d.stale.length ? `older than source: ${d.stale.join(", ")}` : `current (${d.builtAt})`}`)
  console.log(`Apps\n${Object.entries(report.apps).map(([name, a]) => `  ${name.padEnd(8)} ${a.running ? `running ${a.url}` : "stopped"}`).join("\n")}`)
}
