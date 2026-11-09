---
"@motionscript/audio": minor
"@motionscript/charts": minor
"@motionscript/code": minor
"@motionscript/geography": minor
"@motionscript/math": minor
"@motionscript/grids": minor
---

Build on `@motionscript/sdk` instead of `@motionscript/core`. The peer dependency is now `@motionscript/sdk`, every import goes through it (and `@motionscript/sdk/component` for the component machinery), and the browser build leaves `@motionscript/sdk` an import, so an import map names it once. A component copied with `ms add` imports the SDK too, and its registry item depends on `@motionscript/sdk` rather than `@motionscript/core`. `@motionscript/charts/kit` re-exports `@motionscript/sdk/component` where it re-exported `@motionscript/core/component`.
