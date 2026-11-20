/**
 * Holds every component kit's deprecations to their removal date. Exits 1 when a `@deprecated` doc comment or a
 * `deprecate(…)` call names no `Remove in X.Y.Z.` / `removeIn`, or names a release the kit has already reached.
 * A prerelease of that version counts as reached, so the removal lands before the stable one. A kit retired whole
 * (`motionscript.deprecated` in its package.json) is held to the same release, and its `npm deprecate` is printed.
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

/**
 * Every problem with a kit retired whole by `"motionscript": { "deprecated": { removeIn, message } }` in its
 * package.json: the README must open with a deprecation banner and every root-barrel export carry `@deprecated`.
 */
export function retiredKitProblems(pkg, readme, barrel) {
  const marker = pkg.motionscript?.deprecated
  if (!marker) return []
  const { removeIn, message } = marker
  if (!removeIn || !VERSION.test(removeIn)) return ["package.json: motionscript.deprecated names no removeIn release"]
  const problems = []
  if (!message) problems.push("package.json: motionscript.deprecated has no message for npm deprecate")
  if (compareRelease(pkg.version, removeIn) >= 0) {
    problems.push(`package.json: the kit was due for removal in ${removeIn} (package is ${pkg.version}): delete it`)
  }
  const opening = readme?.split("\n").find((l) => l.trim() !== "" && !l.startsWith("# "))
  if (!opening || !/^>\s*\*\*Deprecated\b/.test(opening)) {
    problems.push("README.md: opens with no `> **Deprecated.** …` banner")
  }
  for (const m of barrel.matchAll(/^export\b.*$/gm)) {
    const at = `src/index.ts line ${line(barrel, m.index)}`
    const braces = /^export\s+(?:type\s+)?\{([^}]*)\}/.exec(m[0])
    if (!braces) {
      const before = barrel.slice(0, m.index).trimEnd()
      const doc = before.endsWith("*/") ? before.slice(before.lastIndexOf("/**")) : ""
      if (!/@deprecated\b/.test(doc)) problems.push(`${at}: \`${m[0]}\` is not @deprecated`)
      continue
    }
    // TypeScript reads a re-export's @deprecated only from inside the braces, one per name.
    const names = braces[1].replace(/\/\*\*[\s\S]*?\*\//g, (doc) => (/@deprecated\b/.test(doc) ? "@deprecated " : ""))
    for (const name of names.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!name.startsWith("@deprecated ")) problems.push(`${at}: \`${name}\` is not @deprecated inside the braces`)
    }
  }
  return problems
}

const readText = (path) => {
  try {
    return readFileSync(path, "utf8").replace(/\r\n/g, "\n")
  } catch {
    return undefined
  }
}

function kits(kitsDir) {
  return readdirSync(kitsDir).flatMap((kit) => {
    const text = readText(join(kitsDir, kit, "package.json"))
    return text === undefined ? [] : [{ dir: join(kitsDir, kit), pkg: JSON.parse(text) }]
  })
}

/** The `npm deprecate` command for each kit retired whole, which a maintainer runs once it has published. */
export function retiredKitCommands(kitsDir = join(root, "packages", "components")) {
  return kits(kitsDir)
    .filter(({ pkg }) => pkg.motionscript?.deprecated)
    .map(({ pkg }) => `npm deprecate ${pkg.name} ${JSON.stringify(pkg.motionscript.deprecated.message ?? "")}`)
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
  const shown = (path) => relative(root, path).split("\\").join("/")
  for (const { dir, pkg } of kits(kitsDir)) {
    for (const file of sources(join(dir, "src"))) {
      for (const problem of deprecationProblems(readText(file), pkg.version)) problems.push(`${shown(file)} ${problem}`)
    }
    const barrel = readText(join(dir, "src", "index.ts")) ?? ""
    for (const problem of retiredKitProblems(pkg, readText(join(dir, "README.md")), barrel)) {
      problems.push(`${shown(dir)}/${problem}`)
    }
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkKits()
  const commands = retiredKitCommands()
  if (commands.length > 0) {
    console.log(`Retired kits: once their deprecation release is on npm, run by hand (Trusted Publishing has no token):\n${commands.join("\n")}`)
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
}
