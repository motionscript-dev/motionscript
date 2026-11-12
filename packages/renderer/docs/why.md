# Why

Decisions that shaped this code, with what was ruled out. Each section is one decision; add one when a choice is not obvious from the code.

## A host process can replay the renderer's call stream natively

Status: experimental (2026-11-11)

### Context

A desktop host's exports encode through WebCodecs behind the browser's one GPU process. One window managed about 200 fps at 1080p, and more windows were slower. The renderer is Rust, so it can also draw natively, in a process whose encoder the host controls.

### Decision

The page keeps running the frame loop, the adapter and the backend. Only the WASM `Renderer` is swapped for a recorder (`web/src/native/`), and `exportVideoNative` streams the delta protocol and the resource calls to a host transport. On the other side, `ms-renderer` built with `native` replays the stream into the same scene code on a native wgpu device (`src/replay.rs` over `src/native.rs`) and hands back only begin, frame, audio and end. Rendering each frame into its own target, converting and encoding it are the host's, so the engine names no encoder. Serialising the adapter's `Doc` was ruled out: it resends every node every frame, and its decoder would be a second one. So was running the engine outside the page: it would need DOM-free decode, fonts and node compilation.

### Consequences

- The native renderer draws 1080p (from 2× supersampled 4K) at 1,450–1,800 fps, and the result matches the WebCodecs file at 46–49 dB PSNR on the e2e scenes: the host's encoder sets the export's speed.
- The stream format lives in two places, `recorder.ts` and `replay.rs`; `replay.rs`'s tests read `recorder.ts` and fail when the op numbers or the version drift apart.
- `ms-renderer` builds natively only under `native`, which picks no wgpu backend: the host enables the ones it runs on. The WASM build is unchanged.

## Plain rects and ellipses draw as the renderer's own shapes

Status: accepted (2026-11-10)

### Context

The adapter turned every shape into a path. A scene drawing many small moving rects or ellipses then defined a new path for each one, every frame, and the renderer took each one in.

On 10,000 ellipses a frame (1080p, a desktop GPU) that was about 87 ms of CPU, almost all of it in the adapter and the path upload. The renderer already draws rects, rounded rects and ellipses itself, as SDF primitives (`DESIGN.md` §4.2), but the adapter never used them.

### Decision

A rect or ellipse the primitive draws exactly is sent as a rect or ellipse node (`ShapeOut.native`, `fillNative` and `strokeNative` in `web/src/adapter/context.ts`). That means:
- an unturned, unscaled, untrimmed rect, with rounded or square corners within half its shorter side;
- or a whole ellipse;
- its only paint solid;
- no shadow on a fill, and no dash on a stroke.

A stroke only goes native round a rect (a square corner needs a miter join) or a circle. An ellipse's offset outline is not an ellipse. Everything else stays a path, as before.

### Consequences

- The same scene takes about 35 ms of CPU, and the adapter's share drops from ~86 to ~31 ms.
- Edge pixels change: the primitive's coverage is analytic, the path's is its flattened outline. In the e2e catalog:
  - 46 of 108 frames move;
  - at most 0.83% of a frame's pixels, by at most 50 levels;
  - interiors and axis-aligned edges are unchanged;
  - nothing visible at 5–8× zoom;
  - the lane passes within its thresholds, so its baselines were not re-recorded.
- Small shapes move most: on 2–5 px dots nearly every pixel is an edge, and about 7.5% of such a frame changes by ~13 levels on average.
- Widening the native route (gradients and images need their paint moved into the node's box; shadows have the renderer's closed-form rrect shadow) changes more edges, and needs the same comparison: exact per-pixel, against the path route, not the e2e lane's tolerance.

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

## 3D depth is reversed Z, with an infinite derived far plane

Status: accepted (2026-11-12).

### Context

Thin parts a hair apart (a plate lifted 0.002, lettering 0.004 above a token, beams just inside a slab) striped through each other in the templates. The 3D pass used `Depth32Float` with standard Z: float depth is densest near 0, standard Z puts the near plane there, and a bounds-derived near of `reach/1000` left steps of about `distance² × 6e-8 / near`, roughly 1e-3 units at 20 units away. `polygonOffset`, the documented way to separate coplanar surfaces, was dropped by the encoder.

### Decision

- The camera projection is reversed (near at 1, far at 0, `GreaterEqual`, depth cleared to 0). A perspective camera whose `far` is derived from the scene bounds gets an infinite far plane, since a finite one costs another ~10x of precision at `reach·10`; an authored `far` still clips.
- `polygonOffset` reaches the pipeline as depth bias, negated for reversed Z.
- Shadow maps keep standard Z; they have their own bias rules (three's).
- Not taken: a logarithmic depth buffer (writes `frag_depth`, losing early depth rejection) or a tighter derived near (it only helps standard Z and clips close cameras).

### Consequences

- At 20 units, surfaces 0.001 apart resolve; truly coplanar overlaps still fight and are an authoring error (`core/docs/3d.md`).
- `Mat.depth()` reads the fragment's own z, which equals three's `1 - gl_FragCoord.z`.
- The scene stream is version 4; the decoder reads no older stream.
