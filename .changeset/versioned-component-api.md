---
"@motionscript/sdk": minor
"@motionscript/core": minor
"@motionscript/audio": minor
"@motionscript/charts": minor
"@motionscript/code": minor
"@motionscript/geography": minor
"@motionscript/grids": minor
"@motionscript/math": minor
"@motionscript/patterns": minor
---

Versioned component-API paths. `@motionscript/sdk/v1`, `@motionscript/sdk/v1/component` and each kit's `@motionscript/<kit>/v1` are the v1 API, today exactly the bare paths. A custom component imports the `/v1` paths, so a later major, which ships a v1 shim in the same engine, keeps it linking against one core. A bare import means the latest API, for npm users who follow the newest release. Each kit's `./kit` stays unstable and unversioned.

A dynamic node's `require("@motionscript/sdk/v1")` resolves to the host's `sdk`, as `@motionscript/sdk` does, and the error for an unknown specifier now names `@motionscript/sdk/v1`. `@motionscript/sdk/v1/component` and the kit paths link through `dynamicNodes.modules`, like `@motionscript/sdk/component`.
