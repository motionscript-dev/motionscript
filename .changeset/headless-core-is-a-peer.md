---
"@motionscript/headless": patch
---

`@motionscript/core` is now a peer dependency of `@motionscript/headless`, as it is of every other package built on it, so the project entry and the page share the one copy your project installs. Install it beside the engine (`npm install @motionscript/headless @motionscript/core`; npm 7 and later add it by themselves). `@motionscript/browser` and `@motionscript/canvaskit` stay dependencies, now with a caret range rather than the exact version they were packed with.

`renderVideo` with `softwareRender: true` (or `MS_SOFTWARE_RENDER=1`) no longer hangs on Windows. There the engine asks ANGLE for SwiftShader (`--use-angle=swiftshader`) instead of `--use-gl=swiftshader`, which left Chromium's H.264 encoder unable to finish; WebGL draws on the same SwiftShader device either way. Other platforms launch with the same flags as before.
