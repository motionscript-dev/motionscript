---
"@motionscript/browser": minor
"@motionscript/core": minor
"@motionscript/headless": minor
---

A source-string node default-exports a component, and is written with calls.

- `Registry.addNodeFromSource`, `engine.registerNode(source)` and a string in `nodes` (browser and headless) take a script whose default export is a component (`export default component2d({ key: "…", … })`), not a class decorated with `@node(...)`.
- `DynamicNodeConfig.jsxRuntime` is gone, and browser's default compiler reads TypeScript without JSX or decorators: a script with JSX fails to compile, and one that requires `@motionscript/sdk/jsx-runtime` fails to link. The CDN build no longer imports `@motionscript/core/jsx/jsx-runtime`, so an import map need not name it.
