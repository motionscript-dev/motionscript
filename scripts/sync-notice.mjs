/**
 * Copies the root NOTICE into every published package, beside its LICENSE, so
 * each npm tarball carries it (`files` lists it). Run by `release` before
 * publishing; `--check` exits 1 when a copy has drifted.
 */

import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const notice = readFileSync(join(root, "NOTICE"), "utf8")
const check = process.argv.includes("--check")

function packageDirs(dir, depth = 0) {
  if (depth > 2) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) return []
    const path = join(dir, entry.name)
    return existsSync(join(path, "package.json")) ? [path] : packageDirs(path, depth + 1)
  })
}

const stale = []
for (const dir of packageDirs(join(root, "packages"))) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  if (pkg.private) continue
  if (!pkg.files?.includes("NOTICE")) stale.push(`${pkg.name}: "NOTICE" missing from files`)
  const target = join(dir, "NOTICE")
  if (existsSync(target) && readFileSync(target, "utf8") === notice) continue
  if (check) stale.push(`${relative(root, target)} differs from the root NOTICE`)
  else copyFileSync(join(root, "NOTICE"), target)
}

if (stale.length > 0) {
  console.error(stale.join("\n"))
  process.exit(1)
}
