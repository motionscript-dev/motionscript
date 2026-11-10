/**
 * Publishes the pending changesets from the branch it runs on
 * (`scripts/runbooks/release-and-ci.md`): `alpha` publishes prereleases
 * (`0.1.0-alpha.N`, npm tag `alpha`), `main` publishes stable versions (npm tag
 * `latest`), leaving changesets' pre mode first when a merge from `alpha` brought
 * it along. The Release workflow runs it with `--ci` after CI passes on either
 * branch; run it yourself for a package's first publish or when CI can't.
 *
 *   version   changeset version, synced root version, lockfile; committed
 *   publish   pnpm build:lib, then every public package not yet on npm at the
 *             new version, packed by pnpm and uploaded by npm; tagged locally
 *   snapshot  the release's documents into core's fixture corpus; committed
 *   github    push the branch and the release's tags, then one GitHub release
 *
 *   pnpm release [steps...] [--dry-run] [--yes] [--ci] [--prebuilt]
 *
 * `--prebuilt` publishes the libraries already built in the tree instead of
 * running build:lib: the Release workflow unpacks CI's build of this very
 * commit, which `build-sha.txt` names. CI publishes four packages at a time.
 *
 * No steps runs all four, in that order. Each step skips itself when its work is
 * done, so after a failure run it again. It asks before publishing and before
 * pushing; `--yes` answers for you. `--dry-run` checks and prints what each
 * step would do, changing nothing. `--ci` is `--yes` without the sign-in checks:
 * npm signs in through Trusted Publishing and gh through `GH_TOKEN`.
 *
 * Packing with pnpm rewrites `workspace:` ranges to real versions; uploading
 * with npm uses npm's own login, one-time-password prompt and Trusted
 * Publishing, none of which `pnpm publish` passed on reliably.
 */

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const STEPS = ["version", "publish", "snapshot", "github"]
const FLAGS = ["--dry-run", "--yes", "--ci", "--prebuilt"]
const CHANNELS = { alpha: { tag: "alpha", pre: true }, main: { tag: "latest", pre: false } }

const args = process.argv.slice(2)
const ci = args.includes("--ci")
const dryRun = args.includes("--dry-run")
const yes = ci || args.includes("--yes")
const prebuilt = args.includes("--prebuilt")
const named = args.filter((arg) => !arg.startsWith("--"))
const unknown = [...named.filter((step) => !STEPS.includes(step)), ...args.filter((arg) => arg.startsWith("--") && !FLAGS.includes(arg))]

const log = (line) => console.log(`[release] ${line}`)
function fail(message) {
  console.error(`[release] ${message}`)
  process.exit(1)
}

if (unknown.length) fail(`unknown ${unknown.join(", ")}: steps are ${STEPS.join(" ")}, flags ${FLAGS.join(" ")}.`)
const steps = named.length ? STEPS.filter((step) => named.includes(step)) : STEPS

/** Runs a command where the person sees it (and can answer npm's one-time password). */
function run(command, cwd = root) {
  console.log(`\n$ ${command}`)
  return spawnSync(command, { cwd, shell: true, stdio: "inherit" }).status === 0
}

function capture(command) {
  const result = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  return { ok: result.status === 0, out: (result.stdout ?? "").trimEnd(), err: (result.stderr ?? "").trim() }
}

/** `capture`, without blocking, for running several at once; `out` holds stdout and stderr. */
function captureAsync(command, cwd = root) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (out += chunk))
    child.on("close", (code) => resolve({ ok: code === 0, out: out.trimEnd() }))
  })
}

/** Runs `task` over `items`, `limit` at a time. */
async function inPool(items, limit, task) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await task(queue.shift())
  }))
}

async function confirm(question) {
  if (yes) return true
  if (!process.stdin.isTTY) fail(`${question} needs an answer: run it in a terminal, or pass --yes.`)
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question(`[release] ${question} [y/N] `)
  prompt.close()
  return /^y(es)?$/i.test(answer.trim())
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))
const coreVersion = () => readJson(join(root, "packages/core/package.json")).version

function packageDirs(dir, depth = 0) {
  if (depth > 2) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) return []
    const path = join(dir, entry.name)
    return existsSync(join(path, "package.json")) ? [path] : packageDirs(path, depth + 1)
  })
}

const publicPackages = () =>
  packageDirs(join(root, "packages"))
    .map((dir) => ({ dir, ...readJson(join(dir, "package.json")) }))
    .filter((pkg) => !pkg.private)
    .sort((a, b) => a.name.localeCompare(b.name))

const tagOf = (name, version) => `${name}@${version}`
// npm's answers for this run: nothing else publishes while it runs, and what
// it publishes it records here.
const npmState = new Map()
function onNpm(name, version) {
  const key = tagOf(name, version)
  if (!npmState.has(key)) npmState.set(key, capture(`npm view ${key} version`).out === version)
  return npmState.get(key)
}
async function askNpm(version) {
  await Promise.all(publicPackages().map(async ({ name }) => {
    const key = tagOf(name, version)
    if (!npmState.has(key)) npmState.set(key, (await captureAsync(`npm view ${key} version`)).out === version)
  }))
}
const missingFromNpm = (version) => publicPackages().filter((pkg) => !onNpm(pkg.name, version))
const fixtureDir = (version) => `packages/core/test/fixtures/documents/${version}`

// ── Pre mode ──────────────────────────────────────────────────────────

const PRE = join(root, ".changeset/pre.json")
const preMode = () => (existsSync(PRE) ? readJson(PRE).mode : null)

/** Puts the repo in the branch's mode: `alpha` in pre mode, `main` out of it. */
function enterChannelMode(channel) {
  const mode = preMode()
  if (channel.pre && mode !== "pre") {
    if (mode === "exit") fail('pre.json is mid-exit (mode "exit"), as main leaves it; merge main\'s release commit, which deletes it.')
    return capture(`pnpm exec changeset pre enter ${channel.tag}`)
  }
  if (!channel.pre && mode === "pre") return capture("pnpm exec changeset pre exit")
  return { ok: true }
}

/** What `changeset version` would release on this branch: the version, or null with nothing pending. */
function pendingRelease(channel) {
  // `changeset status` errors when packages differ from baseBranch and nothing is pending, as right after a release
  // commit. Pre mode keeps the changesets it released, listing them in pre.json; leaving pre mode releases them again.
  const released = channel.pre && preMode() === "pre" ? new Set(readJson(PRE).changesets) : new Set()
  const ids = readdirSync(join(root, ".changeset")).filter((file) => file.endsWith(".md") && file !== "README.md")
  if (!ids.some((file) => !released.has(file.slice(0, -3)))) return null
  const saved = existsSync(PRE) ? readFileSync(PRE, "utf8") : null
  const dir = mkdtempSync(join(tmpdir(), "ms-release-"))
  try {
    const switched = enterChannelMode(channel)
    if (!switched.ok) fail(`switching changesets' pre mode failed:\n${switched.err || switched.out}`)
    const out = join(dir, "status.json")
    // status diffs against baseBranch, which CI's checkout of alpha has only as origin/<base>.
    const base = readJson(join(root, ".changeset/config.json")).baseBranch
    if (!capture(`git rev-parse --verify -q refs/heads/${base}`).ok) capture(`git branch ${base} origin/${base}`)
    const status = capture(`pnpm exec changeset status --output="${out}"`)
    if (!status.ok) fail(`changeset status failed:\n${status.err || status.out}`)
    const { changesets, releases } = readJson(out)
    const bumped = releases.filter((release) => release.newVersion !== release.oldVersion)
    if (!bumped.length) return null
    return { version: bumped[0].newVersion, changesets: changesets.length, major: bumped.some((release) => release.type === "major") }
  } finally {
    if (saved === null) rmSync(PRE, { force: true })
    else writeFileSync(PRE, saved)
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── Where things stand ────────────────────────────────────────────────

const branch = capture("git branch --show-current").out || process.env.GITHUB_REF_NAME
const channel = CHANNELS[branch]
if (!channel) fail(`on ${branch || "a detached HEAD"}: releases come from alpha (prereleases) or main (stable versions).`)

const problems = []
const dirty = capture("git status --porcelain").out
if (dirty) problems.push(`the tree has uncommitted changes (the release commit would take them):\n${dirty}`)
if (capture(`git fetch --quiet origin ${branch}`).ok) {
  const behind = Number(capture(`git rev-list --count HEAD..origin/${branch}`).out)
  if (behind > 0) problems.push(`${branch} is ${behind} commit(s) behind origin/${branch}: git pull first.`)
} else {
  problems.push(`couldn't fetch origin ${branch} (does the branch exist on GitHub yet?).`)
}

const pending = pendingRelease(channel)
const version = pending?.version ?? coreVersion()
await askNpm(version)
const missing = missingFromNpm(version)
const prerelease = version.includes("-")

if (pending?.major) problems.push(`a pending changeset is a major bump, so this releases ${version}. Make it minor if that isn't meant.`)
if (prerelease !== channel.pre) problems.push(`${branch} publishes ${channel.pre ? "prereleases" : "stable versions"}, but the version here is ${version}.`)

if (steps.includes("publish") && missing.length) {
  if (!ci) {
    const who = capture("npm whoami")
    if (who.ok) log(`npm: signed in as ${who.out}`)
    else problems.push("npm isn't signed in: run `npm login`.")
  }
}
if (prebuilt) {
  const shaFile = join(root, "build-sha.txt")
  const builtFrom = existsSync(shaFile) ? readFileSync(shaFile, "utf8").trim() : null
  const head = capture("git rev-parse HEAD").out
  if (builtFrom !== head) problems.push(`--prebuilt needs a build of HEAD (${head.slice(0, 8)}), but build-sha.txt names ${builtFrom ?? "nothing"}.`)
} else if (steps.includes("publish") && missing.length) {
  const lock = readFileSync(join(root, "packages/renderer/Cargo.lock"), "utf8")
  const pinned = lock.match(/name = "wasm-bindgen"\r?\nversion = "([^"]+)"/)?.[1]
  const installed = capture("wasm-bindgen --version").out.split(" ")[1]
  if (!capture("rustup --version").ok) problems.push("rustup isn't installed: the renderer builds with the toolchain packages/renderer pins.")
  if (installed !== pinned) problems.push(`wasm-bindgen is ${installed ?? "not installed"}, the renderer needs ${pinned}: cargo install wasm-bindgen-cli --version ${pinned} --locked`)
}
if (!ci && steps.includes("github") && !capture("gh auth status").ok) problems.push("gh isn't signed in: gh auth login")

log(`${branch} publishes ${channel.pre ? "prereleases" : "stable versions"} under the "${channel.tag}" npm tag`)
log(pending ? `${pending.changesets} pending changeset(s) release ${version}` : `no pending changesets; the version is ${version}`)
log(missing.length ? `${missing.length} package(s) not on npm at ${version}: ${missing.map((pkg) => pkg.name).join(", ")}` : `every package is on npm at ${version}`)

if (problems.length) {
  for (const problem of problems) console.error(`[release] ${dryRun ? "would stop: " : ""}${problem}`)
  if (!dryRun) process.exit(1)
}
if (!pending && !missing.length && !named.length && !ci) {
  log(`nothing to release: no pending changesets and ${version} is on npm. To finish an earlier release: pnpm release snapshot github`)
  process.exit(0)
}

// ── Steps ─────────────────────────────────────────────────────────────

let built = prebuilt

async function versionStep() {
  if (!pending) return log("version: nothing pending")
  if (dryRun) return log(`version: would release ${coreVersion()} → ${version} and commit "ci: release ${version}"`)
  const switched = enterChannelMode(channel)
  if (!switched.ok) fail(`switching changesets' pre mode failed:\n${switched.err || switched.out}`)
  const versioned = run("pnpm exec changeset version") && run("node scripts/sync-root-version.js") && run("pnpm install --no-frozen-lockfile")
  if (!versioned) fail("versioning failed; `git checkout -- . && git clean -fd .changeset` puts the tree back.")
  if (coreVersion() !== version) fail(`changeset version gave ${coreVersion()}, not the ${version} it promised.`)
  if (!run("git add -A") || !run(`git commit -m "ci: release ${version}"`)) fail("committing the release failed.")
}

async function publishStep() {
  const todo = missingFromNpm(version)
  if (!todo.length) return log(`publish: every package is on npm at ${version}`)
  if (dryRun) return log(`publish: would ${built ? "use the build in the tree" : "build"}, then publish ${todo.length} package(s) at ${version} under "${channel.tag}"`)
  if ((!built && !run("pnpm build:lib")) || !run("node scripts/sync-notice.mjs")) fail("the build failed; nothing was published.")
  built = true
  if (capture("git status --porcelain").out) fail("the build changed tracked files; commit or fix them, then run pnpm release again.")
  if (!(await confirm(`Publish ${todo.length} package(s) at ${version} to npm under "${channel.tag}"? A published version can't be reused.`))) fail("stopped before publishing.")

  // By hand, one at a time, so npm's one-time-password prompt reaches the person.
  const failed = []
  await inPool(todo, ci ? 4 : 1, async (pkg) => {
    const packs = mkdtempSync(join(tmpdir(), "ms-pack-"))
    try {
      const exec = ci ? captureAsync : async (command, cwd) => ({ ok: run(command, cwd), out: "" })
      if (!ci) console.log(`\n== ${pkg.name}@${version} ==`)
      const packed = await exec(`pnpm pack --pack-destination "${packs}"`, pkg.dir)
      const tarball = packed.ok && readdirSync(packs).find((file) => file.endsWith(".tgz"))
      const published = tarball && (await exec(`npm publish "${join(packs, tarball)}" --tag ${channel.tag} --access public`, pkg.dir))
      if (ci) console.log(`\n== ${pkg.name}@${version} ==\n${packed.out}\n${published?.out ?? ""}`)
      if (published?.ok) npmState.set(tagOf(pkg.name, version), true)
      else if (ci) failed.push(pkg.name)
      else fail(`publishing ${pkg.name} failed. The packages before it are published: fix it and run pnpm release again for the rest.`)
    } finally {
      rmSync(packs, { recursive: true, force: true })
    }
  })
  if (failed.length) fail(`publishing ${failed.join(", ")} failed; the others are on npm. Fix it and run pnpm release again for the rest.`)
  for (const pkg of publicPackages()) {
    const tag = tagOf(pkg.name, version)
    if (!capture(`git rev-parse -q --verify "refs/tags/${tag}"`).ok) capture(`git tag -a "${tag}" -m "${tag}"`)
  }
}

async function snapshotStep() {
  const dir = fixtureDir(version)
  if (existsSync(join(root, dir))) return log(`snapshot: ${dir} exists`)
  if (dryRun) return log(`snapshot: would write ${dir} and commit "test: snapshot ${version} documents"`)
  if (missingFromNpm(version).length) fail(`snapshot: ${version} isn't fully on npm yet; publish first.`)
  if (!built && !run("pnpm build:lib")) fail("the build failed.")
  if (!run("pnpm --filter @motionscript/e2e exec tsx scripts/snapshot-document-fixtures.ts")) fail("the snapshot failed.")
  // Tested here so CI can treat the snapshot commit as already tested.
  if (!run("pnpm --filter @motionscript/core exec vitest run src/document/tests/fixture-corpus.test.ts")) fail(`the corpus test fails on ${dir}; nothing was committed.`)
  if (!run(`git add ${dir}`) || !run(`git commit -m "test: snapshot ${version} documents"`)) fail("committing the snapshot failed.")
}

async function githubStep() {
  const release = `v${version}`
  if (missingFromNpm(version).length) {
    if (dryRun) return log(`github: would push ${branch} and the ${version} tags, then create the ${release} release`)
    fail(`github: ${version} isn't fully on npm yet; publish first.`)
  }
  const ahead = Number(capture(`git rev-list --count origin/${branch}..HEAD`).out)
  const remoteTags = capture("git ls-remote --tags origin").out
  const unpushed = publicPackages()
    .map((pkg) => tagOf(pkg.name, version))
    .filter((tag) => capture(`git rev-parse -q --verify "refs/tags/${tag}"`).ok && !remoteTags.includes(`refs/tags/${tag}`))
  const released = capture(`gh release view ${release}`).ok
  if (!ahead && !unpushed.length && released) return log(`github: ${branch}, the tags and ${release} are on GitHub`)
  if (dryRun) return log(`github: would push ${ahead} commit(s) and ${unpushed.length} tag(s), then ${released ? `leave ${release} as it is` : `create the ${release} release`}`)

  if (ahead || unpushed.length) {
    if (!(await confirm(`Push ${ahead} commit(s) on ${branch} and ${unpushed.length} tag(s) to origin?`))) fail("stopped before pushing.")
    if (ahead && !run(`git push origin HEAD:${branch}`)) fail(`pushing ${branch} failed.`)
    if (unpushed.length && !run(`git push origin ${unpushed.map((tag) => `"refs/tags/${tag}"`).join(" ")}`)) fail("pushing the tags failed.")
  }
  if (released) return
  const changelog = readFileSync(join(root, "packages/core/CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n")
  const start = changelog.indexOf(`## ${version}`)
  if (start < 0) fail(`packages/core/CHANGELOG.md has no "## ${version}" entry for the release notes.`)
  const next = changelog.indexOf("\n## ", start + 3)
  const dir = mkdtempSync(join(tmpdir(), "ms-release-"))
  const notes = join(dir, "notes.md")
  writeFileSync(notes, changelog.slice(start, next < 0 ? undefined : next).trim())
  const target = capture(`git rev-list -n 1 "${tagOf("@motionscript/core", version)}"`).out || branch
  const created = run(`gh release create ${release} --title ${release} --notes-file "${notes}" --target ${target} ${prerelease ? "--prerelease" : "--latest"}`)
  rmSync(dir, { recursive: true, force: true })
  if (!created) fail(`creating the ${release} release failed; run pnpm release github again.`)
}

const handlers = { version: versionStep, publish: publishStep, snapshot: snapshotStep, github: githubStep }
for (const step of steps) await handlers[step]()

if (dryRun) log("dry run: nothing changed.")
else if (!missingFromNpm(version).length) log(`${version} is on npm under "${channel.tag}"; hosts can move their pins to it.`)
