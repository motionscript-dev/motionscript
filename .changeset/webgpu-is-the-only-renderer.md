---
"@motionscript/browser": minor
"@motionscript/renderer": minor
"@motionscript/headless": minor
"@motionscript/react": patch
---

**Breaking:** WebGPU is the only renderer. CanvasKit/Skia and the three.js 3D backend are removed, and `@motionscript/canvaskit` and `@motionscript/skia-render` are no longer published.

- `@motionscript/browser` depends on `@motionscript/renderer` and draws every session, export, still and screenshot with it. Without a WebGPU adapter, `createBrowserEngine`, `createStillRenderer`, `exportVideo`, `exportVideoParallel`, `exportScreenshot` and `exportAudio` reject with the new `WebGpuUnavailableError` (check `isWgpuSupported()` first); `mixTimelineAudio` only measures text and needs no GPU.
- Removed from `@motionscript/browser`: the `renderer` option of every entry, the CanvasKit `wasmUrl` option (use `rendererWasmUrl`, where `ms_renderer_bg.wasm` is served when it is not beside the renderer's module), `getCanvasKit`, `WebRenderContext`, `WebStorageAdapter`, `WebMeasureContext`, `EffectRegistry` and the `EffectHandler`, `EffectGeometry`, `EffectResources`, `EffectTarget` and `RenderEffect` types, `Canvas3DBackend`, `canvas3DBackend`, `loadCanvas3D`, `disposeCanvas3DBackend`, the `Canvas3DAssets` and `RenderedCanvas3D` types, and the `BrowserRenderer` and `BrowserRenderContext` types. `@motionscript/canvaskit` is no longer a peer and `three` no longer a dependency. Added: `WebGpuUnavailableError`, the `RendererWasmOption` type, and re-exports of `isWgpuSupported`, `onWgpuEvent`, `ShaderPreview`, `validateShader` and `WGSL_PRELUDE` with their types.
- Removed from `@motionscript/renderer`: `pickRenderer`, `PickRendererOptions` and `PickedRenderer`. It no longer depends on `@motionscript/browser`; `createWgpuRenderer({ wasmUrl, loadBytes })` returns a `WgpuRenderer`.
- Removed from `@motionscript/headless`: the project entry's `renderer` export, the `webgpu` option (the page always has WebGPU on) and the `MS_SOFTWARE_RENDER` environment variable (pass `softwareRender: true` for SwiftShader's WebGPU adapter, and `headed: true` under `xvfb-run` on Linux). The page serves `/ms_renderer_bg.wasm` instead of `/canvaskit.wasm`.
- An undeclared font or an image the manifest does not list now draws without it and is reported as a render issue, rather than failing the still or export.
- 3D the three.js backend drew and the WebGPU renderer does not yet: glTF models (and their animation clips), `extrude` geometry, `matcap` and `shader` (GLSL) materials, the `alphaMap`, `aoMap`, `normalMap`, `roughnessMap`, `metalnessMap`, `emissionMap`, `envMap`, `lightMap` and `displacementMap` textures, and a physical material's `sheen`, `iridescence`, `anisotropy` and `dispersion`. Each is skipped and reported as a `missing` render issue.

Migration: stored documents need no change. A host drops `@motionscript/canvaskit` from its dependencies, the `renderer` and `wasmUrl` options from every call (passing `rendererWasmUrl` only when its bundler does not serve `ms_renderer_bg.wasm` beside `@motionscript/renderer`), any COOP/COEP headers it added for CanvasKit, and its CanvasKit fallback: on a browser without WebGPU it catches `WebGpuUnavailableError` (or checks `isWgpuSupported()`) and tells the user. A headless entry drops its `renderer` export, and a caller replaces `MS_SOFTWARE_RENDER=1` with `softwareRender: true`.
