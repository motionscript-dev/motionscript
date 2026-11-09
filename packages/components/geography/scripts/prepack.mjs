/**
 * Runs before `pack` and `publish`. `data/` is gitignored, so a fresh checkout
 * (the release job's) has none: it is generated here from the sources
 * `sources.lock.json` pins, which `generate` downloads unless `.cache/` already
 * holds them and refuses on a checksum mismatch. Verified either way.
 */
import { execFileSync, execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..")

if (!existsSync(join(packageDir, "data"))) {
  // The `generate` script itself, so its heap flag is stated once.
  const { scripts } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
  console.log("data/ is missing; generating it from the locked sources")
  execSync(scripts.generate, { cwd: packageDir, stdio: "inherit" })
}
execFileSync(process.execPath, [join(packageDir, "scripts", "verify.mjs")], { cwd: packageDir, stdio: "inherit" })
