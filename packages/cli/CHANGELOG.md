# @motionscript/cli

## 0.1.0-alpha.8

## 0.1.0-alpha.7

## 0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- 1778355: `ms add` writes the same lock on Windows as everywhere else. A file's `target` in `motionscript.lock.json` is now always written with forward slashes (`src/components/gauge.ts`), so a lock committed from Windows reads the same on every machine; a lock that already holds backslashes still reads on Windows. A local registry given as a Windows path (`--registry C:\registry`) resolves an item to `C:\registry\gauge.json` instead of `C:\registry/gauge.json`, which is the `url` the lock records and the path an error names.
- da6f97a: Every package ships a `NOTICE`, and a browser build lists what it bundles.

  - Each tarball carries the repository `NOTICE`: the copyright line and the MIT attributions for the noise functions in `skia-render`'s fractal-noise fill (David Hoskins' "Hash without Sine", Inigo Quilez's 2D simplex noise).
  - `@motionscript/canvaskit` ships `THIRD_PARTY_NOTICES.txt` with the licences of the libraries compiled into the binary: FreeType, HarfBuzz, ICU 74, zlib, libpng, Brotli, WOFF2, Emscripten and musl.
  - `dist/browser/manifest.json` gains `thirdParty`, the packages the browser build bundled (`name`, `version`, `license`), and their licence and NOTICE files are written to `dist/browser/THIRD_PARTY_LICENSES.txt`. `@motionscript/browser` bundles mediabunny (MPL-2.0, unmodified; source at https://github.com/Vanilagy/mediabunny), esbuild-wasm and three; `@motionscript/math` bundles MathJax.

## 0.1.0-alpha.4

### Patch Changes

- e3b0a31: `ms add` records what it installed correctly, `ms init` reads legacy config names, and `ms --version` works.

  - Every component is recorded in `motionscript.lock.json` under the name it was requested by. A registry dependency that was a suffix of a requested item (`chart` for `line-chart`) used to be recorded under the item's key, and a namespaced dependency under its bare name with the default registry's URL.
  - A file you declined to overwrite keeps its lock record, so `ms list` still reports it modified and `ms diff` still knows it. The closing line says `Skipped` instead of `Added` for an item whose files were all kept.
  - The lock is written before the package manager runs, so a failed install leaves tracked files. A project with no `package.json`, or a malformed dependency spec, is refused before any file is written.
  - `ms init` loads whichever config name is present (`components.json`, `motion-script.json`) and names it, instead of claiming `motionscript.json` exists and failing. With `--force` it writes `motionscript.json`, which takes precedence, and leaves the old file in place.
  - `ms --version` and `ms -v` print the version instead of `Unknown command "undefined"`.

## 0.1.0-alpha.3

### Patch Changes

- 5b5dc04: `ms add` writes only inside the components folder. A registry file's `path` was joined onto `paths.components` unchecked, so an item declaring `../../../escaped.txt`, or an absolute path, wrote outside the project. Such a path is now refused with an error naming the item and the path, as is a `paths.components` outside the project, and every requested item is checked before any file is written.

## 0.1.0-alpha.2

## 0.1.0-alpha.1

## 0.1.0-alpha.0

Initial release.
