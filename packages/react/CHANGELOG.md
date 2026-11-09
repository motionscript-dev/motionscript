# @motionscript/react

## 0.1.0-alpha.7

## 0.1.0-alpha.6

## 0.1.0-alpha.5

### Minor Changes

- 36bfb89: `useEngine` builds an engine, hands it over when it is ready and disposes it when it is not wanted.

  Every React host was writing the same effect: hold the engine in state, build it asynchronously, dispose it if the component unmounted while the wasm was loading (StrictMode does this on every mount in development) and again on cleanup. `useEngine(create, { deps, onError })` is that effect. It returns `null` until the engine arrives, which `useMotionPlayer` already accepts.

  ```tsx
  const engine = useEngine(() =>
    createBrowserEngine({ wasmUrl: "/canvaskit.wasm" }),
  );
  const player = useMotionPlayer({ engine, document: scene });
  ```

  The package still imports no platform: what to build is the factory you pass, so it works with `createBrowserEngine`, a headless engine or a test double. `deps` rebuilds the engine when something that makes a different one changes (the node types, say), disposing the old one first; the factory itself is read through a ref, so an inline arrow does not rebuild anything. `onError` replaces the default `console.error` when the factory rejects or throws. Anything that must hold before a player sees the engine, such as `setManifest`, goes in the factory.

### Patch Changes

- da6f97a: Every package ships a `NOTICE`, and a browser build lists what it bundles.

  - Each tarball carries the repository `NOTICE`: the copyright line and the MIT attributions for the noise functions in `skia-render`'s fractal-noise fill (David Hoskins' "Hash without Sine", Inigo Quilez's 2D simplex noise).
  - `@motionscript/canvaskit` ships `THIRD_PARTY_NOTICES.txt` with the licences of the libraries compiled into the binary: FreeType, HarfBuzz, ICU 74, zlib, libpng, Brotli, WOFF2, Emscripten and musl.
  - `dist/browser/manifest.json` gains `thirdParty`, the packages the browser build bundled (`name`, `version`, `license`), and their licence and NOTICE files are written to `dist/browser/THIRD_PARTY_LICENSES.txt`. `@motionscript/browser` bundles mediabunny (MPL-2.0, unmodified; source at https://github.com/Vanilagy/mediabunny), esbuild-wasm and three; `@motionscript/math` bundles MathJax.

- 1778355: `react` and `react-dom` peer on `^18.2.0 || ^19.0.0`, where they asked for `^19.2.3`. The package uses only hooks React 18 already has (`useSyncExternalStore` among them), so a React 18 app installs it without a peer warning.
- 36bfb89: `MotionStage` no longer throws `Cannot read properties of undefined (reading 'MakeWebGLCanvasSurface')` by mounting its canvas on a session its player has already disposed. Two paths led there:

  - A viewport change. The player's size moved a commit before its new session arrived, in the commit that disposed the old one, so the stage resized its canvas and mounted it on the disposed session. The canvas is now sized from the session's own viewport.
  - A replayed effect: a Suspense boundary revealed again after something beside the player suspended, or StrictMode's dev replay, re-runs the stage's effects with the session it last rendered, after the player's cleanup disposed it. The stage now skips a session its player disposed.

## 0.1.0-alpha.4

### Minor Changes

- c9535a6: A host can ask what a node holds before any command has acted on it.

  - `PlaybackController.getNodeInitialProps(nodeId)`, and the React player's method of the same name, return a document node's props as it arrived (or as built, for one that has not arrived yet). The answer is the same at every frame and is given while the node is off screen, where `getNodeState`/`getNodeProps` describe the node at the frame showing.
  - `ClipTimeline.baselineProps(id)` is the read underneath it. A bound prop is read through its binding.

- 7f8b4d0: A node can give its children coordinates of its own, which is what a coordinate system needs: a child's `x`/`y` are then in the parent's units and the child keeps its size.

  - A parent answers `_planeOf(child)` with a `ChildPlane` (`toOffset` and `toCoords`, exported). Paint, `global`, the anchor getters, `moveTo({ target })` and `parentPlanePointAt` all read it, and the last two answer in the parent's coordinates. A node whose parent publishes none is unchanged.
  - `childPlanePointAt(root, path, point)`, and `childPlanePoint` on the player, say where a point lands in the coordinates a node positions its children in, for a host placing a node that is not there yet. They answer `null` for a node whose children are in pixels, and `_planeOf(null)` is what they ask.
  - `findNode2D(from, id)` and `frameIn(host, node)` are exported from the SDK, for a node that follows another by id. `@motionscript/grids` now uses them and still exports both names.

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

- 7f8b4d0: A node can name points an editor may drag to set its `Vector2` props. It answers `_handles()` with each prop and where it sits in its own frame, and `_handleValue(prop, at)` with the value that puts it somewhere else. `nodeHandlesAt` and `handleValueAt` (exported from the SDK), and `nodeHandles`/`handleValue` on the player, answer in viewport space. A math `vectorArrow` offers its two ends in graph units, and a `curlyBrace` that spans two points offers those.
- 8e9afad: One frame/time conversion and one `FrameSpec`, and fixes to browser playback and export.

  - Core exports `clipFrameToTime`, `clipTimeToFrame`, `frameSpecAtTime`, `FrameSpec` and `DEFAULT_OUTPUT`. The conversion is tolerant of float error: a time within a few ulps of a whole frame is that frame. The playback controller, `Session.seek`, track placement and the evaluator all use it. Before, `currentFrame` read one frame early for 2 to 6 percent of frames (frame 123 at 60 fps), so a document swap after `seek(123)` repainted frame 122, and `trackFrameCount` gained a frame when a length on a boundary landed an ulp high (4.15 s at 60 fps counted 250, not 249).
  - `FrameSpec` is declared once, in core, and re-exported by `@motionscript/browser` and `@motionscript/headless`; the browser's `DEFAULT_OUTPUT` and the React hook's fallback are core's defaults. The React playhead reads the frame the clock reports through the same conversion.
  - `WebTicker` no longer stalls a looping host: the end of a run is read again after listeners and tick callbacks have run, a final tick always fires, and a finished run pauses itself. `play` is synchronous, as `Ticker.play` is typed, so a `pause` or `seek` in the same turn works; a rejected `AudioContext.resume()` pauses and logs.
  - A supersampled export draws into a canvas that is a whole multiple of the output, so an odd-sized viewport is no longer stretched by about 1 percent.
  - `StillRenderer.toBytes`, `toBlob` and `toDataURL` throw before any frame has been drawn onto the surface, instead of encoding blank pixels.

### Patch Changes

- 4d4e5b0: Start-up failures in the headless engine are reported and cleaned up, and the React player's transport keeps the clock and its state in step.

  - `@motionscript/headless`: a project entry that throws while it loads now rejects `start()` at once with `START_FAILED` and the cause, instead of waiting 60 seconds for `BRIDGE_TIMEOUT`. The page entry imports the project dynamically, so the throw is a rejection the entry already handles.
  - `@motionscript/headless`: a `start()` that fails closes the Chromium it launched, so a retry no longer leaks the first browser, and a `close()` that lands while the engine is booting ends the boot with `CLOSED` instead of letting it finish on a closed engine.
  - `@motionscript/react`: `seek()` then `play()` in one batch while already playing left the clock paused with `isPlaying` still `true`. `play()` and `pause()` now drive the controller as well as the state.
  - `@motionscript/react`: a session rebuild while playing (a different engine, viewport size or fps) used to park the new session with a seek that paused it. A player that was playing now resumes once the park has landed, unless a newer seek or a pause came first. The README and CLAUDE.md say which changes rebuild the session.

- 217ae88: A host can keep a node looking exactly as it does when it moves it to another parent, as a design tool does. `reparentPlacementAt(root, path, parentPath, offsets)` (the player's `reparentPlacement`) carries `x`/`y` values the node takes under its parent now, its own and its moves' destinations, to the ones that put its centre at the same place under the new parent, and gives the turn to add to its rotation and the factor to scale it by so the two parents' own turn and scale, cameras included, are undone. It works through a freeform parent's padding and alignment and a parent's own coordinates, and answers `null` for a parent that arranges its children in a run or a grid. `flowOps.freeSlot` says where a freeform arrangement puts one more item.

## 0.1.0-alpha.3

## 0.1.0-alpha.2

## 0.1.0-alpha.1

## 0.1.0-alpha.0

Initial release.
