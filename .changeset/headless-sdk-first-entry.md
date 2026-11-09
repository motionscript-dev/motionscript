---
"@motionscript/headless": patch
---

A project entry whose first import is `@motionscript/sdk`, directly or through a component kit, now starts. Its page used to fail with `Class extends value undefined` and time out waiting for the bridge: honouring packages' `sideEffects: false`, esbuild left a module the lazily loaded entry shares with the engine unstarted on the engine's side (evanw/esbuild#1490), so the page bundle now ignores `sideEffects`. The bundle cache is keyed on the builder too, so a bundle cached by an earlier version is rebuilt.
