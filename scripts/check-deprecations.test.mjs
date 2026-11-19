import assert from "node:assert/strict"
import { test } from "node:test"
import { checkKits, compareRelease, deprecationProblems } from "./check-deprecations.mjs"

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

test("the kits carry no overdue deprecation", () => {
  assert.deepEqual(checkKits(), [])
})
