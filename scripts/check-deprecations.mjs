/**
 * Holds every component kit's deprecations to their removal date. Exits 1 when a `@deprecated` doc comment or a
 * `deprecate(…)` call names no `Remove in X.Y.Z.` / `removeIn`, or names a release the kit has already reached.
 * A prerelease of that version counts as reached, so the removal lands before the stable one.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const VERSION = /^(\d+)\.(\d+)\.(\d+)/

/** -1, 0 or 1 by major.minor.patch, ignoring any prerelease. */
export function compareRelease(a, b) {
  const [x, y] = [a, b].map((v) => {
    const m = VERSION.exec(v)
    if (!m) throw new Error(`not a version: ${v}`)
    return m.slice(1, 4).map(Number)
  })
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i])
  return 0
}

const line = (source, index) => source.slice(0, index).split("\n").length

/** Every problem with the deprecations in one source file, for a package at `version`. */
export function deprecationProblems(source, version) {
  const problems = []
  const due = (removeIn, at, what) => {
    if (!removeIn) problems.push(`${at}: ${what} names no removal release`)
    else if (compareRelease(version, removeIn) >= 0) problems.push(`${at}: ${what} was due in ${removeIn} (package is ${version}): remove it`)
  }
  for (const m of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    if (!/@deprecated\b/.test(m[0])) continue
    due(/Remove in (\d+\.\d+\.\d+)/.exec(m[0])?.[1], `line ${line(source, m.index)}`, "@deprecated")
  }
  for (const m of source.matchAll(/\bdeprecate\(/g)) {
    const call = source.slice(m.index, m.index + 600)
    due(/removeIn:\s*["'`](\d+\.\d+\.\d+)/.exec(call)?.[1], `line ${line(source, m.index)}`, "deprecate()")
  }
  return problems
}

function sources(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === "tests" || entry === "node_modules" ? [] : sources(path)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : []
  })
}

export function checkKits(kitsDir = join(root, "packages", "components")) {
  const problems = []
  for (const kit of readdirSync(kitsDir)) {
    const pkgPath = join(kitsDir, kit, "package.json")
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    } catch {
      continue
    }
    for (const file of sources(join(kitsDir, kit, "src"))) {
      const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
      for (const problem of deprecationProblems(text, pkg.version)) {
        problems.push(`${relative(root, file).split("\\").join("/")} ${problem}`)
      }
    }
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkKits()
  if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
}
