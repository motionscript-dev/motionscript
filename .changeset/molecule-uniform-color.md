---
"@motionscript/core": patch
"@motionscript/sdk": patch
---

`colorOps` is now exported from `@motionscript/sdk`, and it gains `hex(value)`, which writes any `Color` as `#rrggbb`, or as `#rrggbbaa` when it is not opaque.
