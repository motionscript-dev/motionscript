// Fails when a committed wasm-bindgen .d.ts differs from the one just built.
// Closure export names carry rustc crate hashes, which differ between build
// hosts (a Windows build never matches a Linux one), so those are masked first.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const git = (...args) => execFileSync("git", args, { encoding: "utf8" })
const mask = (text) => text.replace(/\r\n/g, "\n").replace(/_[0-9a-f]{12,16}(?![0-9a-z])/g, "_#")

const files = git("ls-files", "web/pkg*/*.d.ts").split("\n").filter(Boolean)
if (files.length === 0) throw new Error("no committed web/pkg*/*.d.ts found; run this from packages/renderer")
const stale = files.filter((file) => mask(git("show", `HEAD:./${file}`)) !== mask(readFileSync(file, "utf8")))

for (const file of stale) console.error(`::error file=packages/renderer/${file}::${file} is not what wasm-bindgen generates; build the WASM and commit it.`)
if (stale.length) process.exit(1)
console.log(`${files.length} committed declarations match the build (crate hashes aside).`)
