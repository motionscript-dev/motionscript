# @motionscript/headless

## 0.1.1-alpha.4

### Patch Changes

- Updated dependencies [d67777c]
  - @motionscript/renderer@0.1.1-alpha.4
  - @motionscript/browser@0.1.1-alpha.4

## 0.1.1-alpha.3

### Patch Changes

- @motionscript/browser@0.1.1-alpha.3
- @motionscript/renderer@0.1.1-alpha.3

## 0.1.1-alpha.2

### Patch Changes

- @motionscript/browser@0.1.1-alpha.2
- @motionscript/renderer@0.1.1-alpha.2

## 0.1.1-alpha.1

### Patch Changes

- Updated dependencies [1810e8a]
- Updated dependencies [9024e08]
  - @motionscript/renderer@0.1.1-alpha.1
  - @motionscript/browser@0.1.1-alpha.1

## 0.1.1-alpha.0

### Patch Changes

- e279864: **Breaking:** the deprecated shims and dead exports are gone. Core drops the `SceneDocument`, `SceneEffect`, `SceneTimeline`, `integrateSpeedToSceneTime` and `sourceTimeAtSceneElapsed` aliases, `Sound.sceneDurationFor`, the `Precomp*` aliases of the asset-timeline names, `ImageFilters` and `VideoFilters` (use `Adjustments` and `VideoAdjustments`), `PropertyMeta.withdrawn`, `AssetTimelineOptions.lifespans`, and the unused `opacity` and `blend` of per-shape descriptors (`ShapeState`). The `filters` prop of image and video fills is removed too: write the grade as `preset: { adjustments }`. Documents move to format 3, and opening one that carries `filters` on a media fill moves it into `preset.adjustments`. Also removed as unused: `sampleParam`, `IDENTITY_AFFINE3`, `neutralPreset`, `resolveMediaPreset`'s second argument, `paramAtDistance`, `arcPointFunction`, `segmentChord`, `isStyleOnlySegment`, `withTransformDescriptor`, `easeKey`, `isParentNode`, `AudioParams`, `ResolvedSoundProps`, `StarProps`, `RotatedBoxProps`, `ModelView3DProps` and `NumberNodeFormat`. In headless, `Semaphore`, `withDeadline`, `toRenderError` and `cleanPageErrorMessage` were internal and are deleted.

  Migration: a stored document needs nothing done to it. Opening a format 2 document moves a media fill's `filters` into `preset.adjustments` (dropped where `preset.adjustments` already states the grade), and saving it writes format 3. Code that named a removed export uses what it aliased: `Adjustments` for `ImageFilters`, `VideoAdjustments` for `VideoFilters`, and the asset-timeline names for the `Precomp*` aliases.

- Updated dependencies [3630b74]
- Updated dependencies [1c43a37]
- Updated dependencies [6b89575]
- Updated dependencies [e279864]
- Updated dependencies [e279864]
- Updated dependencies [e9db554]
- Updated dependencies [7cd4e53]
  - @motionscript/core@0.1.1-alpha.0
  - @motionscript/renderer@0.1.1-alpha.0
  - @motionscript/browser@0.1.1-alpha.0

## 0.1.0

### Patch Changes

- Updated dependencies [d2241c3]
- Updated dependencies [2026625]
  - @motionscript/renderer@0.1.0
  - @motionscript/browser@0.1.0

## 0.1.0-alpha.10

### Patch Changes

- Updated dependencies [d2241c3]
- Updated dependencies [2026625]
  - @motionscript/renderer@0.1.0-alpha.10
  - @motionscript/browser@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- @motionscript/browser@0.1.0-alpha.9
- @motionscript/renderer@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- @motionscript/browser@0.1.0-alpha.8
- @motionscript/renderer@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- @motionscript/browser@0.1.0-alpha.7
- @motionscript/canvaskit@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- aa75a19: A source-string node default-exports a component, and is written with calls.

  - `Registry.addNodeFromSource`, `engine.registerNode(source)` and a string in `nodes` (browser and headless) take a script whose default export is a component (`export default component2d({ key: "…", … })`), not a class decorated with `@node(...)`.
  - `DynamicNodeConfig.jsxRuntime` is gone, and browser's default compiler reads TypeScript without JSX or decorators: a script with JSX fails to compile, and one that requires `@motionscript/sdk/jsx-runtime` fails to link. The CDN build no longer imports `@motionscript/core/jsx/jsx-runtime`, so an import map need not name it.

### Patch Changes

- Updated dependencies [aa75a19]
  - @motionscript/browser@0.1.0-alpha.6
  - @motionscript/canvaskit@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- 1778355: `@motionscript/core` is now a peer dependency of `@motionscript/headless`, as it is of every other package built on it, so the project entry and the page share the one copy your project installs. Install it beside the engine (`npm install @motionscript/headless @motionscript/core`; npm 7 and later add it by themselves). `@motionscript/browser` and `@motionscript/canvaskit` stay dependencies, now with a caret range rather than the exact version they were packed with.

  `renderVideo` with `softwareRender: true` (or `MS_SOFTWARE_RENDER=1`) no longer hangs on Windows. There the engine asks ANGLE for SwiftShader (`--use-angle=swiftshader`) instead of `--use-gl=swiftshader`, which left Chromium's H.264 encoder unable to finish; WebGL draws on the same SwiftShader device either way. Other platforms launch with the same flags as before.

- The headless engine can export a video across several pages at once, and an export can render a range of frames.

  - `@motionscript/headless`: `renderVideo({ concurrency })` cuts the timeline into that many contiguous runs of frames, renders and encodes each in a page of its own (one Chromium, one bundle), and joins them with `concatVideoSegments` without re-encoding. Every segment gets the same codec, bitrate and hardware acceleration and begins on a key frame; the audio is mixed once over the whole timeline with `mixTimelineAudio`. The default of 1 exports in one page as before. The added pages stay open for the next export. Segments that still cannot be joined fall back to a one-page export, with the reason on stderr.
  - `@motionscript/headless`: `renderVideo` also takes `supersample`, `codec`, `bitrate`, `hardwareAcceleration` and `includeAudio`, which reach the browser exporter, and `parseConcurrency` is exported beside the other option parsers. The page bridge has `countFrames()` and `concatSegments()`, and a bundle without them is `BRIDGE_INCOMPATIBLE`.
  - `@motionscript/headless`: `renderVideo` sends the document into the page as its JSON text (a caller may pass the text itself), because Playwright carries a 5000-node object in about 1.4 s and its text in about 0.2 s. The page exports through `exportVideo` without opening a session, whose controller discovered every track on frame 0 only for the exporter to discover them again.
  - `@motionscript/core`: `ExportVideoRequest` (so `session.export`) takes `frames: { start, end }`, a `FrameRange` with `end` excluded.
  - `@motionscript/skia-render` and `@motionscript/browser`: `renderTimeline` and `exportVideo` take `frames` too. A range renders those frames alone, timestamped from 0, discovers only the tracks they touch, and is always silent: it is one segment of a split export. A range that is empty or leaves the timeline throws a `RangeError` before anything is encoded.

- da6f97a: Every package ships a `NOTICE`, and a browser build lists what it bundles.

  - Each tarball carries the repository `NOTICE`: the copyright line and the MIT attributions for the noise functions in `skia-render`'s fractal-noise fill (David Hoskins' "Hash without Sine", Inigo Quilez's 2D simplex noise).
  - `@motionscript/canvaskit` ships `THIRD_PARTY_NOTICES.txt` with the licences of the libraries compiled into the binary: FreeType, HarfBuzz, ICU 74, zlib, libpng, Brotli, WOFF2, Emscripten and musl.
  - `dist/browser/manifest.json` gains `thirdParty`, the packages the browser build bundled (`name`, `version`, `license`), and their licence and NOTICE files are written to `dist/browser/THIRD_PARTY_LICENSES.txt`. `@motionscript/browser` bundles mediabunny (MPL-2.0, unmodified; source at https://github.com/Vanilagy/mediabunny), esbuild-wasm and three; `@motionscript/math` bundles MathJax.

- Updated dependencies [da6f97a]
- Updated dependencies
- Updated dependencies [da6f97a]
- Updated dependencies [1778355]
  - @motionscript/browser@0.1.0-alpha.5
  - @motionscript/canvaskit@0.1.0-alpha.5

## 0.1.0-alpha.4

### Minor Changes

- 8e9afad: One frame/time conversion and one `FrameSpec`, and fixes to browser playback and export.

  - Core exports `clipFrameToTime`, `clipTimeToFrame`, `frameSpecAtTime`, `FrameSpec` and `DEFAULT_OUTPUT`. The conversion is tolerant of float error: a time within a few ulps of a whole frame is that frame. The playback controller, `Session.seek`, track placement and the evaluator all use it. Before, `currentFrame` read one frame early for 2 to 6 percent of frames (frame 123 at 60 fps), so a document swap after `seek(123)` repainted frame 122, and `trackFrameCount` gained a frame when a length on a boundary landed an ulp high (4.15 s at 60 fps counted 250, not 249).
  - `FrameSpec` is declared once, in core, and re-exported by `@motionscript/browser` and `@motionscript/headless`; the browser's `DEFAULT_OUTPUT` and the React hook's fallback are core's defaults. The React playhead reads the frame the clock reports through the same conversion.
  - `WebTicker` no longer stalls a looping host: the end of a run is read again after listeners and tick callbacks have run, a final tick always fires, and a finished run pauses itself. `play` is synchronous, as `Ticker.play` is typed, so a `pause` or `seek` in the same turn works; a rejected `AudioContext.resume()` pauses and logs.
  - A supersampled export draws into a canvas that is a whole multiple of the output, so an odd-sized viewport is no longer stretched by about 1 percent.
  - `StillRenderer.toBytes`, `toBlob` and `toDataURL` throw before any frame has been drawn onto the surface, instead of encoding blank pixels.

### Patch Changes

- 7f8b4d0: A project entry whose first import is `@motionscript/sdk`, directly or through a component kit, now starts. Its page used to fail with `Class extends value undefined` and time out waiting for the bridge: honouring packages' `sideEffects: false`, esbuild left a module the lazily loaded entry shares with the engine unstarted on the engine's side (evanw/esbuild#1490), so the page bundle now ignores `sideEffects`. The bundle cache is keyed on the builder too, so a bundle cached by an earlier version is rebuilt.
- 4d4e5b0: Start-up failures in the headless engine are reported and cleaned up, and the React player's transport keeps the clock and its state in step.

  - `@motionscript/headless`: a project entry that throws while it loads now rejects `start()` at once with `START_FAILED` and the cause, instead of waiting 60 seconds for `BRIDGE_TIMEOUT`. The page entry imports the project dynamically, so the throw is a rejection the entry already handles.
  - `@motionscript/headless`: a `start()` that fails closes the Chromium it launched, so a retry no longer leaks the first browser, and a `close()` that lands while the engine is booting ends the boot with `CLOSED` instead of letting it finish on a closed engine.
  - `@motionscript/react`: `seek()` then `play()` in one batch while already playing left the clock paused with `isPlaying` still `true`. `play()` and `pause()` now drive the controller as well as the state.
  - `@motionscript/react`: a session rebuild while playing (a different engine, viewport size or fps) used to park the new session with a seek that paused it. A player that was playing now resumes once the park has landed, unless a newer seek or a pause came first. The README and CLAUDE.md say which changes rebuild the session.

- 55a3b69: A still, a screenshot or an export refuses a font family the manifest does not describe.

  - A text node naming a family with no manifest entry was shaped against the fallback face, with a console warning, and the frame was returned as if it were the document's. Described later, the same document draws differently, so a frame stored or encoded in the meantime was the wrong one. `StorageAdapter` now throws `AssetNotLoadedError` (`assetType: "font"`, `src` the family) for it when its `DecodePolicy` is `"exact"`, which every still, screenshot and export sets while it draws. Nothing is remembered of the refusal, so a renderer handed a manifest that describes the family loads it on the next render.
  - A preview is unchanged: an undescribed family draws in the fallback face, with the warning, until a manifest describes it. The warning is no longer printed for a still or an export, which now fail instead.
  - A text node that names no family at all is refused by `requireFontFamily`, as before.
  - `renderImage` and `renderVideo` in `@motionscript/headless` reject with the page's error for such a document, where they used to return a frame with no text in it.

- Updated dependencies [cd1c774]
- Updated dependencies [c9535a6]
- Updated dependencies [997dd9e]
- Updated dependencies [413b08e]
- Updated dependencies [ada534c]
- Updated dependencies [7f8b4d0]
- Updated dependencies [158723b]
- Updated dependencies [3627b1a]
- Updated dependencies [75b6908]
- Updated dependencies [7f8b4d0]
- Updated dependencies [217ae88]
- Updated dependencies [7f8b4d0]
- Updated dependencies [7f8b4d0]
- Updated dependencies [217ae88]
- Updated dependencies [7f8b4d0]
- Updated dependencies [7f8b4d0]
- Updated dependencies [7f8b4d0]
- Updated dependencies [3eefc7e]
- Updated dependencies [8e9afad]
- Updated dependencies [217ae88]
- Updated dependencies [c9535a6]
- Updated dependencies [cd420db]
- Updated dependencies [55a3b69]
- Updated dependencies [7f8b4d0]
- Updated dependencies [96ed4d4]
- Updated dependencies [7c07443]
  - @motionscript/core@0.1.0-alpha.4
  - @motionscript/browser@0.1.0-alpha.4
  - @motionscript/canvaskit@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- 5f74bde: The engine serves only files inside `assetsDir`. Its traversal check compared path strings, so a document could read a file in a sibling directory whose name starts with the assets directory's (`public-secret` beside `public`) by asking for `/..%2Fpublic-secret%2Fx.txt`. A path now has to resolve inside the directory, and its real path has to as well, so a symlink inside it that points out is refused too. A malformed percent escape is a 404 rather than an error in the route handler.
- 8f8416d: An installed `@motionscript/headless` can render. The page harness its bundle compiles (`src/page/harness.ts`) was left out of the published package, so an engine started anywhere outside this repository failed with `START_FAILED: Could not bundle the project entry`. The package now ships the harness, and the engine reads it from the same path whether it is installed or not.
- Updated dependencies [1f00320]
- Updated dependencies [47b6b7d]
- Updated dependencies [6697bb4]
- Updated dependencies [979a467]
- Updated dependencies [e2ce45c]
- Updated dependencies [42e9217]
- Updated dependencies [ffd26fd]
- Updated dependencies [1c48469]
- Updated dependencies [59c9944]
  - @motionscript/browser@0.1.0-alpha.3
  - @motionscript/core@0.1.0-alpha.3
  - @motionscript/canvaskit@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies [0227e28]
  - @motionscript/core@0.1.0-alpha.2
  - @motionscript/browser@0.1.0-alpha.2
  - @motionscript/canvaskit@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- Updated dependencies [59cecba]
- Updated dependencies [59cecba]
  - @motionscript/core@0.1.0-alpha.1
  - @motionscript/browser@0.1.0-alpha.1
  - @motionscript/canvaskit@0.1.0-alpha.1

## 0.1.0-alpha.0

Initial release.
