# Build orchestration

How packages build, in what order, and the config rules that keep `dist/` correct.
Read it before changing a package's `package.json` scripts, a `tsconfig*.json`, or
adding a package. The task graph is `turbo.json`; the workspace is
`pnpm-workspace.yaml` (members are listed one per line, nothing is globbed); the
shared compiler options are `tsconfig.base.json`.

## Model

**Turbo owns build ordering, not TypeScript.** A package builds with plain
`tsc -p tsconfig.build.json`, which compiles only that package and reads its
dependencies' already-built `dist/*.d.ts`. Turbo guarantees those exist through
`dependsOn: ["^build"]`.

| Turbo task | `dependsOn` | Notes |
| --- | --- | --- |
| `build` | `^build` | Outputs `dist/**`, `.next/**` (minus `.next/cache/**`), `build/**`, `public/**` |
| `typecheck` | `^build` | No outputs; only logs are cached |
| `lint` | `^build` | No outputs; only logs are cached |
| `dev` | none | Persistent, never cached |
| `clean` | none | Never cached |

`test` is not a Turbo task: `pnpm test` is `pnpm -r test`, which waits on no build
and caches nothing. Tests that import a dependency's built `dist/` (`browser`, the
kits, core's `sdk-parity.test.ts`) need `pnpm build:lib` first on a fresh checkout.

| Root script | Runs |
| --- | --- |
| `pnpm build` | `turbo run build`, every workspace with a `build` script, docs site and apps included |
| `pnpm build:lib` | `turbo run build --filter="!./apps/*" --force`: every workspace except the docs site and the three apps, never from cache. It builds `@motionscript/renderer` (Rust to WASM) before `browser`, so it needs Rust |
| `pnpm build:renderer` | `turbo run build --filter=@motionscript/renderer`: the renderer alone |
| `pnpm lint` | `turbo run lint` |
| `pnpm typecheck` | `turbo run typecheck` |
| `pnpm clean` | `turbo run clean && rimraf .turbo` |

There is no root `dev`. Run a package's `dev` from its folder or with
`pnpm --filter <name> dev`. `build:lib` carries `--force` so that the release and
CI builds never publish or test a cached `dist/`.

## Invariants and traps

- **Never `tsc -b` in a build.** Build mode walks `references` and rebuilds the
  dependencies itself, racing Turbo's own dependency builds and corrupting `dist/`
  on a clean build. The one allowed use is a `typecheck` that emits nothing:
  `packages/react` runs `tsc -b --noEmit` because its config is a Vite solution
  file (`tsconfig.json` references `tsconfig.app.json` and `tsconfig.node.json`).
- **Two tsconfigs per package.** `tsconfig.json` is test-inclusive and is what
  the editor, `typecheck` and the eslint import resolver read. `tsconfig.build.json`
  extends it and excludes tests; `build` and a dependent's `references` point at it.
- **Test-inclusive is a property of `include`, not of where files sit.** Most
  packages co-locate tests under `src`, so `src/**/*` covers them by accident.
  `browser` keeps a sibling `test/`, so it lists `test/**/*` in `include`, excludes
  it again in `tsconfig.build.json`, and moves `rootDir: "src"` into the build
  config (`--noEmit` needs no output layout). A directory in no tsconfig is
  type-checked by nothing at all.
- **`references` are for the editor only**, and name the dependency's
  `tsconfig.build.json` (`{ "path": "../core/tsconfig.build.json" }`), never the
  bare directory, which resolves to the test-inclusive config and diverges from
  what is built. Kits reference the SDK's build config, and core's where their
  tests import it.
- **`tsBuildInfoFile` is `dist/tsconfig.build.tsbuildinfo`** in every
  `tsconfig.build.json` except `react`'s, which is declaration-only. That puts it
  under Turbo's `dist/**` output cache, so `dist` is never restored without its
  build info (stale declarations otherwise). Each `files` list excludes
  `!dist/**/*.tsbuildinfo` from the tarball.
- **Gates read built output.** `lint` and `typecheck` resolve dependencies through
  `dist/*.d.ts`, so they run after `build:lib`. Every workspace peer (core, the SDK)
  is also a `workspace:*` devDependency of the package that
  peers on it; a new package keeps that pairing rather than relying on a peer
  alone to order its build.
- **`typecheck` is `tsc -p tsconfig.json --noEmit`.** `headless` runs a second
  program for browser code, `tsc -p tsconfig.page.json` (DOM lib, no Node types,
  `include` `src/page/**/*` and `src/page-bridge.ts`), and excludes `src/page/**`
  from its Node build.
- **Adding a package** means adding it to `pnpm-workspace.yaml` and, if it
  publishes, to the `fixed` group in `.changeset/config.json`
  ([release and CI](./release-and-ci.md)).

## Script shapes

`clean` is `rimraf --glob dist .turbo *.tsbuildinfo` wherever it exists. `build` is
`tsc -p tsconfig.build.json` then `tsc-alias -p tsconfig.build.json`, which rewrites
the `@/*` paths to relative imports (`--resolve-full-paths` in `core` and the kits
also writes `.js` extensions). Variations: `core`, `sdk`, `browser` and `react` start
with `eslint .`, so a lint error stops their build;
`react` adds `vite build` after declaration-only `tsc`; `headless` is `tsc -p` alone
(NodeNext, explicit `.js` extensions, no `@/` alias); `renderer` is
`scripts/build-wasm.sh` (cargo and wasm-bindgen), `vite build` of its engine entry
and the CDN build.

## The CDN build

`scripts/build-browser.mjs <package dir>` (the directory defaults to the working
directory; packages call it as `../../scripts/build-browser.mjs`, kits as
`../../../scripts/build-browser.mjs`) writes `dist/browser/`, which it wipes
first. It bundles one minified ES2022 module per `exports` entry whose target is a
`.js`, `.mjs` or `.cjs` file (wildcards and `./package.json` are skipped; a
package with no such entry fails), splits shared code into `chunks/`, and leaves
each `peerDependencies` name (and its subpaths) and every Node built-in as an
import, so a host's import map names each peer once. An entry is named `index` for
`.`, otherwise its subpath with `/` as `-`.

`dist/browser/manifest.json` holds `name`, `version`, `exports` (subpath to a
package-relative file), `peers`, `assets` and `thirdParty` (each non-`@motionscript`
package esbuild bundled in, as `name`, `version`, `license`). Their licence and
NOTICE files go to `dist/browser/THIRD_PARTY_LICENSES.txt`, written only when the
list is not empty, since a copy that bundles them must carry them. A binary listed under the package's
`motionscriptBrowser.assets` (`ms_renderer_bg.wasm`, `esbuild.wasm`) is recorded in
place when it sits inside the package, otherwise copied into `dist/browser/`. The
repo ships no import-map generator: a host composes its map from the manifests.

Packages that run it: `core`, `sdk`, `renderer`, `browser`, `react` and the seven
kits. `browser` bundles the renderer (a dependency, not a peer) and copies its WASM. `dist/`, `dist/browser/`, `.turbo/` and `*.tsbuildinfo` are generated and
gitignored.
