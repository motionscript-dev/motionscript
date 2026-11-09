---
"@motionscript/renderer": minor
---

`@motionscript/renderer`, the WebGPU renderer (a Rust/wgpu renderer compiled to WebAssembly) that `@motionscript/browser` draws with, is published. The package ships `dist/browser/` (the CDN build, with `ms_renderer_bg.wasm` under `motionscriptBrowser.assets`) beside `dist/`. `createWgpuRenderer()` is what `@motionscript/browser` builds its engine on; `isWgpuSupported()` says whether the browser has a WebGPU adapter; `validateShader`, `ShaderPreview` and `WGSL_PRELUDE` serve a WGSL shader editor (all four also exported by `@motionscript/browser`). `@motionscript/core` is a peer dependency. The package ships `THIRD_PARTY_NOTICES.txt` for the Rust crates compiled into the WebAssembly.
