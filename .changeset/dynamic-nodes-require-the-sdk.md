---
"@motionscript/core": minor
---

A node compiled from source requires the SDK by its published name: `require("@motionscript/sdk")` resolves to `DynamicNodeConfig.sdk`, and `require("@motionscript/sdk/jsx-runtime")` to `jsxRuntime`. The earlier unscoped `motionscript` and `motion-script` specifiers resolve to the same objects, so a script written under either still compiles, and the error for an unknown specifier now names `@motionscript/sdk`.
