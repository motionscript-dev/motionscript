/**
 * Decides whether CI's tests can be skipped because this code already passed
 * them (`scripts/runbooks/release-and-ci.md`, "Never twice"). It finds the
 * nearest ancestor of HEAD that a pushed CI run passed on, and calls HEAD
 * tested when everything between the two is release bookkeeping: the commits
 * `scripts/release.mjs` makes (versions, changelogs, consumed changesets, the
 * fixture snapshot, which the release tests before committing).
 *
 *   node scripts/ci-tested.mjs [--full]
 *
 * Writes `tested=true|false`, and `base=<sha>` when one was found, to
 * $GITHUB_OUTPUT (stdout without it). Pull requests and `--full` are never
 * tested. Needs a full-history checkout and GH_TOKEN for `gh api`.
 */

import { appendFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
const SNAPSHOT = /^packages\/core\/test\/fixtures\/documents\/[^/]+\//

/** A package.json with its version and its `@motionscript/*` ranges blanked, which is all a release changes. */
export function withoutVersions(json) {
  const pkg = structuredClone(json)
  delete pkg.version
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(pkg[field] ?? {})) if (name.startsWith("@motionscript/")) pkg[field][name] = "*"
  }
  return JSON.stringify(pkg)
}

/**
 * Whether one changed path is release bookkeeping. `status` is git's letter
 * (A, M, D); `read(rev)` gives a package.json's text at `"base"` or `"head"`.
 */
export function isReleaseChange(status, path, read) {
  if (path.endsWith("CHANGELOG.md")) return true
  if (path === ".changeset/pre.json") return true
  if (path.startsWith(".changeset/") && path.endsWith(".md")) return status === "D"
  if (SNAPSHOT.test(path)) return status === "A"
  if (path === "package.json" || path.endsWith("/package.json")) {
    if (status !== "M") return false
    return withoutVersions(JSON.parse(read("base"))) === withoutVersions(JSON.parse(read("head")))
  }
  return false
}

/** The nearest candidate sha that is an ancestor of HEAD (or HEAD itself), or null. */
export function nearestAncestor(shas, isAncestor, distance) {
  let best = null
  for (const sha of new Set(shas)) {
    if (!isAncestor(sha)) continue
    const steps = distance(sha)
    if (best === null || steps < best.steps) best = { sha, steps }
  }
  return best?.sha ?? null
}

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" })
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() }
}

function decide() {
  if (process.argv.includes("--full")) return { tested: false, why: "a full run was asked for" }
  if (process.env.GITHUB_EVENT_NAME === "pull_request") return { tested: false, why: "pull requests always run" }

  const repo = process.env.GITHUB_REPOSITORY
  const runs = spawnSync(
    "gh",
    ["api", `repos/${repo}/actions/workflows/ci.yml/runs?status=success&per_page=100`, "--jq", '.workflow_runs[] | select(.event != "pull_request") | .head_sha'],
    { encoding: "utf8" },
  )
  if (runs.status !== 0) return { tested: false, why: `couldn't list CI runs: ${runs.stderr.trim()}` }

  const base = nearestAncestor(
    runs.stdout.split("\n").filter(Boolean),
    (sha) => git("merge-base", "--is-ancestor", sha, "HEAD").ok,
    (sha) => Number(git("rev-list", "--count", `${sha}..HEAD`).out),
  )
  if (!base) return { tested: false, why: "no ancestor of HEAD has passed CI" }

  const changes = git("diff", "--name-status", "--no-renames", base, "HEAD").out.split("\n").filter(Boolean)
  const read = (path) => (rev) => git("show", `${rev === "base" ? base : "HEAD"}:${path}`).out
  const code = changes
    .map((line) => line.split("\t"))
    .filter(([status, path]) => !isReleaseChange(status, path, read(path)))
  if (code.length) return { tested: false, base, why: `${code.length} change(s) since ${base.slice(0, 8)} passed, e.g. ${code[0][1]}` }
  return { tested: true, base, why: changes.length ? `only release bookkeeping since ${base.slice(0, 8)} passed` : `${base.slice(0, 8)} passed` }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { tested, base, why } = decide()
  console.log(`[ci-tested] ${tested ? "tested" : "not tested"}: ${why}`)
  const lines = [`tested=${tested}`, ...(base ? [`base=${base}`] : [])].join("\n") + "\n"
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines)
  else process.stdout.write(lines)
}
