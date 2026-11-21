---
"@motionscript/renderer": patch
"@motionscript/browser": patch
---

A video the host holds no bytes for is read in ranges as its frames are asked for, instead of being downloaded whole before the first frame: `createWgpuRenderer` takes `localBytes` (the host's bytes or `null`, never the network), which `@motionscript/browser` points at its asset byte source. `isWgpuSupported` asks for an adapter once per page. Still renderers and screenshots encode `webp` as well as `png` and `jpeg`.
