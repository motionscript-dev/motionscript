# Why

Decisions that shaped this code, with what was ruled out. Each section is one decision; add one when a choice is not obvious from the code.

## Stay on CanvasKit (Ganesh, WebGL) and SkSL

Status: superseded by [WebGPU is the only renderer; CanvasKit, SkSL and three.js are removed](#webgpu-is-the-only-renderer-canvaskit-sksl-and-threejs-are-removed) (evaluated 2026-10-10). CanvasKit, SkSL and three.js are removed; WebGPU through the wgpu renderer is the only backend. Kept as the record of why Graphite was not pursued.

### Context

Moving the CanvasKit build to Skia Graphite on Dawn (WebGPU), and shader fills and effects to WGSL, was evaluated read-only: nothing was built or measured on this engine.

- The only public Graphite-on-CanvasKit work found is a two-commit patch repository over a Skia branch. Its authors benchmarked it themselves (CPU time of draw plus flush over many rounded rects) at 1.8x slower in Chrome and 3-4x slower in Safari, and removed the backend. Skia upstream dropped Dawn from CanvasKit in M118 and has no CanvasKit Graphite work planned.
- The renderer has no performance budget and no benchmarks, so there is no baseline to compare against.
- Graphite accepts only SkSL and transpiles it to WGSL itself. Raw WGSL would need a separate pipeline plus a cross-API copy, would lose `uniform shader` children, and would lose the Node/CPU raster path.

What a Graphite backend would break in this engine:

- `SkiaRenderContext` keeps a persistent surface from `MakeWebGLCanvasSurface`; Graphite needs a fresh surface per frame over the swapchain texture.
- `makeImageSnapshot` of the main surface mid-frame (backdrop effects) returns null on swapchain textures.
- `makeImageFromTextureSource` / `updateTextureFromSource` (images, video frames, `Canvas3D` upload in `packages/browser/src/storage-adapter.ts`) are compiled out under the WebGPU patch.
- `snapshotPixels` / `readPixels` are synchronous; Graphite readback is async only.
- Video export is already zero-readback (mediabunny `CanvasSource`), the one path that would need no new interop.

A custom Rust/wgpu rasterizer behind core's `RenderContext2D` seam was also estimated (months to a demo, 6-9 to an opt-in backend, 12+ to a default replacement; the e2e catalog would re-baseline every scene at its 0.1% changed-pixel threshold). No evidence suggests it is faster by default; the available gains are design gains (bounded offscreens, caching static layers, instancing, zero-copy video and 3D), most of which are possible inside Skia.

### Decision

Stay on CanvasKit with the Ganesh WebGL backend and keep SkSL as the shader language.

### Consequences

- The cheaper speedup to try first: three effect paths in `packages/skia-render/src/render-context.ts` (`silhouetteMask`, `blurredCopy`, `openForegroundCapture`) allocate a full-surface offscreen per effect per frame regardless of node size. Probe frame time first, then bound them.
- Do not restart this investigation.

### Revisit when

Upstream Skia ships CanvasKit Graphite, or a frame-time spike (CPU draw plus flush versus plus `gl.finish` on this engine, then a Graphite micro-scene) shows a GPU-side win.

## User shaders are WGSL; SkSL loads but does not draw

Status: accepted (2026-11-02). Supersedes the shader half of [Stay on CanvasKit (Ganesh, WebGL) and SkSL](#stay-on-canvaskit-ganesh-webgl-and-sksl); amended by [WebGPU is the only renderer; CanvasKit, SkSL and three.js are removed](#webgpu-is-the-only-renderer-canvaskit-sksl-and-threejs-are-removed), which removed SkSL from core and CanvasKit altogether.

### Context

Shader fills and shader effects were SkSL, compiled by CanvasKit. The wgpu renderer has no SkSL compiler, and there is no maintained SkSL→WGSL translator outside Skia itself. Keeping SkSL would mean shipping a translator (or CanvasKit) for the sake of one feature.

### Decision

- User shaders are written in WGSL against a small contract (`packages/renderer/DESIGN.md` §6.3): a fill defines `fn fill(in: FillIn) -> vec4f`, an effect `fn effect(in: EffectIn) -> vec4f`; uniforms are the author's `struct Params`, read as `u`; an effect reads its input with `sample_src`. The renderer validates with naga in its WASM, reflects `Params`, compiles pipelines asynchronously and never makes a frame wait.
- A shader carries `language: 'wgsl'` (packs, `shader` fills, `shader` effects); absent means WGSL. Document format 2 stamps `language: 'sksl'` on a stored SkSL shader, which is the only place that value appears.
- **SkSL keeps loading and draws nothing.** A document naming an SkSL source still parses, builds and plays, and nothing throws. An SkSL fill paints nothing and an SkSL effect is skipped (the node renders as if it had none), and the renderer reports it through `RenderContext.takeRenderIssues()`, which the playback controller turns into a render error (`buildErrors`, `onRenderError`) that a host can show and offer to convert. There is no automatic translation; an SkSL shader is rewritten by hand (the mapping is in the site's fill and shader-effect docs).

### Consequences

- The e2e shader scenes are WGSL, baselined on the wgpu renderer.
- naga adds about 0.3 MB gzip to the renderer's WASM. Moving validation into a WASM loaded on first use is possible if that ever matters.

## WebGPU is the only renderer; CanvasKit, SkSL and three.js are removed

Status: accepted (2026-11-07). Supersedes [Stay on CanvasKit (Ganesh, WebGL) and SkSL](#stay-on-canvaskit-ganesh-webgl-and-sksl) and the CanvasKit half of [User shaders are WGSL; SkSL loads but does not draw](#user-shaders-are-wgsl-sksl-loads-but-does-not-draw); amends [Core describes 3D as data; it never imports a 3D library](../../core/docs/why.md#core-describes-3d-as-data-it-never-imports-a-3d-library).

### Context

The wgpu renderer (`packages/renderer`) became the primary backend with CanvasKit (`skia-render`, `canvaskit`) kept as the fallback where WebGPU is missing, and three.js drew 3D on that fallback. Two backends meant two drawings of every feature to keep in step, and they still drew the same scene in different pixels, so the e2e suite ran two lanes with two baselines and twin scenes for the shader language each lacked. The custom CanvasKit build was a BSD-3 binary committed to the repository that nothing here could rebuild, and SkSL lived on only for it. WebGPU now ships in every browser the engine targets, and SwiftShader's adapter gives CI and servers a GPU-less one.

### Decision

- `@motionscript/canvaskit` and `@motionscript/skia-render` are deleted, and with them the three.js 3D backend and every benchmark against CanvasKit or other frameworks. `@motionscript/renderer` draws 2D and 3D (`crates/render3d` keeps three r185's conventions, `packages/renderer/docs-3d-coverage.md`).
- `@motionscript/browser` depends on the renderer and builds it in: no `renderer` option, no fallback. Where there is no WebGPU adapter every entry that draws rejects with `WebGpuUnavailableError`. The renderer imports nothing from `browser` (that would be a cycle); what it needs from the platform is handed to `createWgpuRenderer`. The export frame loop that lived in `skia-render` is `browser`'s (`src/frame-loop.ts`).
- SkSL is gone from core: `ShaderLanguage` is `"wgsl"`. Document format 2 stamps `language: "sksl"` on a stored SkSL shader (and renames the retired `sksl` effect key) so it keeps loading, keeps its source, draws nothing and is reported as a `shader` render issue asking for a WGSL port.
- `headless` always launches its page with WebGPU, on SwiftShader's adapter with `softwareRender`; e2e is the wgpu lane alone.

### Consequences

- A browser without WebGPU cannot play or export a scene. A host checks `isWgpuSupported()` and says so.
- Building the engine needs Rust and `wasm-bindgen-cli`: `pnpm build:lib` builds the renderer's WASM before `browser`.
- On Linux, anything that reads a frame back (browser tests, e2e, headless) runs headed under Xvfb, since a headless page reads a SwiftShader WebGPU canvas back empty.
- 3D that only three.js drew is skipped and reported as `missing` until the renderer implements it: glTF models and their clips, `extrude` geometry, `matcap` and GLSL `shader` materials, texture maps other than `map` and a toon `gradientMap`, and a physical material's sheen, iridescence, anisotropy and dispersion.
- The image decode-resolution ladder and the CanvasKit-specific tests went with `skia-render`; the renderer decodes at its own texture limit.
- Every package is Apache-2.0; the BSD-3 split is gone. The two npm packages stay published at their last version and are deprecated there.
