import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkKits,
  compareRelease,
  deprecationProblems,
  retiredKitCommands,
  retiredKitProblems,
} from "./check-deprecations.mjs"

const comment = (text) => `/** @deprecated ${text} */\nexport const old = 1\n`
const call = (removeIn) => `export const old = deprecate(next, {\n  name: "old",\n  use: "next()",\n  removeIn: "${removeIn}",\n})\n`

test("compares releases by major.minor.patch, a prerelease counting as its release", () => {
  assert.equal(compareRelease("0.3.0", "0.4.0"), -1)
  assert.equal(compareRelease("1.0.0-alpha.2", "1.0.0"), 0)
  assert.equal(compareRelease("2.1.0", "2.0.9"), 1)
})

test("a deprecation before its release passes", () => {
  assert.deepEqual(deprecationProblems(comment("Use `next`. Remove in 1.0.0."), "0.3.0"), [])
  assert.deepEqual(deprecationProblems(call("1.0.0"), "0.9.4"), [])
})

test("a deprecation needs a removal release", () => {
  assert.deepEqual(deprecationProblems(comment("Use `next`."), "0.3.0"), ["line 1: @deprecated names no removal release"])
  assert.deepEqual(deprecationProblems("deprecate(next, { name: 'old', use: 'next()' })", "0.3.0"), ["line 1: deprecate() names no removal release"])
})

test("a deprecation whose release has come fails, from its first prerelease", () => {
  assert.deepEqual(deprecationProblems(comment("Use `next`. Remove in 1.0.0."), "1.0.0-alpha.0"), [
    "line 1: @deprecated was due in 1.0.0 (package is 1.0.0-alpha.0): remove it",
  ])
  assert.equal(deprecationProblems(call("0.4.0"), "0.4.1").length, 1)
})

const retired = (version, extra = {}) => ({
  name: "@motionscript/old",
  version,
  motionscript: { deprecated: { removeIn: "0.5.0", message: "Retired.", ...extra } },
})
const bannered = "# @motionscript/old\n\n> **Deprecated.** Removed in 0.5.0.\n\nBody.\n"
const tag = "/** @deprecated Retired. Remove in 0.5.0. */"
const tagged = `// The public surface.\nexport { ${tag} Old } from "./old"\nexport type { ${tag} OldProps } from "./old"\n${tag}\nexport const OLD = 1\n`

test("a retired kit before its release, bannered and fully tagged, passes", () => {
  assert.deepEqual(retiredKitProblems(retired("0.4.1"), bannered, tagged), [])
  assert.deepEqual(retiredKitProblems({ name: "@motionscript/live", version: "9.0.0" }, "# x\n", "export { A } from './a'\n"), [])
})

test("a retired kit fails once it reaches its removal release", () => {
  assert.deepEqual(retiredKitProblems(retired("0.5.0-alpha.0"), bannered, tagged), [
    "package.json: the kit was due for removal in 0.5.0 (package is 0.5.0-alpha.0): delete it",
  ])
})

test("a retired kit needs a banner, every root export tagged, and a removal release", () => {
  assert.deepEqual(retiredKitProblems(retired("0.4.1"), "# @motionscript/old\n\nBody.\n", tagged), [
    "README.md: opens with no `> **Deprecated.** …` banner",
  ])
  const untagged = `${tagged}${tag}\nexport { NODES } from "./nodes"\nexport { ${tag} A, B } from "./ab"\nexport const LIVE = 2\n`
  assert.deepEqual(retiredKitProblems(retired("0.4.1"), bannered, untagged), [
    "src/index.ts line 7: `NODES` is not @deprecated inside the braces",
    "src/index.ts line 8: `B` is not @deprecated inside the braces",
    "src/index.ts line 9: `export const LIVE = 2` is not @deprecated",
  ])
  assert.deepEqual(retiredKitProblems(retired("0.4.1", { removeIn: undefined }), bannered, tagged), [
    "package.json: motionscript.deprecated names no removeIn release",
  ])
})

test("each retired kit prints its npm deprecate command", () => {
  const dir = mkdtempSync(join(tmpdir(), "kits-"))
  try {
    for (const [kit, pkg] of [["old", retired("0.4.1")], ["live", { name: "@motionscript/live", version: "0.4.1" }]]) {
      mkdirSync(join(dir, kit, "src"), { recursive: true })
      writeFileSync(join(dir, kit, "package.json"), JSON.stringify(pkg))
      writeFileSync(join(dir, kit, "README.md"), bannered)
      writeFileSync(join(dir, kit, "src", "index.ts"), tagged)
    }
    assert.deepEqual(retiredKitCommands(dir), ['npm deprecate @motionscript/old "Retired."'])
    assert.deepEqual(checkKits(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the kits carry no overdue deprecation", () => {
  assert.deepEqual(checkKits(), [])
})
