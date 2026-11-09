---
"@motionscript/sdk": minor
---

Ship a browser build in `dist/browser/`, like every other package: one ES module per export (`.`, `./component`, `./jsx-runtime`, `./jsx-dev-runtime`) and a `manifest.json` mapping each to its file. It imports `@motionscript/core` rather than bundling it, so an import map names core once and the SDK, the backend and every kit share it.

`@motionscript/core` is now a peer dependency of the SDK rather than a dependency, as it is of everything else built on core. npm and pnpm install a missing peer for you; with a package manager that does not, add `@motionscript/core` beside `@motionscript/sdk`.
