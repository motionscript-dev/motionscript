# @motionscript/renderer

A retained-mode 2D/3D renderer in Rust on wgpu/WebGPU, compiled to
WebAssembly: the renderer `@motionscript/browser` draws every frame with.
Hosts use browser's `createBrowserEngine()`, which builds this package in; it
depends on nothing but `@motionscript/core` (a peer) and mediabunny.
Apache-2.0; the Rust crates compiled into the WASM are listed with their
licences in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

Read [DESIGN.md](DESIGN.md) for the design and how each part was built.

## Requirements

- Rust through rustup: [rust-toolchain.toml](rust-toolchain.toml) pins the
  toolchain and the `wasm32-unknown-unknown` target, which rustup installs on
  first use. `wasm-bindgen-cli` must be the exact version of the
  `wasm-bindgen` crate in `Cargo.lock` (`0.2.130`); the build scripts refuse
  any other:
  ```bash
  cargo install wasm-bindgen-cli --version 0.2.130 --locked
  ```
- To regenerate the licence notices, `cargo-about` 0.9.3:
  `cargo install cargo-about --version 0.9.3 --features cli --locked`.
- Node 24 and pnpm.
- A browser with WebGPU (Chrome/Edge, recent Safari).

## In the workspace pipelines

`pnpm build` here builds the WASM (`--locked`, with remapped build paths),
then `dist/`, then `dist/browser/` with the engine's
`scripts/build-browser.mjs`; turbo runs it before `@motionscript/browser`'s
build. `prepack` refuses to pack a package without its `dist/`.

`dist/browser/index.js` is the CDN build: `@motionscript/core` stays an import
(the host's import map names it), the rest is bundled. Its `manifest.json`
lists the WASM under `assets["ms_renderer_bg.wasm"]` (from
`motionscriptBrowser.assets` in `package.json`): `dist/ms_renderer_bg.wasm`.
The module's default `wasmUrl` (beside itself) does not hold there, so a host
loading the CDN build passes that asset's URL as `wasmUrl`.

The root `pnpm lint` and `pnpm typecheck` include it without Rust: the
`.d.ts` files wasm-bindgen generates (`web/pkg/ms_renderer.d.ts`,
`web/pkg-text/ms_text.d.ts`, `web/pkg-r3d/ms_render3d.d.ts`) are committed,
and a WASM build rewrites them; commit the change when the Rust API moves.

CI's `renderer` job (`.github/workflows/ci.yml`) installs the pinned
toolchain and runs `cargo test --locked --workspace` (with
`crates/renderer/tests/wgsl_modules.rs`, which runs every WGSL module the
renderer ships through naga's validation), `pnpm notices:check`, the three
WASM builds, a check that the committed `.d.ts` files are current, lint,
typecheck, and the e2e wgpu lane (`packages/e2e`, `pnpm test:wgpu`: scenes
drawn by this renderer on SwiftShader's WebGPU adapter, diffed against
committed frames).

`pnpm notices` regenerates [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)
with cargo-about ([about.toml](about.toml) lists the accepted licences, so a
crate under any other fails it); run it whenever `Cargo.lock` changes.

## The entry

`src/engine` (in `web/src/engine/`) is what `@motionscript/browser` builds in.
`createWgpuRenderer({ wasmUrl, loadBytes })` loads the WASM and returns a
`WgpuRenderer`: `createStorageAdapter`, `createRenderContext` and
`createMeasureContext` for a session, its exports and stills.
`isWgpuSupported()` says whether the browser has a WebGPU adapter; there is no
other backend to fall back to.

`wasmUrl` is where `@motionscript/renderer/ms_renderer_bg.wasm` is served. It
defaults to beside the module.

- `WgpuStorageAdapter` decodes images to `ImageBitmap`s, video frames with
  mediabunny, and hands font bytes to ms-text. Bytes come through
  `loadBytes` (a plain `fetch` by default), which a platform points at its own
  asset store.
- `WgpuSurfaceContext` is the adapter's render context mounted on a canvas,
  with the preview knobs a host sets (`pixelRatio`, `view`, `frame`,
  `clipToFrame`, `frameBackground`). Mounting is asynchronous (WebGPU device
  creation); frames recorded before it finishes are drawn when it does. The
  canvas composites premultiplied, so a transparent frame background shows the
  page behind it. What the adapter can't draw yet is logged once per kind
  (`[wgpu] not drawn yet: …`) and returned by `takeRenderIssues()` as a
  `missing` issue per kind and node (a blend mode it lacks, text on a path,
  `rasterize()`, nested or projective booleans, an off-centre motion-blur
  shutter, an effect with no WGSL port, a 3D feature it doesn't draw), beside
  `shader` issues (WGSL that does not compile, a stored SkSL shader) and
  `params` issues (a uniform that names no `Params` member, a member given no
  value). A session lists them in `buildErrors`; an export hands them to
  `onIssue`.
- `measureText` and `layoutTextBlock` are ms-text (`MsText`, exported from
  the same WASM), so measurement, carets and drawing agree.

### GPU faults

Every surface on the page shares one device, so a fault is everyone's.
`onWgpuEvent(listener)` hears each one (`web/src/engine/faults.ts`):

- **`device-lost`** (a driver reset, the GPU process restarting,
  `device.destroy()`): the device and its pipelines are forgotten and every
  live surface is mounted again on a new one, which rebuilds pipelines, fonts
  and user-shader programs and draws the last frame; `device-restored` follows.
  Each surface queues a `device-lost` render issue, which fails an export or
  still under way with a `RenderBackendError` (`retryable: true`) rather than
  encoding frames drawn on the dead device. A frame drawn while a surface
  remounts waits for it, as for a compiling shader. Four losses within a
  minute stop the recovery (`crashed`).
- **`gpu-error`**: a WebGPU validation, out-of-memory or internal error the
  device raised (its `uncapturederror`), also a `gpu` render issue on every
  surface. The first 32 per page are reported.
- **`crashed`**: the renderer's WASM panicked (it is built `panic = "abort"`;
  unwinding on wasm32 needs a nightly std, and the hook that reports the panic
  costs nothing measurable in size). The instance is not called again: every
  surface draws nothing more, gets a `crashed` issue, and an export fails
  with a `RenderBackendError` that is not retryable. A reload recovers.

A user shader can't hang the device: its loops share a budget of 16,384
iterations per pixel and a compile that takes over 10 s fails
([DESIGN.md §6.3](DESIGN.md#63-user-shaders-wgsl-built-2026-11-02)).

### User shaders (WGSL)

Shader fills and shader effects are WGSL, written against the contract in
[DESIGN.md §6.3](DESIGN.md#63-user-shaders-wgsl-built-2026-11-02). A session
validates each new source with naga, compiles its pipelines in the background
and draws it once they are ready (an export, and any settled frame, waits). A
document stored with an SkSL shader (`language: "sksl"`) draws nothing there
and gets a `shader` render issue saying to port it to WGSL. For a shader
editor the package also exports:

- `validateShader(scope, source)`: naga's diagnostics (line and column in the
  author's code) and the reflected `struct Params` members.
- `ShaderPreview`: a fill or an effect drawn on its own canvas over a test
  pattern or an image (`frame`, `split`, `backdrop`), with the browser's
  `getCompilationInfo()` messages in its status and `snapshot()` for
  thumbnails. It redraws by itself when a program finishes compiling.
- `WGSL_PRELUDE`: what the renderer puts in front of the author's code, to show
  beside the editor.

`node scripts/validate-wgsl.mjs fill|effect <files>` runs the same validation
in Node (after `pnpm build:wasm`), and `pnpm dev` serves `web/shaders.html`,
a page that drives the preview (http://localhost:5190/shaders.html).

### Built-in effects

Each built-in effect is a port (`web/src/effects/<type>.ts`, a `definePort`
naming its parameters against core's effect spec) and a pass
(`crates/renderer/src/effects/<type>.wgsl`) that reads them through generated
accessors (`gen/<type>.wgsl`). `pnpm effects:gen` regenerates those after a
port changes; `pnpm test:effects` checks that they are current and that the
spec, the port and the pass agree by name. How to add one:
[docs-effects-porting.md](docs-effects-porting.md).

## Text

`ms-text` (`crates/text`) shapes, lays out and measures text and builds glyph
outlines. `cargo test -p ms-text` checks its layout, measurement and outlines
against the recorded reference numbers in `crates/text/tests/oracle.json`
(needs the e2e fonts, `../e2e/fonts` or `MS_FONTS_DIR`). See
[DESIGN.md §5](DESIGN.md#5-phase-2--text-images-video).

## Layout

See the repo map at the end of [DESIGN.md](DESIGN.md#9-repo-map).
