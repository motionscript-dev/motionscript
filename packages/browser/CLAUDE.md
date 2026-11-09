# CLAUDE.md: `packages/browser`

Traps for editing the browser platform. Overview and commands are in `README.md`.

## Registration and bundling

- **Register nothing on import.** The package is `sideEffects: false`; module-level state (`setAssetByteSource`, the compiler memo) is fine, a module-scope call is not.
- **`test/tree-shaking.node.test.ts` is the guard.** It bundles each entry that draws with rolldown and requires the renderer in the output, and requires `mixAudio` alone to carry none. Keep it passing when adding an entry.
- **`@motionscript/core` stays the one peer dependency; `@motionscript/renderer` is a dependency.** `scripts/build-browser.mjs` reads the peers to decide what stays external, so the CDN build bundles the renderer and copies its WASM (`motionscriptBrowser.assets`); dropping core from the peers quietly bundles a second core into `dist/browser/` and `instanceof` fails across packages with no error. `test/cdn-build.node.test.ts` pins the bare imports of the output. `dist/browser/` is generated; never edit it. The renderer imports nothing from this package (it would be a cycle turbo refuses); what it needs from here, such as `loadAssetBytes`, is handed to `createWgpuRenderer` (`src/renderer.ts`).
- **Every entry that draws goes through `loadRenderer`** (`src/renderer.ts`), which rejects with `WebGpuUnavailableError` where there is no WebGPU adapter; `mixTimelineAudio` only measures text and loads it with `gpu: false`.
- **The root barrel is an exact list** (`test/package-surface.test.ts`). `WebExporter`, `loadRenderer`, `resolveDynamicNodes` and `DEFAULT_OUTPUT` stay off it.
- **`src/audio/` imports no renderer value** (a type-only import is fine), so `@motionscript/browser/audio` loads without the WASM. `cdn-build.node.test.ts` checks it.

## WASM URLs

- **The renderer's WASM resolves beside its module by default; `rendererWasmUrl` overrides it** on every entry that draws. `compilerWasmUrl` is memoised in `src/dynamic-nodes.ts`: the first call wins and a failed init is permanent.
- **Compute a default URL lazily, inside the function.** `import.meta.url` is empty in an IIFE bundle (the headless page), and `new URL(...)` at import throws before a caller can pass the explicit one.
- **In the CDN build both default URLs 404.** A host passes `rendererWasmUrl` and `compilerWasmUrl`.

## Ticker and sessions

- **`WebTicker` has one timebase, `context.currentTime`,** and in a session that context is the audio sink's. The playhead steps by animation-frame time and is pulled toward that clock every frame, because the audio clock moves in bursts that skipped frames when read directly. A borrowed context is never closed (`ownsContext`).
- **Caches are per session, not per engine.** Every session gets its own storage adapter (font manager, paragraph cache, decoded images), render context and `WebAudioSink` (so its own `AudioContext`, created on first use: the first play, or the first sound to decode, since opening the audio device costs 50–65 ms and most sessions open without playing). The ticker gets that context through a getter and never reads it while paused. The engine shares its registry, manifest, the one `WebExporter` and its renderer, which the exporter draws stills with too (an export loads its own); `engine.dispose()` disposes the exporter and the backend.
- **`play()` is synchronous.** A suspended context's clock is frozen, so without a user gesture the run holds at its anchor and nothing is reported; a rejected resume pauses and logs.
- **The playhead is written every animation frame; listeners hear once per project frame, and at the end of a run.** Ticks never overlap (the loop awaits them). The end is re-read after listeners run, so a seek from a listener keeps the run going.

## Export and stills

- **Split exports** (`concatVideoSegments`): a segment is an export with `frames` set, which is always silent and timestamped from 0, so its first frame is a key frame from a fresh encoder. Every segment must share one encoder configuration and begin with a key frame, and only codec, coded size and decoder `description` are checked (`ConcatMismatchError`). Pin `hardwareAcceleration`, `codec` and `bitrate` across workers. Segment audio is dropped; mix the whole timeline once with `mixTimelineAudio` and pass it as `audio`, because joined AAC puts an encoder-priming click at every seam.
- **Parallel export** (`src/parallel/`): `exportVideoParallel` pins one `ResolvedVideoEncoding` (a `Quality` resolved to bits per second by `plainVideoEncoding`, since a lane's spec crosses a `MessagePort`) and hands every lane the same `SegmentSpec`. A lane session keeps one surface for the whole export (a WebGPU one takes up to 1.5 s to start) and gives each range its own encoder. `LaneGovernor` admits lanes by measured throughput: two windows encoding at once split one GPU process's encoder and were measured *slower* than one on light scenes, so never add lanes by count. Once it settles, `runLanes` merges what is queued into one range per lane share, because each range pays a fresh encoder and scene build (about 240 ms). Ranges are joined in start order by `createSegmentJoiner`, whose audio is encoded first so the muxer interleaves it as video arrives.
- **Output size is rounded up to even** (`evenUp`), because an encoder pads an odd dimension with a smeared strip. **Supersampling (default 2) is lowered until the render axis fits 8192** (`fittedSupersample`).
- **A frame is read back through `snapshotCanvas()`** (`BrowserRenderContext`), and an asynchronously started surface is awaited with `whenMounted()` before the first draw; a WebGPU canvas is readable only in the task that drew it, so a wgpu context redraws there.
- **A `StillRenderer` has one surface and one caller at a time.** A render and the encode of its result are two calls; callers sharing one must queue (`WebExporter.exportStill` does). `render({ scale })` applies to that call only and rebuilds the surface, and the next call without it rebuilds it back. `setViewport` drops every decode; `setManifest` keeps them. Encoding a surface nothing was drawn onto throws.
- **A surface is never resized in place by a caller: set the canvas size, then `mount` again.**
- **`setAssetByteSource` is module-level on purpose.** Sessions, the exporter, `mixTimelineAudio` and the still renderers each build the renderer's storage adapter inside this package where a host cannot reach it, so a constructor argument would cover the preview and leave export on the network. A source that answers `null` or throws falls through to `fetch`.
- **`session.export({ encode })` is cast, not validated.** Only `download: true` takes the DOM-anchor path; otherwise the bytes come back. An audio `format` routes to `exportAudio`, which ignores the video settings. `exportStill` ignores `signal`.
- **Formats are one table** (`src/formats.ts`): container, extension, MIME type, audio codec and the video codecs a container takes. Opus is resampled to 48 kHz (`audioTrackSource`); a codec a container cannot hold falls back to the format's default. `ensureAudioEncoder` registers LAME for MP3 on first use (`import()`, so it stays a lazy chunk; a module-scope registration would break `sideEffects: false`).

## Tests

- Chromium tests (`test/**/*.test.ts`) and Node tests (`*.node.test.ts`) are two vitest projects. They import the **built** `dist/` of core and the renderer: run `pnpm build:lib` first (Rust needed), and `playwright install chromium` once. Chromium runs on SwiftShader's WebGPU adapter; on Linux it must run headed (`HEADED=1 xvfb-run -a …`), since a headless page there reads a WebGPU canvas back empty. Read a frame back with `test/pixels.fixtures.ts` (`snapshotCanvas()`). `REQUIRE_ENCODERS=1` makes an encoder suite fail instead of skip.
- A dependency first imported mid-run reloads the page; list it in `optimizeDeps.include` in `vitest.config.ts` (`mediabunny` and `@mediabunny/mp3-encoder` are there for that reason).

## Docs

- `../renderer/README.md` and `../renderer/DESIGN.md`: how a frame is drawn, the WGSL shader contract, GPU faults.
