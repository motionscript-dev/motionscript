/**
 * Starts the development servers, side by side in one terminal:
 *
 *   react   the example React host (apps/react, Vite)
 *   engine  the example Node host (apps/engine, a watched server)
 *
 *   pnpm dev [react|engine...]
 *
 * No target starts `react`. Each runs against the built `dist/` of the packages
 * it imports, so run `pnpm build:lib` first, and again (or a package's own
 * `pnpm --filter <name> dev` watch build) after an engine change.
 */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const TARGETS = {
  react: "@motionscript/app-react",
  engine: "@motionscript/app-engine",
}

const named = process.argv.slice(2)
const unknown = named.filter((target) => !TARGETS[target])
if (unknown.length) {
  console.error(`[dev] unknown ${unknown.join(", ")}: targets are ${Object.keys(TARGETS).join(" ")}.`)
  process.exit(1)
}
const targets = named.length ? [...new Set(named)] : ["react"]

if (!existsSync(join(root, "packages/core/dist")) || !existsSync(join(root, "packages/renderer/dist"))) {
  console.error("[dev] the engine isn't built: run pnpm build:lib first.")
  process.exit(1)
}

const commands = targets.map((target) => `"pnpm --filter ${TARGETS[target]} dev"`).join(" ")
const status = spawnSync(`pnpm exec concurrently --kill-others-on-fail -n ${targets.join(",")} ${commands}`, {
  cwd: root,
  shell: true,
  stdio: "inherit",
}).status
process.exit(status ?? 1)
