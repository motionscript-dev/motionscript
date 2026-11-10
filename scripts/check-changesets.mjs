/**
 * Checks every pending changeset's document-breaking marker, which hosts read
 * to know which releases need a migration of what they have stored
 * (`scripts/runbooks/release-and-ci.md`). Exits 1 when a note that says it breaks
 * something does not open with `**Breaking:**`, or when a breaking note gives
 * no `Migration:` paragraph. A note whose wording suggests a changed default,
 * unit or meaning without the marker is printed as a warning for a reviewer.
 *
 * Changed defaults and removed props of core's own types are caught for real
 * by core's `fixture-corpus.test.ts`, which diffs the vocabulary against the
 * last release's snapshot and wants each change named in a breaking note.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".changeset")
// A stable release leaves pre mode, deleting pre.json: every changeset still here is then pending.
const pre = join(dir, "pre.json")
const released = new Set(existsSync(pre) ? JSON.parse(readFileSync(pre, "utf8")).changesets ?? [] : [])
const SUSPECT = /\b(renamed|removed|is gone|are gone|no longer|now defaults?|defaults? (?:to|is|are)\b|units?\b|now means|instead of)/i

const errors = []
const warnings = []
for (const name of readdirSync(dir).sort()) {
  if (!name.endsWith(".md") || name === "README.md" || released.has(name.slice(0, -3))) continue
  const note = readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n").split(/^---$/m).slice(2).join("---").trim()
  const breaking = note.startsWith("**Breaking:**")
  if (!breaking && /\bbreaking\b/i.test(note)) {
    errors.push(`${name}: a breaking note opens with "**Breaking:**", so a host reading the changelog finds it.`)
  }
  if (breaking && !/^Migration:/m.test(note)) {
    errors.push(`${name}: a breaking note needs a "Migration:" paragraph saying how a stored document moves forward.`)
  }
  const suspect = !breaking && note.match(SUSPECT)
  if (suspect) warnings.push(`${name}: says "${suspect[0]}". If a stored document means something else now, mark it **Breaking:**.`)
}

for (const warning of warnings) console.warn(`warning: ${warning}`)
if (errors.length > 0) {
  console.error(errors.join("\n"))
  process.exit(1)
}
