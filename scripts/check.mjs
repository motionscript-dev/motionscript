/**
 * Runs CI's checks one after another, and stops at the first
 * failure (`scripts/runbooks/release-and-ci.md`):
 *
 *   build       pnpm build:lib (lint, typecheck and tests read built dist/)
 *   notices     every published package carries the root NOTICE
 *   changesets  pending notes carry the breaking marker where they need it
 *   lint, typecheck, test
 *
 *   pnpm check [--no-build] [--e2e]
 *
 * `--no-build` skips the build when nothing changed since the last one.
 * `--e2e` also runs the e2e suite (CI's renderer job), after the rest.
 */

import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const unknown = args.filter((arg) => !["--no-build", "--e2e"].includes(arg))
if (unknown.length) {
  console.error(`[check] unknown ${unknown.join(", ")}: flags are --no-build --e2e.`)
  process.exit(1)
}

const steps = [
  ["build", "pnpm build:lib"],
  ["notices", "node scripts/sync-notice.mjs --check"],
  ["changesets", "node scripts/check-changesets.mjs"],
  ["lint", "pnpm lint"],
  ["typecheck", "pnpm typecheck"],
  // CI makes every vitest run once instead of watching.
  ["test", "pnpm test"],
  ["e2e", "pnpm test:e2e"],
].filter(([name]) => (name !== "build" || !args.includes("--no-build")) && (name !== "e2e" || args.includes("--e2e")))

const started = Date.now()
for (const [name, command] of steps) {
  console.log(`\n[check] ${name}: ${command}`)
  const status = spawnSync(command, { cwd: root, shell: true, stdio: "inherit", env: { ...process.env, CI: "1" } }).status
  if (status !== 0) {
    console.error(`\n[check] ${name} failed.`)
    process.exit(1)
  }
}
console.log(`\n[check] ${steps.map(([name]) => name).join(", ")} passed in ${Math.round((Date.now() - started) / 1000)}s.`)
