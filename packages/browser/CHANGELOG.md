# @motionscript/browser

## 0.1.0-alpha.8

### Patch Changes

- @motionscript/renderer@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- @motionscript/skia-render@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- aa75a19: A source-string node default-exports a component, and is written with calls.

  - `Registry.addNodeFromSource`, `engine.registerNode(source)` and a string in `nodes` (browser and headless) take a script whose default export is a component (`export default component2d({ key: "…", … })`), not a class decorated with `@node(...)`.
  - `DynamicNodeConfig.jsxRuntime` is gone, and browser's default compiler reads TypeScript without JSX or decorators: a script with JSX fails to compile, and one that requires `@motionscript/sdk/jsx-runtime` fails to link. The CDN build no longer imports `@motionscript/core/jsx/jsx-runtime`, so an import map need not name it.

### Patch Changes

- @motionscript/skia-render@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- da6f97a: An export's audio mix asks the host's byte source before the network.

  `mixAudio`, and so `exportVideo` and `mixTimelineAudio`, fetched every audio source from the network, while previews, stills and the rest of an export read bytes through `setAssetByteSource` first. A host holding a recording locally (one not yet uploaded, or with no network) exported silence or failed where the preview played. The source is now asked with the address the catalog resolves, as `WebStorageAdapter` does, and a `null` falls through to `fetch` as before.

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

- Updated dependencies
- Updated dependencies [da6f97a]
- Updated dependencies [1778355]
- Updated dependencies
  - @motionscript/skia-render@0.1.0-alpha.5

## 0.1.0-alpha.4

### Minor Changes

- 158723b: **Breaking:** the engine no longer has a "scene" in its document API. Its unit is a clip document on a project track, so the names that said "scene" now say what the thing is. This is a clean break: there are no aliases and no deprecated re-exports, so update the names below.

  | Before                                                   | After                        |
  | -------------------------------------------------------- | ---------------------------- |
  | `SceneDocument` (`StillDocument \| CompositionDocument`) | `VisualDocument`             |
  | `SceneTimeline`                                          | `ClipTimeline`               |
  | `SceneEffect` (the union of effects a node can carry)    | `NodeEffect`                 |
  | `integrateSpeedToSceneTime`                              | `integrateSpeedToClipTime`   |
  | `sourceTimeAtSceneElapsed`                               | `sourceTimeAtClipElapsed`    |
  | `Sound.sceneDurationFor`                                 | `Sound.clipDurationFor`      |
  | `AudioSink.syncTo(sceneTime)` (parameter name)           | `AudioSink.syncTo(clipTime)` |

  `ClipDocument` is now `VisualDocument | AudioDocument`, as before. The document types, the 3D `Scene3D` and its `scene3d` settings are unchanged: that is a 3D scene, not this.

  Two messages changed with the names: `assertValidDocument` now throws `Invalid clip document:` (was `Invalid scene document:`), and the JSX runtime's error for a value that is not a node class reads `JSX element must be a Node class`.

  The built-in `Canvas2D`, `Provider` and `ThemeProvider` moved from `nodes/scene/` to `nodes/root/` inside core. That directory was never an export path, so no import from the package changes.

- 8e9afad: One frame/time conversion and one `FrameSpec`, and fixes to browser playback and export.

  - Core exports `clipFrameToTime`, `clipTimeToFrame`, `frameSpecAtTime`, `FrameSpec` and `DEFAULT_OUTPUT`. The conversion is tolerant of float error: a time within a few ulps of a whole frame is that frame. The playback controller, `Session.seek`, track placement and the evaluator all use it. Before, `currentFrame` read one frame early for 2 to 6 percent of frames (frame 123 at 60 fps), so a document swap after `seek(123)` repainted frame 122, and `trackFrameCount` gained a frame when a length on a boundary landed an ulp high (4.15 s at 60 fps counted 250, not 249).
  - `FrameSpec` is declared once, in core, and re-exported by `@motionscript/browser` and `@motionscript/headless`; the browser's `DEFAULT_OUTPUT` and the React hook's fallback are core's defaults. The React playhead reads the frame the clock reports through the same conversion.
  - `WebTicker` no longer stalls a looping host: the end of a run is read again after listeners and tick callbacks have run, a final tick always fires, and a finished run pauses itself. `play` is synchronous, as `Ticker.play` is typed, so a `pause` or `seek` in the same turn works; a rejected `AudioContext.resume()` pauses and logs.
  - A supersampled export draws into a canvas that is a whole multiple of the output, so an odd-sized viewport is no longer stretched by about 1 percent.
  - `StillRenderer.toBytes`, `toBlob` and `toDataURL` throw before any frame has been drawn onto the surface, instead of encoding blank pixels.

### Patch Changes

- 997dd9e: A `Video` whose file holds no audio track is a silent video, not a failed load.

  - A `Video` declares its own sound for the same `src` as its picture. For a file with no audio track (a screen recording, say) the decode fails, and the asset manager reported `audio "…" could not be loaded: Unable to decode audio data`, which a host shows as its preview having stopped, and `mixAudio` rejected, which fails an export.
  - `AudioClip` and `AudioRequest` take `optional`, and `Video` declares its clips so. A source only optional requests want is silence when it cannot be fetched or decoded: the manager says nothing and `mixAudio` leaves those requests out and renders the rest.
  - A `sound` that names such a file is still a failure, reported once and rejecting the mix, because there the sound is the whole of what was asked for. That includes a request that starts wanting a source that had already failed quietly.
  - A source that failed quietly is kept across a document swap instead of being fetched whole again on every edit; one that was reported is still tried afresh.
  - `optional` is not part of a request's id.

- ada534c: Fixes across 3D, audio, asset loading, the session and the JSX runtime.

  - A string shader or post-effect uniform is a texture only when it looks like an asset path. A colour uniform such as `uTint: 'tomato'` made declaring the scene's assets throw `Image asset not found`.
  - `lookAt`, a camera's `target` and a light's `target` tween with `to()`. They had no tween, so a `to` moved the other props and left these where they started. An unset `target` tweens from the origin; an unset `lookAt` holds until the end, since "do not aim" has no midpoint.
  - A `Canvas3D` with no 3D children records an empty scene instead of a default camera and rig, so a viewport holding only 2D children skips the 3D pass and no longer creates a WebGL context.
  - A looping `Sound` repeats its trimmed region. `AudioRequest` carries the loop's `trimEnd`, a loop with a `trimEnd` and no cut runs open instead of playing once, and the live device and the offline mix set `loopStart` and `loopEnd` to the region (a seek into the middle of a loop is folded into it too), so the trim no longer wraps the whole buffer.
  - An audio curve's ease is part of its key. Every engine easing is an anonymous closure, so editing only an ease left the request unchanged and the device kept playing the old sound. Easings record a description, and the same ease built twice keys the same.
  - A failed audio fetch is caught, reported once, and not started again on every sync, instead of being an unhandled rejection. A layout-gated loader is no longer disposed and loaded again when the frame leaves its window.
  - `AssetNotLoadedError` names `assets.video(...)` for a video, `assets.loader(...)` for a loader and `declareAudio()` for audio.
  - `Engine.setManifest` reaches a live session's controller: a font or image added after open is known to clips already built, and tracks that failed for want of it are built again. `session.replace` keeps the `fps` and `viewport` the session was opened with instead of throwing on the document it is already playing.
  - The JSX automatic runtime keeps `key`: `<Rect key="card" />` lowers to `jsx(Rect, {}, "card")`, and `jsx` now takes the third argument.

- 55a3b69: A still, a screenshot or an export refuses a font family the manifest does not describe.

  - A text node naming a family with no manifest entry was shaped against the fallback face, with a console warning, and the frame was returned as if it were the document's. Described later, the same document draws differently, so a frame stored or encoded in the meantime was the wrong one. `StorageAdapter` now throws `AssetNotLoadedError` (`assetType: "font"`, `src` the family) for it when its `DecodePolicy` is `"exact"`, which every still, screenshot and export sets while it draws. Nothing is remembered of the refusal, so a renderer handed a manifest that describes the family loads it on the next render.
  - A preview is unchanged: an undescribed family draws in the fallback face, with the warning, until a manifest describes it. The warning is no longer printed for a still or an export, which now fail instead.
  - A text node that names no family at all is refused by `requireFontFamily`, as before.
  - `renderImage` and `renderVideo` in `@motionscript/headless` reject with the page's error for such a document, where they used to return a frame with no text in it.

- Updated dependencies [cd1c774]
- Updated dependencies [fb0ac65]
- Updated dependencies [217ae88]
- Updated dependencies [cd420db]
- Updated dependencies [848c40c]
- Updated dependencies [7f8b4d0]
  - @motionscript/skia-render@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- 1f00320: 3D renders its settings from the first frame, and installs itself without relying on module side effects.

  - The first 3D frame of a session, and the first after an `antialias` change, drew without the scene's tone mapping, shadows or `studio` environment, because they were written before the renderer existed. The renderer is now made before a scene syncs, so the same scene gives the same pixels on every frame. `Canvas3DRendererHost` gains `prepare(three, { antialias })`, which the backend calls first, and a scene's settings go to the host its backend was built with rather than whichever one is registered.
  - After an `antialias` change, a `studio` environment kept a texture from the replaced renderer and metal drew dark on every later frame. The environment is now generated per renderer.
  - `@motionscript/browser` registered 3D when its root module was evaluated, while declaring `sideEffects: false`. A bundler honouring the flag, such as rolldown under Vite 8, could drop both calls, and `Canvas3D` then drew its 2D parts only, with no error. Every `WebRenderContext` now installs the WebGL renderer and core's three loader when it is built, so each engine session, still renderer and export carries 3D with it, and importing the package registers nothing.

- 47b6b7d: A curve on an `AudioBus` animates, over the bus's own span.

  - A curve in a bus's `filters` was resolved against a length of 0, so it held its first value: `AudioFilters.gain(fadeOut(1))` never faded, and a fade or `ramp` up from 0 silenced everything on the bus. It now runs over the bus's presence span, from its row's `startAt` to its `endAt`, or to its clip's end when nothing removes it, the way a sound's curve runs over the sound's. Every clip on the bus hears the same fade, wherever its own span falls.
  - A curve-valued bus `volume` was read as 1. It is now scheduled like a curve in `filters`.
  - A bus chain was built once per bus id and kept, so a later change to the bus's level, mute or filters was not heard for the life of the device, and the offline mix played every clip through whichever version of a bus it met first. A chain is now reused only for a bus that sounds the same, and the live device builds its bus chains again after each pause, so a curve lines up with wherever playback resumes.
  - The live device restarted a curve segment from its first value when it began playing partway through that segment. It now picks the segment up where it has got to, as the offline mix does.
  - `AudioBusStop` carries the bus's span as `startAt` and `endAt`, in the same seconds as the request that carries it, and `busStopKey` keys a stop by everything that changes its sound. `busPathOf` and `busPathTo` take the declaring `AudioScope` as a second argument, and `AudioBusGraph.inputFor` takes the time its start time falls at, in the stops' seconds, as a third.

- e2ce45c: A node compiled from source can use JSX and name its own variables freely.

  - The default compiler for a source-string node emitted classic `React.createElement` calls, so a script with JSX registered and then threw `React is not defined` the first time its constructor ran. It now compiles JSX with the automatic runtime and `@motionscript/sdk` as the import source, which links to `DynamicNodeConfig.jsxRuntime`. A script needs no pragma, and a `@jsxRuntime` or `@jsxImportSource` pragma in it still takes precedence.
  - A top-level `const`, `let` or `class` named like one of the globals a script is denied (`const frames = 30`, `let history = []`, `class Request {}`) failed with `SyntaxError: Identifier '…' has already been declared`. The script now runs in a scope of its own inside the one that denies those names, so its declaration shadows the denied global. Names it does not declare still read as `undefined`.

- 42e9217: A failed asset fetch fails instead of loading empty bytes. `WebStorageAdapter` read a response's body whatever its status, so a 404 for a font file reached the font manager, which registered nothing, and the family still counted as loaded: its text drew nothing, on every frame, and nothing reported it. A missing image or audio file failed later, in a decoder, with a message that never named the address. A response that is not OK now rejects the load with `Fetching "<url>" failed: HTTP <status>`, which reaches the host the way any failed load does: a seek, a still or an export rejects, and a prefetch logs it. Nothing is cached, so the next load tries again.

  - A font family registers once every one of its files has arrived, so a family missing a weight is not registered half-way and a retry does not register the rest a second time.
  - `mixAudio`, which mixes every export's soundtrack, checks the status the same way.
  - A render through `@motionscript/headless` of a document whose font is missing from `assetsDir` now fails naming the file, instead of drawing its text empty.

- 1c48469: Stills and exports render the frame, theme and scale they were asked for.

  - Overlapping `session.image()` calls each return their own frame. They shared one renderer, so every image held the last frame drawn; the engine's exporter now queues them.
  - `exportVideo` applies the document's `theme`, and takes a `theme` option for a document that carries none, as `exportScreenshot` and `StillRenderer` do. A themed document exported on its own drew its tokens black, or in whatever theme was last set globally. `renderTimeline` and `drawFrameAt` take the same `theme` and apply it themselves.
  - `RenderStillOptions.scale`, and so `session.image({ scale })`, applies to that call only. It used to become the renderer's scale, so the next call without one drew at it too.
  - An export rejects with `NothingToDrawError` at the first frame whose every track failed to build, the same error a still of that frame throws. It used to encode a black video and log nothing. The error is exported from both packages and carries the `frame` and each track's failure. A track that built is drawable even when one of its nodes failed to declare its assets or audio; a still used to refuse it.

- Updated dependencies [1f00320]
- Updated dependencies [979a467]
- Updated dependencies [1c48469]
  - @motionscript/skia-render@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- @motionscript/skia-render@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- @motionscript/skia-render@0.1.0-alpha.1

## 0.1.0-alpha.0

Initial release.
