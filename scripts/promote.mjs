/**
 * Promotes alpha to main by fast-forward (`scripts/runbooks/release-and-ci.md`):
 * main becomes the exact commit alpha's CI passed, so main's CI recognises it
 * as tested and Release publishes the stable version straight away.
 *
 *   pnpm promote [--dry-run]
 *
 * Refuses when main has commits alpha lacks (merge main into alpha first) or
 * when alpha's tip on GitHub has no passing CI run yet.
 */

import { spawnSync } from "node:child_process"

const FROM = "alpha"
const TO = "main"
const dryRun = process.argv.includes("--dry-run")

function capture(command) {
  const result = spawnSync(command, { shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() }
}
function fail(message) {
  console.error(`[promote] ${message}`)
  process.exit(1)
}

if (!capture(`git fetch --quiet origin ${FROM} ${TO}`).ok) fail(`couldn't fetch origin ${FROM} and ${TO}.`)
const from = capture(`git rev-parse origin/${FROM}`).out
const to = capture(`git rev-parse origin/${TO}`).out
if (from === to) {
  console.log(`[promote] ${TO} is already ${FROM} (${from.slice(0, 8)}).`)
  process.exit(0)
}
if (!capture(`git merge-base --is-ancestor ${to} ${from}`).ok) fail(`${TO} has commits ${FROM} lacks; merge origin/${TO} into ${FROM} and push that first.`)

// The release commits on alpha's tip are pushed by CI without a run of their
// own, so the check is that some ancestor within the last few commits passed;
// main's CI makes the exact call (scripts/ci-tested.mjs).
const runs = capture(`gh run list --workflow ci.yml --branch ${FROM} --limit 20 --json headSha,status,conclusion`)
if (!runs.ok) fail(`couldn't read CI runs (is gh signed in?): ${runs.err}`)
const recent = capture(`git rev-list --max-count=5 ${from}`).out.split("\n")
const latest = JSON.parse(runs.out).find((run) => recent.includes(run.headSha))
if (!latest) fail(`no CI run on ${FROM} covers its tip ${from.slice(0, 8)}; wait for it.`)
if (latest.status !== "completed") fail(`CI on ${FROM} (${latest.headSha.slice(0, 8)}) is still running; promote when it passes.`)
if (latest.conclusion !== "success") fail(`CI on ${FROM} (${latest.headSha.slice(0, 8)}) ${latest.conclusion}; fix ${FROM} first.`)

const commits = capture(`git log --oneline ${to}..${from}`).out
console.log(`[promote] ${TO} ${to.slice(0, 8)} → ${from.slice(0, 8)}:\n${commits}`)
if (dryRun) {
  console.log("[promote] dry run: nothing pushed.")
  process.exit(0)
}
if (spawnSync(`git push origin ${from}:refs/heads/${TO}`, { shell: true, stdio: "inherit" }).status !== 0) fail("the push failed.")
console.log(`[promote] pushed. ${TO}'s CI skips the tests this code passed, then Release publishes it.`)
