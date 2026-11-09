# @motionscript/browser

The browser platform for [Motion Script](https://motionscript.dev): it draws
every frame with WebGPU through [`@motionscript/renderer`](https://github.com/motionscript-dev/motionscript/tree/main/packages/renderer), which it
builds in. It implements the
`platform`/`render` abstractions from [`@motionscript/core`](https://github.com/motionscript-dev/motionscript/tree/main/packages/core) so
documents can be drawn to a canvas, played back with synchronized audio, and
exported to video all in the browser.

How a frame is drawn (shapes, fills, strokes, effects, text, 3D) lives in the
renderer (Rust/wgpu compiled to WebAssembly). This package supplies the browser's
half: the export frame loop, encoding, Web Audio, the clock and the entry points.
A browser without WebGPU cannot draw: every entry that draws rejects with
`WebGpuUnavailableError` (check `isWgpuSupported()` first to say so up front).

## What's in here

- **Engine**: `createBrowserEngine` wires every platform seam below into a
  `@motionscript/core` `Engine`. Await it once at app start and share it.
- **Exporter**: `exportVideo` renders a document offline and muxes video and
  audio into an MP4 (H.264 + AAC, the default) or a WebM (VP9 + Opus) using
  [mediabunny](https://github.com/Vanilagy/mediabunny). `exportAudio` writes the
  timeline's mixed audio alone as WAV (the default), MP3 or M4A without rendering
  a frame, and throws `NoAudioError` when nothing plays. `EXPORT_FORMATS` gives
  each format's kind, extension and MIME type. MP3 loads a WASM build of LAME on
  first use, in a worker started from a `blob:` URL, so a host's CSP needs
  `worker-src blob:` for it.
- **Stills**: `StillRenderer` (from `createStillRenderer`) is a long-lived
  renderer that repaints single frames into a canvas the host owns, for
  thumbnails and previews; `exportScreenshot` is the one-shot wrapper over it.
- **Concat**: `concatVideoSegments` joins separately encoded MP4 (or WebM)
  segments into one file of the same container without re-encoding, so an export can be split across workers. A segment is
  `exportVideo({ frames: { start, end } })` (or `session.export({ frames })`):
  that range alone, timestamped from 0 and silent.
  `mixTimelineAudio` mixes the whole timeline's audio once for the joined file.
  Every segment must share one encoder configuration; a mismatch throws
  `ConcatMismatchError`.
- **Parallel export**: `exportVideoParallel` takes `exportVideo`'s parameters
  plus `lanes`, the renderers to spread the frames over: `localLane()` for
  this page, and `messagePortLane(port)` for another realm (a second window or
  process) that answers with `serveExportLane(port, resolve)`. It cuts the
  timeline into key-frame-aligned frame ranges of the whole project, starts on
  the first lane alone and admits the next only while that raises throughput
  (every lane's encoder shares the browser's one GPU process, so light scenes
  gain nothing from a second lane), mixes the audio once while the frames
  render, joins each range as soon as the ones before it are done (into
  `stream` when given) and reports progress by frames drawn.
  `createSegmentJoiner` is the incremental join underneath.
- **Audio**: `WebAudioPlayer` drives playback through the Web Audio API;
  `mixAudio` and `encodeWav` (also on the `@motionscript/browser/audio`
  subpath, which skips the renderer) mix down offline.
- **Assets**: `setAssetByteSource` lets a host answer for an asset's bytes (a file
  the user just chose, say) before the renderer's storage goes to the network; it
  applies to previews, exports and stills alike. `loadAssetBytes` reads through it.
- **Source-string nodes**: `createBrowserEngine({ nodes })` also accepts TS source
  strings (array form only), each default-exporting a component (`component2d({ key })`),
  compiled with `esbuild-wasm` on first use. A script is written with calls: JSX
  neither compiles nor links. `dynamicNodes` overrides the SDK, extra importable
  `modules` or the compiler, each field defaulting on its own.
- **Clock**: `WebTicker` synchronizes scene playback to `requestAnimationFrame` while calculating dt from audio context to ensure audio and animation line up.
- **Renderer**: `isWgpuSupported`, `onWgpuEvent` (device loss and recovery), and
  the WGSL shader tools `ShaderPreview`, `validateShader` and `WGSL_PRELUDE`, from
  `@motionscript/renderer`.

## Usage

```bash
npm install @motionscript/browser @motionscript/core
```

```ts
import { createBrowserEngine } from '@motionscript/browser';

const engine = await createBrowserEngine({ nodes: [MyNode] });
const session = engine.open({ document, target: canvasEl });
session.playback!.play();

const mp4 = await session.export();
```

The renderer's `ms_renderer_bg.wasm` resolves beside its module, which a bundler
handles; elsewhere serve it and pass its URL as `rendererWasmUrl` (every entry
that draws takes it). `session.export()` resolves to the MP4 bytes unless
`encode: { download: true }` asks for a browser download; `encode: { format }`
picks another format (`'webm'`, or `'wav'`, `'mp3'` or `'m4a'` for audio alone).

## Render issues and GPU faults

What the renderer drew but not as the document says (a feature it lacks, a shader
that does not compile, a lost GPU device) is a typed `RenderIssue`: a session
lists it in `buildErrors`, and `exportVideo`, `exportVideoParallel`,
`session.export()`, `session.image()` and `StillRenderer.render` hand it to
`onIssue`. A lost device or a crashed backend fails those instead with a
`RenderBackendError` (from `@motionscript/core`; `retryable` when the backend
recovered on a new device).

A shader stored in the retired SkSL language (`language: "sksl"`, from documents
written before WGSL was the only one) draws nothing and is reported as a `shader`
issue asking for a WGSL port.

## CDN build

`pnpm build` ends by writing `dist/browser/` (generated, never edited): one minified
ES module per `exports` entry (`index.js`, `audio.js`), shared and lazy chunks, `esbuild.wasm`, `ms_renderer_bg.wasm`, and a
`manifest.json` mapping each export and binary asset to a package-relative path.
The renderer is bundled in; the peers stay imports, so a host's import map names each
of these bare specifiers once, to one copy:

```
@motionscript/core
@motionscript/core/sdk
```

Against a CDN module URL the default `ms_renderer_bg.wasm` and `esbuild.wasm` URLs do
not resolve, so a host passes `rendererWasmUrl` and, if it compiles source-string nodes,
`compilerWasmUrl`. Both binaries are listed in the packages' manifests.

See the [docs](https://motionscript.dev/docs) for the full feature set and API
reference.

## Development

From the monorepo root:

```bash
pnpm --filter @motionscript/browser build   # eslint, tsc, tsc-alias, then the CDN build
pnpm --filter @motionscript/browser test    # vitest: real Chromium, plus a Node project
```

The tests run in Chromium on SwiftShader's WebGPU adapter through
`@vitest/browser-playwright` (headed with `HEADED=1`, which Linux needs, under
`xvfb-run`: a headless page there reads a WebGPU canvas back empty), so install it
once with `pnpm --filter @motionscript/browser exec playwright install --with-deps chromium`.
They import the **built** `dist/` of core and the renderer: run `pnpm build:lib` (Rust
needed) first on a fresh checkout. Files named `*.node.test.ts` run in Node and ask what a consumer's bundler
keeps of this package (`tree-shaking`, `cdn-build`). Suites that need an H.264 or AAC
encoder skip on a Chromium without one; `REQUIRE_ENCODERS=1` makes them fail instead.

See [CLAUDE.md](https://github.com/motionscript-dev/motionscript/blob/main/packages/browser/CLAUDE.md) for the traps when editing here,
[ARCHITECTURE.md](https://github.com/motionscript-dev/motionscript/blob/main/ARCHITECTURE.md) for the layering and
[CONTRIBUTING.md](https://github.com/motionscript-dev/motionscript/blob/main/CONTRIBUTING.md) for the workflow.
