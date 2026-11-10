/**
 * Writes or drops a changeset without changesets' interactive prompt, for the
 * workspace status mod and for scripts (`scripts/runbooks/release-and-ci.md`):
 *
 *   node scripts/changeset.mjs add <patch|minor|major> [package...] < note.md
 *   node scripts/changeset.mjs drop <id>
 *
 * `add` reads the note from stdin and names `@motionscript/core` when no
 * package is given: every public package is in one fixed group, so naming one
 * versions them all, and the note lands in the named packages' changelogs.
 * `drop` refuses a changeset an earlier prerelease already consumed. Both run
 * `check-changesets.mjs` after, so a breaking note without its marker says so.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dir = join(root, ".changeset")
const [command, ...rest] = process.argv.slice(2)

function fail(message) {
  console.error(`[changeset] ${message}`)
  process.exit(1)
}
const fixed = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).fixed.flat()
const check = () => spawnSync(process.execPath, [join(root, "scripts/check-changesets.mjs")], { cwd: root, stdio: "inherit" }).status === 0

export function slug(note) {
  const words = note
    .replace(/\*\*Breaking:\*\*/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
  return words.join("-").slice(0, 60).replace(/-+$/, "") || "change"
}

if (command === "add") {
  const [bump, ...named] = rest
  if (!["patch", "minor", "major"].includes(bump)) fail("add takes patch, minor or major first.")
  const packages = named.length ? named : ["@motionscript/core"]
  const unknown = packages.filter((name) => !fixed.includes(name))
  if (unknown.length) fail(`not a published package: ${unknown.join(", ")}.`)
  const note = readFileSync(0, "utf8").replace(/\r\n/g, "\n").trim()
  if (!note) fail("the note is empty: pass it on stdin.")
  let id = slug(note)
  for (let n = 2; existsSync(join(dir, `${id}.md`)); n++) id = `${slug(note)}-${n}`
  const front = packages.map((name) => `"${name}": ${bump}`).join("\n")
  writeFileSync(join(dir, `${id}.md`), `---\n${front}\n---\n\n${note}\n`)
  console.log(`[changeset] wrote .changeset/${id}.md (${bump}, ${packages.join(", ")})`)
  process.exit(check() ? 0 : 1)
}

if (command === "drop") {
  const [id] = rest
  if (!id || /[\\/]/.test(id)) fail("drop takes a changeset id.")
  const file = join(dir, `${id}.md`)
  if (!existsSync(file)) fail(`no .changeset/${id}.md.`)
  const pre = existsSync(join(dir, "pre.json")) ? JSON.parse(readFileSync(join(dir, "pre.json"), "utf8")) : null
  if (pre?.mode === "pre" && pre.changesets.includes(id)) fail(`${id} is already in a published prerelease; it can't be dropped.`)
  rmSync(file)
  console.log(`[changeset] dropped .changeset/${id}.md`)
  process.exit(0)
}

fail("commands: add <patch|minor|major> [package...] (note on stdin), drop <id>.")
