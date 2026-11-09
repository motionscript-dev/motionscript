---
"@motionscript/core": patch
"@motionscript/browser": patch
"@motionscript/react": patch
"@motionscript/headless": patch
"@motionscript/cli": patch
"@motionscript/sdk": patch
"@motionscript/audio": patch
"@motionscript/charts": patch
"@motionscript/code": patch
"@motionscript/geography": patch
"@motionscript/grids": patch
"@motionscript/math": patch
"@motionscript/patterns": patch
---

Every package ships a `NOTICE`, and a browser build lists what it bundles.

- Each tarball carries the repository `NOTICE`: the copyright line and the MIT attributions for the noise functions in `skia-render`'s fractal-noise fill (David Hoskins' "Hash without Sine", Inigo Quilez's 2D simplex noise).
- `@motionscript/canvaskit` ships `THIRD_PARTY_NOTICES.txt` with the licences of the libraries compiled into the binary: FreeType, HarfBuzz, ICU 74, zlib, libpng, Brotli, WOFF2, Emscripten and musl.
- `dist/browser/manifest.json` gains `thirdParty`, the packages the browser build bundled (`name`, `version`, `license`), and their licence and NOTICE files are written to `dist/browser/THIRD_PARTY_LICENSES.txt`. `@motionscript/browser` bundles mediabunny (MPL-2.0, unmodified; source at https://github.com/Vanilagy/mediabunny), esbuild-wasm and three; `@motionscript/math` bundles MathJax.
