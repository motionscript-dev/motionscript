import assert from "node:assert/strict"
import { test } from "node:test"
import { isReleaseChange, nearestAncestor } from "./ci-tested.mjs"

const pkg = (version, extra = {}) =>
  JSON.stringify({ name: "@motionscript/charts", version, peerDependencies: { "@motionscript/sdk": version, react: "^19" }, ...extra })
const reader = (base, head) => (rev) => (rev === "base" ? base : head)

test("a version bump in package.json is release bookkeeping", () => {
  assert.ok(isReleaseChange("M", "packages/components/charts/package.json", reader(pkg("0.1.0-alpha.7"), pkg("0.1.0-alpha.8"))))
})

test("a changed script or third-party range in package.json is code", () => {
  const scripts = pkg("0.1.0-alpha.8", { scripts: { test: "vitest run" } })
  assert.ok(!isReleaseChange("M", "packages/components/charts/package.json", reader(pkg("0.1.0-alpha.7"), scripts)))
  const react = pkg("0.1.0-alpha.7").replace("^19", "^20")
  assert.ok(!isReleaseChange("M", "packages/components/charts/package.json", reader(pkg("0.1.0-alpha.7"), react)))
})

test("changelogs and pre.json are bookkeeping, a new changeset is not", () => {
  assert.ok(isReleaseChange("M", "packages/core/CHANGELOG.md"))
  assert.ok(isReleaseChange("M", ".changeset/pre.json"))
  assert.ok(isReleaseChange("D", ".changeset/brave-owls-sing.md"))
  assert.ok(!isReleaseChange("A", ".changeset/brave-owls-sing.md"))
  assert.ok(!isReleaseChange("M", ".changeset/config.json"))
})

test("only an added fixture snapshot is bookkeeping", () => {
  assert.ok(isReleaseChange("A", "packages/core/test/fixtures/documents/0.1.0-alpha.8/rect.json"))
  assert.ok(!isReleaseChange("M", "packages/core/test/fixtures/documents/0.1.0-alpha.7/rect.json"))
  assert.ok(!isReleaseChange("M", "packages/core/src/index.ts"))
})

test("the nearest passing ancestor wins; non-ancestors are ignored", () => {
  const ancestors = { a: 3, b: 1, c: 7 }
  const pick = nearestAncestor(["c", "x", "a", "b", "b"], (sha) => sha in ancestors, (sha) => ancestors[sha])
  assert.equal(pick, "b")
  assert.equal(nearestAncestor(["x"], () => false, () => 0), null)
})
