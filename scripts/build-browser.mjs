/**
 * Builds `dist/browser/`: one ES module per `exports` entry, loadable from a CDN
 * through an import map. Peer dependencies stay imports so every package shares
 * the one copy the map names; everything else is bundled in. `manifest.json`
 * maps each export and binary asset to a package-relative path and lists the
 * bundled third-party packages, whose licences go to `THIRD_PARTY_LICENSES.txt`.
 */

import { build } from "esbuild"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { builtinModules, createRequire } from "node:module"
import { dirname, join, relative, resolve, sep } from "node:path"

const packageDir = resolve(process.argv[2] ?? process.cwd())
const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
const outdir = join(packageDir, "dist", "browser")

/** An export's JavaScript file, or null for types, wildcards and assets. */
function moduleTarget(subpath, target) {
  if (subpath.includes("*") || subpath === "./package.json") return null
  const file =
    typeof target === "string"
      ? target
      : (target?.browser ?? target?.import ?? target?.default)
  return typeof file === "string" && /\.[cm]?js$/.test(file) ? file : null
}

function entryName(subpath) {
  return subpath === "." ? "index" : subpath.slice(2).replace(/\//g, "-")
}

const exportsField =
  typeof pkg.exports === "string" || !pkg.exports
    ? { ".": pkg.exports ?? pkg.main }
    : pkg.exports
const entries = Object.entries(exportsField).flatMap(([subpath, target]) => {
  const file = moduleTarget(subpath, target)
  return file ? [{ subpath, name: entryName(subpath), file }] : []
})
if (entries.length === 0) throw new Error(`${pkg.name} exports no module`)

const peers = Object.keys(pkg.peerDependencies ?? {})
// Node built-ins a dependency reaches only behind a runtime check for Node.
const external = [
  ...peers.flatMap((name) => [name, `${name}/*`]),
  ...builtinModules.flatMap((name) => [name, `node:${name}`]),
]

rmSync(outdir, { recursive: true, force: true })
const { metafile } = await build({
  absWorkingDir: packageDir,
  entryPoints: Object.fromEntries(
    entries.map(({ name, file }) => [name, join(packageDir, file)])
  ),
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: "linked",
  chunkNames: "chunks/[name]-[hash]",
  external,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  metafile: true,
})

/** The package a bundled file belongs to: the nearest package.json with a name. */
function owningPackage(file) {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, "package.json")
    if (!existsSync(manifest)) continue
    const found = JSON.parse(readFileSync(manifest, "utf8"))
    if (found.name) return { dir, ...found }
  }
  return null
}

const bundled = new Map()
for (const output of Object.values(metafile.outputs)) {
  for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
    if (bytesInOutput === 0) continue
    const owner = owningPackage(resolve(packageDir, input))
    if (!owner || owner.name.startsWith("@motionscript/")) continue
    bundled.set(`${owner.name}@${owner.version}`, owner)
  }
}

const thirdParty = [...bundled.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)
)

// Bundling copies each dependency into dist/browser, so its licence travels too.
if (thirdParty.length > 0) {
  const sections = thirdParty.map(({ dir, name, version, license }) => {
    const files = readdirSync(dir)
      .filter((file) => /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(file))
      .sort()
    const texts = files.map((file) => readFileSync(join(dir, file), "utf8").trim())
    const body = texts.length > 0 ? texts.join("\n\n") : `${license ?? "UNKNOWN"} (no licence file in the package)`
    return `${name} ${version}\nLicense: ${license ?? "UNKNOWN"}\n\n${body}\n`
  })
  writeFileSync(
    join(outdir, "THIRD_PARTY_LICENSES.txt"),
    `Third-party software bundled into ${pkg.name}'s browser build (dist/browser/).\n\n` +
      sections.join(`\n${"-".repeat(78)}\n\n`)
  )
}

/** A path in the manifest is a URL path below the package root, so `/` on every OS. */
const packagePath = (file) => relative(packageDir, file).split(sep).join("/")

const assets = {}
const require = createRequire(join(packageDir, "package.json"))
for (const [name, source] of Object.entries(pkg.motionscriptBrowser?.assets ?? {})) {
  const from = source.startsWith(".")
    ? join(packageDir, source)
    : require.resolve(source)
  const inside = !relative(packageDir, from).startsWith("..")
  if (inside && !relative(packageDir, from).startsWith("node_modules")) {
    assets[name] = packagePath(from)
  } else {
    mkdirSync(outdir, { recursive: true })
    copyFileSync(from, join(outdir, name))
    assets[name] = packagePath(join(outdir, name))
  }
}

const toPackagePath = (name) => packagePath(join(outdir, `${name}.js`))
writeFileSync(
  join(outdir, "manifest.json"),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      exports: Object.fromEntries(
        entries.map(({ subpath, name }) => [subpath, toPackagePath(name)])
      ),
      peers,
      assets,
      thirdParty: thirdParty.map(({ name, version, license }) => ({
        name,
        version,
        license: license ?? "UNKNOWN",
      })),
    },
    null,
    2
  )}\n`
)

console.log(
  `[browser] ${pkg.name}: ${entries.map((e) => e.subpath).join(", ")} → ${relative(dirname(packageDir), outdir)}`
)
