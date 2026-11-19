---
"@motionscript/audio": minor
"@motionscript/charts": minor
"@motionscript/code": minor
"@motionscript/geography": minor
"@motionscript/grids": minor
"@motionscript/math": minor
"@motionscript/patterns": minor
---

**Breaking:** each kit's root export is now its public surface, named one by one, and everything else moves to `./kit`, which every kit now has and which any release may change.

- **The roots** carry the components and `NODES`, plus only what a host's setup or an author's code needs: audio's `AudioEnvelope` and `EMPTY_ENVELOPE`; charts' `CHART_STYLE_PRESETS` and `ChartStylePreset`; code's `defineCode`, `CodeStrategies`, `lines`, `word`, `CodeRanges`, `CodeRange`, `registerCodeTheme`, `initSyntaxHighlighter` and the theme types; geography's `geoRegistry`, `geoUrlSource`, `geoLoaderSource`, `GeoSource`, `GeoDefinition` and `GeoShape`; math's `loadMathJax`. A root name now leaves only after a deprecation, in the next major (the next minor while on 0.x).
- **`./kit`** (`src/unstable.ts`) is all of each package: every name the root exported before, the shared helpers a copied component imports, and each component's parts. `code/kit` and `geography/kit` are new; the others now hold the component modules as well as the shared helpers.
- **Copied components** (`registry.json`) import the kit from `<package>/kit` instead of the package root.

Migration: no stored document is affected; node keys, props and values are unchanged. Code that imported a helper, a part or a type from a kit's root imports it from `<package>/kit` instead (for example `resolveXScale` from `@motionscript/charts/kit`, `canHighlight` from `@motionscript/code/kit`). A copied component made before this release that imports helpers from the package root changes that specifier to `<package>/kit`.
