---
"@motionscript/code": patch
"@motionscript/math": patch
"@motionscript/sdk": patch
"@motionscript/geography": patch
"@motionscript/charts": patch
"@motionscript/grids": patch
---

The published packages carry what a user needs and say what they are.

- `@motionscript/code` no longer ships `dist/tests/diff.bench.*`, and `@motionscript/math` no longer ships `dist/tests/harness.*` or `mathjax.setup.*`: test helpers under a `tests` folder are left out of every package's build.
- `@motionscript/sdk`'s description no longer repeats core's, and `@motionscript/math`'s names the coordinate systems, plots, 3D graphs and network graphs it has as well as formulas.
- The READMEs of `@motionscript/canvaskit`, `@motionscript/charts`, `@motionscript/geo`, `@motionscript/grids`, `@motionscript/skia-render` and `@motionscript/geography` say what to install, and `@motionscript/sdk`'s example now opens the document in an engine and plays it. Links between packages point at the repository, so they work on npm.
