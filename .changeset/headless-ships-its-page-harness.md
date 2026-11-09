---
"@motionscript/headless": patch
---

An installed `@motionscript/headless` can render. The page harness its bundle compiles (`src/page/harness.ts`) was left out of the published package, so an engine started anywhere outside this repository failed with `START_FAILED: Could not bundle the project entry`. The package now ships the harness, and the engine reads it from the same path whether it is installed or not.
