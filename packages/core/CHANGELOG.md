# @motionscript/core

## 0.1.1-alpha.3

## 0.1.1-alpha.2

### Patch Changes

- 3050906: **Breaking:** every run of text a chart draws gets its own text style, the palette becomes `seriesFills`, and a chart has a background for the whole chart beside one for its grid.

  - **`Types.typography(textStyle)`** (core, sdk): one text style as an entry (face, size, weight, style, spacing, paint). A partial is laid over the default or the value it replaces, so `{ fill }` recolours and keeps the rest; it tweens key by key. `describe()` reports `kind: "typography"` with its default.
  - **Chart text** (charts): `foreground`, `muted`, `fontFamily`, `fontSize` and `fontWeight` are gone. Line and bar charts have `xLabelText`, `xTitleText`, `yLabelText`, `yTitleText`, `valueText` and `legendText`; a pie `labelText`, `valueText`, `centerText` and `legendText`; a radar `spokeText`; a radial `labelText` and `centerText`. Spacing that followed the one size now follows the text it sits beside.
  - **Series fills**: `palette` is `seriesFills` (group `series`), each entry a fill that may stack paints.
  - **Backgrounds**: `background` (group `background`) paints behind the whole chart on every chart; line, bar and radar charts add `gridBackground` for the plot (inside the web on a radar). A line or bar chart's old `background`, which painted the plot, is now `gridBackground`.
  - **Bar corners**: `barRadius` is `barCornerRadius`, a `Types.cornerRadius` read as for a bar standing up (top pair at the far end, bottom pair at the base), with `barCornerStyle` (rounded or angled) beside it. `barWidth` reports itself as a percentage.
  - Each chart's `migrate` hook (`migrateChartStyle`) carries a stored style across: the palette, the two inks and the shared type become the new fields as each chart derived them, a plot background becomes `gridBackground`, and a `barRadius` keeps rounding only the far end.

  Migration: a stored document needs nothing done to it. Each chart's `migrate` hook converts its stored `style` (and a `to` command's) as the document opens: `palette` to `seriesFills`, `foreground`, `muted` and the font fields to the text fields as the chart derived them (titles 1.1× and a weight heavier, values as before), a line, bar or radar chart's `background` to `gridBackground`, and a number `barRadius` to `barCornerRadius` with only the top pair rounded. Code that sets these fields by hand, or a host that reads a chart's stored `style`, uses the new names; `migrateChartStyle(layout)` converts a style object the same way.

## 0.1.1-alpha.1

### Patch Changes

- 672012c: `Types.style(family, groups, { presets })`: a component's whole look as one entry. Fields are written in groups and read flat (`state.style.palette`); a set lays a partial over the previous value and drops keys the component does not declare, so one preset or saved style dresses every component of the family; `to({ style })` tweens field by field. `describe()` reports it as `kind: "style"` with its family, presets and grouped fields, so a host can edit and save looks generically. `Types.palette(fills)` is a colour-per-item entry, tweened pairwise. The SDK exports the `StyleGroups`, `StyleInput`, `StyleOptions`, `StyleShape` and `StyleValues` types.

## 0.1.1-alpha.0

### Patch Changes

- 3630b74: Editing a node whose own commands animate what its asset declaration reads no longer re-runs that declaration on every frame the commands cover. A sweep after an edit takes back what an owner declared on a frame when every slot it read there holds what it held, so moving a 3D component with a build-in command costs about 10 ms per edit instead of re-running its whole `render` a few hundred times (about 215 ms for a 19-tile board). A declaration that read anything else runs again as before.
- 1c43a37: `projectNode3D` also reports `bounds`: what the node and its children draw, as a box in the node's own frame. Projected through `localPoints`, it is a selection box that turns and scales with the mesh, where the screen box `getNodeBox` reports is only the upright rectangle around it.
- e279864: **Breaking:** the deprecated shims and dead exports are gone. Core drops the `SceneDocument`, `SceneEffect`, `SceneTimeline`, `integrateSpeedToSceneTime` and `sourceTimeAtSceneElapsed` aliases, `Sound.sceneDurationFor`, the `Precomp*` aliases of the asset-timeline names, `ImageFilters` and `VideoFilters` (use `Adjustments` and `VideoAdjustments`), `PropertyMeta.withdrawn`, `AssetTimelineOptions.lifespans`, and the unused `opacity` and `blend` of per-shape descriptors (`ShapeState`). The `filters` prop of image and video fills is removed too: write the grade as `preset: { adjustments }`. Documents move to format 3, and opening one that carries `filters` on a media fill moves it into `preset.adjustments`. Also removed as unused: `sampleParam`, `IDENTITY_AFFINE3`, `neutralPreset`, `resolveMediaPreset`'s second argument, `paramAtDistance`, `arcPointFunction`, `segmentChord`, `isStyleOnlySegment`, `withTransformDescriptor`, `easeKey`, `isParentNode`, `AudioParams`, `ResolvedSoundProps`, `StarProps`, `RotatedBoxProps`, `ModelView3DProps` and `NumberNodeFormat`. In headless, `Semaphore`, `withDeadline`, `toRenderError` and `cleanPageErrorMessage` were internal and are deleted.

  Migration: a stored document needs nothing done to it. Opening a format 2 document moves a media fill's `filters` into `preset.adjustments` (dropped where `preset.adjustments` already states the grade), and saving it writes format 3. Code that named a removed export uses what it aliased: `Adjustments` for `ImageFilters`, `VideoAdjustments` for `VideoFilters`, and the asset-timeline names for the `Precomp*` aliases.

## 0.1.0

### Minor Changes

- ba03011: WebGPU renderer replaces Skia, @motionscript/renderer is new, skia-render/canvaskit are gone, and it’s breaking

### Patch Changes

- 70b93d7: @motionscript/cli and ms add are removed: install the component packages and register their NODES.
- d2241c3: Drawing is faster with the same output: rects and ellipses build their outlines without going through an SVG path string, arcs convert without allocating, and a colour string already parsed is not parsed again (until the theme changes). On a scene of 10,000 ellipses a frame the renderer's per-frame work drops by about 15%.
- 1666474: Frames evaluate, lay out and render several times faster on animated scenes (about 4x on a scene of 2,100 laid-out rects), with the same output. Finished built-in commands (`to`, `set`, `moveTo`, `fadeTo`, `rotateTo`, `scaleTo`, `layoutTo`, the paint commands, `variableTo` and the rest) are held at their end values instead of run every frame, as component commands already were. A prop's accessor now lives on its node type's prototype instead of on each node: `Object.keys(node)` and a spread of a node no longer list its props (a child's `state` still does). A value written from outside the timeline onto a slot of an animated node that no command writes now survives a seek, as it already did for nodes animated by component commands.

## 0.1.0-alpha.10

### Patch Changes

- d2241c3: Drawing is faster with the same output: rects and ellipses build their outlines without going through an SVG path string, arcs convert without allocating, and a colour string already parsed is not parsed again (until the theme changes). On a scene of 10,000 ellipses a frame the renderer's per-frame work drops by about 15%.
- 1666474: Frames evaluate, lay out and render several times faster on animated scenes (about 4x on a scene of 2,100 laid-out rects), with the same output. Finished built-in commands (`to`, `set`, `moveTo`, `fadeTo`, `rotateTo`, `scaleTo`, `layoutTo`, the paint commands, `variableTo` and the rest) are held at their end values instead of run every frame, as component commands already were. A prop's accessor now lives on its node type's prototype instead of on each node: `Object.keys(node)` and a spread of a node no longer list its props (a child's `state` still does). A value written from outside the timeline onto a slot of an animated node that no command writes now survives a seek, as it already did for nodes animated by component commands.

## 0.1.0-alpha.9

### Patch Changes

- 70b93d7: @motionscript/cli and ms add are removed: install the component packages and register their NODES.

## 0.1.0-alpha.8

### Minor Changes

- ba03011: WebGPU renderer replaces Skia, @motionscript/renderer is new, skia-render/canvaskit are gone, and it’s breaking

## 0.1.0-alpha.7

### Minor Changes

- 5941d52: The class versions of the built-in node types are gone. Every built-in has been a component for a while; core kept the old classes only to compare against. Removed from `@motionscript/core`: `PaintNode`, `ShapeNode`, `BoundsShape`, `TextBase`, `applyTextDefaults`, and the transitional `RectBase`, `EllipseBase`, `PathBase`, `PathShapeBase`, `PolygonBase`, `PolygramBase`, `VideoBase`, `Mesh3DBase` and `Canvas3DBase`. Build on the components (`Rect`, `Text`, `Mesh3D`, `Canvas3D`, ...) and the modules (`Paint`, `Flow`, `Shapes`, `Typeface`, `TextLayout`, `Material`, `View3D`) instead. `Canvas2D` and the `Node`, `Node2D`, `Node3D` and `NodeAudio` bases stay.

  No `@motionscript/sdk` export is removed: the props types (`RectProps`, `TextProps`, `Mesh3DProps`, ...) are unchanged and now live beside their components. `ModelView3D` is a component rather than a `Model3D` subclass, so `instanceof Model3D` no longer holds for it. `TextSelection` now takes any `TextSelectionHost` rather than the removed `Text` class.

- 737f7d0: What was left of the class authoring system is gone. Each piece existed to write or extend a node class, and a node type is a component now; no built-in, kit or host used them.

  Removed from `@motionscript/core`:

  - the registration functions `property`, `node`, `command` and `withdraw`, and the thirteen typed property helpers (`fillProperty`, `strokeProperty`, `shadowProperty`, `effectsProperty`, `colorProperty`, `cornerRadiusProperty`, `cornerStyleProperty`, `pathProperty`, `insetsProperty`, `alignmentProperty`, `vector2Property`, `sizeProperty`, `textProperty`) with their `AttributePropOptions` type. A component declares its entries with `Types`. `getPropertyMeta`, `getNodeDescriptor`, `getCommandMeta` and the metadata types stay;
  - `TextSelection`, `TextSelectionHost`, `TextSelectionProps`, `TextRange`, `SelectionOverrides` and `normalizeRanges`: the component `Text` has no selection API, so nothing could make one. Style a range with `runs`;
  - `AudioScope` and the `declareAudio` hook on `Node`: sound plays from commands (`timeline.sound`). `busPathOf` and `busPathTo` take a function answering a node's span instead of an `AudioScope`;
  - the `Node.tick` hook and the `Node2D` hooks `beforeRender`, `afterRender`, `renderStroke`, `clipPathSelf`, `resolveSizeInput` and `constraints`, which only a subclass could reach;
  - `NodeTypeRecord.withdrawn` and `CommandMeta.withdrawn`. `PropertyMeta.withdrawn` stays, deprecated: nothing sets it.

  Removed from `@motionscript/core/component`, and so from `@motionscript/sdk/component` and `@motionscript/charts/kit`, which re-export it: the seekable composition `at`, `hold`, `sequence` and `together`, with the `Seekable` and `Placed` types. A component command returns timeline pieces.

  Removed from `@motionscript/sdk`: `TextSelection`, `TextSelectionProps`, `TextRange`, `SelectionOverrides`, `AudioScope` and `AudioClip`.

- 17f9883: Core no longer ships its JSX runtime: its `./jsx/jsx-runtime` and `./jsx/jsx-dev-runtime` subpaths are gone, and so are the `jsx`, `jsxs`, `Fragment` and `JSX` the root barrel re-exported. Build a tree with calls (`Rect({ children: [Text({ text: "hi" })] })`), as a component does. Nothing in the engine uses decorator syntax any more either, so no consumer needs `experimentalDecorators` on core's account.

### Patch Changes

- 17f9883: Three fixes for components. A component frame (a `Rect`, or any component laid out by `Flow`) answers where a dropped node lands, so `reparentPlacementAt` into one gives a placement instead of `null`. `View3D.load(loader, extend)` takes the `extend` a viewport's render draws with and declares what it draws, so its textures and models load before the frame; math's `axes3d` passes its axes. `ref` is typed on component calls as the node the call builds, accepting a ref of any supertype.

## 0.1.0-alpha.6

### Minor Changes

- 163b708: Node types are components: one spec object handed to `component2d`, `component3d` or `componentAudio`, with no classes, decorators or JSX.

  - **Writing a node type.** A component is one object literal: `key`, `state` (literals and `Types`), `defaults`, `commands`, `children`, `allowedChildren`/`allowedParents`, `provide`, `load`, and its tree's own fields (`measure`, `layout`, `render` for 2D). Behaviour comes from modules you spread in and call: `Paint`, `Flow`, `Shapes`, `Typeface`, `TextLayout`, `Aim`, `Material`, `View3D`. ADR 0007 and the custom-node docs cover it.
  - **Building nodes in code** uses calls: `Rect({ fill: 'tomato', children: [Text({ text: 'Hi' })] })`, or `new Rect({...})` for the node itself.
  - **Every built-in and every kit node is a component**, under the same document key. Code that tested `instanceof` a class now uses the component's `.is`, or `instanceof X.node`. Changed members:
    - `SurfacePlot3d.valueAt` and `FunctionPlot.valueAt` are now the functions `surfaceValueAt` and `curveValue`.
    - A system's `coordinates` is replaced by `planeMap`/`axesMap`/`systemMap`.
    - `PieChart.isSelected` is replaced by `isSliceSelected`.
    - `ItemGrid` is a kit module (`ItemGrid.isGrid`, `ItemGrid.define`), not a base class.
  - **The sdk no longer exports the class surface:**
    - the decorators: `node`, `property` and every `*Property`, `command`, `withdraw`, `driveCommand`;
    - the authoring bases: `PaintNode`, `ShapeNode`, `TextBase`, `Mesh3DBase`, `Canvas3DBase` and the `*Base` geometry classes;
    - `asCommand`, `compose`, `drive` and `declarePaints` from `@motionscript/sdk/component`;
    - the `jsx-runtime` and `jsx-dev-runtime` subpaths.
    - `Node`, `Node2D`, `Node3D` and `NodeAudio` remain as types.
  - **Editor metadata leaves the engine.** The kits no longer declare `parentKey`, `forkable`, `layout`, `seed`, `within`, `beside` or `closed`; a host keeps those in its own configs. `describe()` now reports `holds`, the trees a type takes children from, and the placement checks use it, so a 2D viewport of your own that takes 3D children places them.
  - A command called from code with no argument runs, and a refused child is told what its parent takes (`allowedChildren`) or where it goes (`allowedParents`).

- aa75a19: A source-string node default-exports a component, and is written with calls.

  - `Registry.addNodeFromSource`, `engine.registerNode(source)` and a string in `nodes` (browser and headless) take a script whose default export is a component (`export default component2d({ key: "…", … })`), not a class decorated with `@node(...)`.
  - `DynamicNodeConfig.jsxRuntime` is gone, and browser's default compiler reads TypeScript without JSX or decorators: a script with JSX fails to compile, and one that requires `@motionscript/sdk/jsx-runtime` fails to link. The CDN build no longer imports `@motionscript/core/jsx/jsx-runtime`, so an import map need not name it.

## 0.1.0-alpha.5

### Patch Changes

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

- b9ba548: The scene-named document API keeps deprecated aliases until 1.0, so code written against an earlier alpha still builds.

  - `SceneDocument` (`VisualDocument`), `SceneTimeline` (`ClipTimeline`), `SceneEffect` (`NodeEffect`), `integrateSpeedToSceneTime` (`integrateSpeedToClipTime`), `sourceTimeAtSceneElapsed` (`sourceTimeAtClipElapsed`) and `Sound.sceneDurationFor` (`Sound.clipDurationFor`) are exported again, each marked `@deprecated` and pointing at its new name.
  - `SceneDocument` and `SceneEffect` are also back on `@motionscript/sdk`'s type exports.
  - The error texts changed in the rename (`Invalid clip document:`, `JSX element must be a Node class`) stay as they are.

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

- 7f8b4d0: Three commands that draw the eye to a node and leave it as it was.

  - `pulse({ factor })` swells a node to `factor` times its size and settles it back; `wiggle({ angle, turns })` rocks it about its own turn. Both are on every 2D node.
  - `flash({ portion })` sends a stretch of a shape's outline along it. A shape that rests with `end: 0` is seen only as the stretch passing.

- 217ae88: The `texture`, `displace`, `godRays` and `trails` effects are removed.

  - `Effects.texture`, `Effects.displace`, `Effects.godRays` and `Effects.trails` are gone, and so are the same four on `Adjustments` (`godRays`, `texture`, `displace`) and their option and effect types: `TextureOptions`, `TextureEffect`, `DisplaceOptions`, `DisplaceEffect`, `DisplaceChannel`, `GodRaysOptions`, `GodRaysEffect`, `TrailsOptions`, `TrailsEffect`.
  - A document that still holds one of these effects builds, and the effect draws nothing: the renderer has no handler for the type and skips it.
  - `trails` also leaves the list of effects a media fill cannot carry. `motionBlur` is unchanged.
  - No effect declares an image any more, so `EffectData.declare` has no implementation in the library.

- 7f8b4d0: 3D graphs, and named commands for 3D scenes.

  - `@motionscript/math` gains `axes3d` (a 3D graph that is its own viewport, a `canvas3d` with its camera, lights and `orbitTo`, so it goes straight on a 2D stage: three axes through a box of graph coordinates, z up, with ticks, tips, numbers and titles), `surfacePlot3d` (a height over x and y, or three parts in u and v; coloured by height with `colorScale`, ruled with `meshLines`), `curvePlot3d` (a space curve, drawn on with `progressTo`), `plotPoint3d` (rides a surface it is put inside) and `vectorArrow3d`. Anything inside the axes sits at graph coordinates and keeps its own size.
  - Every 3D node has `moveTo`, `rotateTo` and `scaleTo`. A `canvas3d` has `orbitTo` for its default camera, and a `camera3d` has `orbitTo` and `lookTo`.
  - A 3D parent can place its children in coordinates of its own (`Node3D._spaceOf`, `ChildSpace3D`), as a 2D one already could, and so can a `canvas3d` for the 3D nodes directly inside it (`Canvas3D._spaceOf`).
  - The SDK exports `MaterialShorthand3D`, what a mesh node of your own returns from `materialShorthand()`.

- 7f8b4d0: `@motionscript/math` gains coordinate systems, plots and the marks that go on a graph.

  - `numberLine`, `axes2d` and `numberPlane` are coordinate systems: a child's `x`/`y` are graph units whatever the child is, so a text or an image sits on a graph at its own size, `moveTo` moves it in graph units, and `rangeTo` pans and zooms everything inside.
  - `functionPlot` draws an equation and reads its kind from how it is written: `sin(x)`, `x = y^2`, `r = 1 + cos(theta)`, `(cos(t), sin(t))`. `morphTo` bends one curve into another, and curves break at asymptotes and domain edges. A name the equation does not know is a named value: 1 until `params` gives it one, bindable to a variable by a formula, listed by `equationParams`.
  - `pointsPlot`, `plotPoint`, `vectorArrow`, `curveArea`, `riemannSum`, `tangentLine` and `dropLines` are drawn in graph coordinates. The ones that ride a plot name it by id in `on`.
  - `@motionscript/math/kit` exports `CoordinateSystem`, `Mark`, the coordinate map, the equation language and the sampler for a custom system or mark.
  - The SDK exports the `Extents` type that `pathOps.bounds` already returned.

- 217ae88: A node type can withdraw what it inherits, and the math nodes take only the paints they draw.

  - `@withdraw(...keys)` drops inherited properties and commands from a node class. A withdrawn property is left out of `describe()` and holds its default whatever is written to it; a withdrawn command is left out of `commandKeys()` but still runs for a stored document, changing nothing. A subclass that declares the key again takes it back.
  - `Registry.takesCommand(type, key)` says whether a node type takes a command: its own, or a node-less one unless that runs a method the type lacks or withdrew. `addCommand` takes a `method` for that; the paint commands name theirs.
  - Math: a plot, a tangent, drop lines, an arrow, a brace, an emphasis mark and an angle mark have no `fill`; a curve area has no `stroke`; a formula, a traced path, a field, a curve area, a Riemann sum, a plot point and a sample space have no outline trim (`start`, `end`, `progressTo`, `flash`). An open `pointsPlot` draws no fill.
  - Math: `partColors` and `colorTo` on `latex`, `latexMatrix` and `networkGraph` are now `partFills` and `partFillTo`, each part taking any paint (`{ part, fill }`). A vector field's and stream lines' `colorScale` is now `strengthFills`, and a sample space's `colors` is now `columnFills`, both lists of paints.
  - Math: a vector field's and stream lines' shadow is cast when they are painted by strength too, not only in one paint.

- 7f8b4d0: Planes that transform, fields, polar planes, implicit curves and trails.

  - `numberPlane` gains `matrix` and `transformTo` (a linear map of the whole plane), `warp` and `warpTo` (a bend by a function of its points), and a faint `ghost` of itself while it is transformed. The grid, the axes and everything on the plane go with it.
  - New nodes: `polarPlane` (rings and spokes; plots and marks go on it as on axes), `vectorField` (arrows of a field `(P, Q)`, coloured by strength with `colorScale`), `streamLines` (the lines the field carries a point along, sent flowing with `flowTo`) and `tracedPath` (the trail a point leaves as a value changes).
  - A `functionPlot` draws an implicit equation, such as `x^2 + y^2 = 4`, where it holds.
  - A `Camera` can `follow` a node of its world by id, with `lookAt` as an offset from it.

- 7f8b4d0: A node can name points an editor may drag to set its `Vector2` props. It answers `_handles()` with each prop and where it sits in its own frame, and `_handleValue(prop, at)` with the value that puts it somewhere else. `nodeHandlesAt` and `handleValueAt` (exported from the SDK), and `nodeHandles`/`handleValue` on the player, answer in viewport space. A math `vectorArrow` offers its two ends in graph units, and a `curlyBrace` that spans two points offers those.
- 7f8b4d0: A node type can say where it goes, so a host can offer it only where it works.

  - `@node({ within, beside, closed })`: `within` names the types a node goes inside (a name covers every type built on it), `beside` the types it needs at least one of as a sibling, and `closed` marks a parent that takes only children that name it. Nothing checks them at build.
  - `parentIssue`, `siblingIssue` and `placementIssues` answer them for a host, together with the 2D/3D seam and `acceptsChildren`; `nodeTypeIsA` walks `parentKey`.
  - In `@motionscript/math` a `functionPlot` holds the marks that are of it: a `tangentLine`, and a `plotPoint` or `dropLines` put inside it follow its curve with no `on`. `curveArea` and `riemannSum` sit beside the plots they read and name them in `on`. Plots, arrows and marks go inside a coordinate system.

- 3eefc7e: Package reshuffle.

  - `@motionscript/layout-grid` is now `@motionscript/grids` (`@motionscript/grids/kit`, and `packages/components/grids`), and its `LayoutGrid` base class is `ItemGrid` (`ItemGridProps`, `ITEM_GRID_TYPES`). `RectangularGrid`, `RadialGrid`, `PathGrid` and `SphereGrid` keep their names and document keys. Update the dependency, the imports, and any `@motionscript/layout-grid/kit` specifier a copied component carries.
  - `@motionscript/geo-data` is now `@motionscript/geography`. The data format on disk (`data/v1/…`) is unchanged, so `@motionscript/geo` reads it as before and a host that serves `@motionscript/geo-data/data` serves `@motionscript/geography/data` the same way.
  - `@motionscript/ui` is removed: its `Switch`, `Button`, `Window` and `Cursor` nodes, and the `ControlNode` base class, no longer ship. They are plain nodes over `@motionscript/sdk`, so a project that needs one writes its own and shapes it to taste.
  - `@motionscript/patterns` is new. It holds the pattern nodes (`LineGridPattern`, `DotGridPattern`, `GridPattern`, `ViewportPattern`) that `@motionscript/core` and `@motionscript/sdk` no longer ship.

- 8e9afad: One frame/time conversion and one `FrameSpec`, and fixes to browser playback and export.

  - Core exports `clipFrameToTime`, `clipTimeToFrame`, `frameSpecAtTime`, `FrameSpec` and `DEFAULT_OUTPUT`. The conversion is tolerant of float error: a time within a few ulps of a whole frame is that frame. The playback controller, `Session.seek`, track placement and the evaluator all use it. Before, `currentFrame` read one frame early for 2 to 6 percent of frames (frame 123 at 60 fps), so a document swap after `seek(123)` repainted frame 122, and `trackFrameCount` gained a frame when a length on a boundary landed an ulp high (4.15 s at 60 fps counted 250, not 249).
  - `FrameSpec` is declared once, in core, and re-exported by `@motionscript/browser` and `@motionscript/headless`; the browser's `DEFAULT_OUTPUT` and the React hook's fallback are core's defaults. The React playhead reads the frame the clock reports through the same conversion.
  - `WebTicker` no longer stalls a looping host: the end of a run is read again after listeners and tick callbacks have run, a final tick always fires, and a finished run pauses itself. `play` is synchronous, as `Ticker.play` is typed, so a `pause` or `seek` in the same turn works; a rejected `AudioContext.resume()` pauses and logs.
  - A supersampled export draws into a canvas that is a whole multiple of the output, so an odd-sized viewport is no longer stretched by about 1 percent.
  - `StillRenderer.toBytes`, `toBlob` and `toDataURL` throw before any frame has been drawn onto the surface, instead of encoding blank pixels.

- c9535a6: Three more attributes can be animated by name, so a document no longer needs the general `to` for them.

  - `layoutTo` on every 2D node tweens `width`, `height` and `padding`, whichever are given. A size keyword (`'fill'`, `'hug'`) snaps; a number interpolates.
  - `effectTo` on every 2D node tweens the `effects` stack.
  - `progressTo` on shapes and paths tweens `start` and `end`, the share of the outline that is drawn, whichever are given.

  Each runs through `to`, so a frame is the same as before for a document that already tweened those props.

- 7f8b4d0: A stroke's `startCap` and `endCap` take a marker as well as a cap: `arrow`, `triangle`, `stealth`, `dot`, `box`, `diamond` or `bar`. Any open path, arc or custom shape can be an arrow.

  - A pointed head has its tip on the path's end and turns with the path. A marker is `capScale × weight` long (`capScale` is new, default `4`, and tweens) and shrinks to fit a contour shorter than it, so a head rides `start`/`end` as a path is drawn on.
  - A marker is drawn even where a dash pattern leaves the end bare, and a marked stroke is centred on its path whatever its `align`.
  - `StrokeMarker` and `StrokeEnd` are exported; `cap` still takes the three caps only.

- 96ed4d4: The `Line` node is removed. A `Path` draws what it drew.

  - The `line` node type is no longer registered and `Line` and `LineProps` are no longer exported. A document that names `line` fails to build with `Unknown node type`. Write its points as a path instead: `<Line points={[[0, 0], [200, 0]]} />` is `<Path data="M 0 0 L 200 0" />`, and in a document a `path` node whose `data` is in the unit space of its box. A path's `y` runs down where a line's points ran up, and a face-value `Path` is centred on its own extent rather than drawn from the node's origin.
  - `shapeOutline` and `hasShapeOutline` no longer answer for `"line"`.
  - `Graphics2D.line` and the `line` op are unchanged: a custom node still draws a polyline with them, vertex `radius` and `closed` included.

### Patch Changes

- cd1c774: A mesh node's `shadow` reaches its mesh, and the 3D inputs that do nothing say so.

  - A `Box3D`, `Plane3D` or any other mesh node never cast or received a shadow: its `shadow` was written to the group of its scope, which three never reads, and the mesh kept three's own default. The viewport's `shadows`, a light's `shadow` and the default node `shadow` together produced no shadow, while the same scene built from `Graphics3D` ops with `shadow: true` did. `Scene3D.draw` now gives a drawable that states no `shadow` the one of the node scope it is drawn in (a `shadow` on the op itself wins, and it does not cascade to child nodes), so `shadow={false}`, `'cast'` and `'receive'` on a node are honoured, a custom node's `renderSelf` included, and `applyTransform` with no transform applies the documented default (casts and receives). Scenes of mesh nodes with shadows turned on now show them.
  - `Points3D` read only `material`, so `fill`, `opacity` and the rest of the shorthand were accepted and ignored. It now builds a `points` material from `fill` (a colour, or a texture as the dot's `map`), `opacity`, `alphaMap`, `blend` and `vertexColors`; an explicit `material` still wins.
  - Five inputs the types accept are recorded and acted on by no renderer: the `post` chain, an environment's HDR, EXR or cubemap `src` and `faces`, `params` on a geometry or an environment, a shader material's `extends` and OBJ models. Nothing is removed. Each now logs one warning per session in development, and its doc comment says it is inert. A model file that fails to load is reported once per file. The `LineBasicMaterial3D` comment that promised a mesh-backed thick line now says nothing substitutes one.

- 997dd9e: A `Video` whose file holds no audio track is a silent video, not a failed load.

  - A `Video` declares its own sound for the same `src` as its picture. For a file with no audio track (a screen recording, say) the decode fails, and the asset manager reported `audio "…" could not be loaded: Unable to decode audio data`, which a host shows as its preview having stopped, and `mixAudio` rejected, which fails an export.
  - `AudioClip` and `AudioRequest` take `optional`, and `Video` declares its clips so. A source only optional requests want is silence when it cannot be fetched or decoded: the manager says nothing and `mixAudio` leaves those requests out and renders the rest.
  - A `sound` that names such a file is still a failure, reported once and rejecting the mix, because there the sound is the whole of what was asked for. That includes a request that starts wanting a source that had already failed quietly.
  - A source that failed quietly is kept across a document swap instead of being fetched whole again on every edit; one that was reported is still tried afresh.
  - `optional` is not part of a request's id.

- 413b08e: A reference to a node that is not there yet no longer crashes a clip when the prop it feeds goes through a mapper.

  `padding: "=[card.padding]"` (and `cornerRadius`, `cornerStyle`, `pivot`, `align`, a colour, and every other prop that resolves loose input) on a node reading a card that enters later made the build throw `Cannot read properties of undefined` at time 0, because the absent node's `undefined` was handed to the prop's mapper. The prop now holds what a node built without it holds, its default, until the card is in the tree, and follows the card while it is. A prop with no mapper still reads `undefined`, as before. `Canvas3D`'s colour props (`ambientColor`, `keyColor` and the grid colours) were left `undefined` in that case and now take their default colour.

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

- 3627b1a: Fixes in colour parsing, paint and effect tweens, paths, hugging wrapped layout and text font sizes.

  - `hsl()`, `lch()` and `oklch()` convert a hue given in `deg`, `grad`, `rad` or `turn` to degrees, where `hsl(0.5turn 100% 50%)` read as 0.5 degrees. A negative `hsl()` hue wraps. The legacy `rgba(255, 0, 0, 50%)` reads a percentage alpha as 0.5, like the slash form. A malformed colour (`rgb(255)`, `hsl(0)`, `#zzz`, an unknown unit) is now one outcome: the "Unsupported color format" warning and opaque black, where some threw a bare `TypeError` and others went black without a word.
  - Tweening an image or video fill from one `fit` (or raw `matrix`) to another switches at the midpoint and ends on the destination's, where it ended on the source's.
  - Tweening a gradient between different stop counts or positions resamples both onto the union of their stops, so it ends on the destination gradient (the fractal-noise colour ramp too). Tweening a `shader` effect between two programs switches the program at the midpoint, where it kept the source's program with the destination's uniforms.
  - An effect's `clip` option survives a tween and is compared for equality for every effect (`lerpEffect` carries the shared option keys), and `Effects.magnify` and `Effects.glass` honour `clip`, which they ignored.
  - A `Path` centres on the tight box it hugs, where a curved path was centred on its control-point bounds and drew off-centre in its own layout box. `pathOps.cubics` leaves out a lone `M`, so a morph from an empty path to `"M5 5"` no longer throws. `pathOps.anchors` and `pathOps.cubics` hand out copies of their points, so editing the result cannot move the cached path. `anchorBounds` ignores the self-loop of a closed one-anchor subpath, which is never drawn.
  - A hugging row or column with `wrap` measures a main-axis `fill` item as the unwrapped run does, where it reserved the whole available extent for it.
  - Tweening a text `fontSize` between `'autofit'` and a number switches at the midpoint (`textOps.lerpFontSize`), where it wrote `autofitNaN`. A `RichText` ignores an `'autofit'` size from a default text style or theme preset, where it measured a `NaN` height.

- 75b6908: Fixes in document validation, the clip timeline and the expression language.

  - `validateDocument` reports tree and command issues at the row's place in the document. A malformed row earlier in `nodes` or `commands` used to shift every later path by one.
  - The parts a command writes on a node's own children (a chart's ring, legend or bars) are restored to what they were built with before the command starts and after a seek back, so a frame no longer depends on how the playhead arrived. The chart legend's per-series reveal is now one slot, so the timeline can restore it.
  - A child that enters before its parent is baselined once the parent has mounted it, so it keeps what it inherits (a text style, for example) instead of the pre-attach values.
  - A row that an animated `removeChildAt` takes out of its parent is back in place before the command starts, in a fresh build and after a scrub alike.
  - An unknown `targetId` is one error naming it for every node-scoped command (`to`, `set`, `save`, `moveTo`, component commands). Global-table commands used to be skipped silently, and named ones blamed the node type.
  - Instant `removeChildAt` detaches the removed subtree, as `remove()` and `clear()` do.
  - Expressions: `toString`, `constructor`, `__proto__` and the other `Object.prototype` names are unknown functions and constants rather than a `TypeError`, in the shared parser and the plot kit (and `alignmentOps.resolve` rejects them as `isKey` does). A blank string operand is `NaN`, not `0`. `step` and `smoothstep` propagate `NaN`, and `smoothstep` with equal edges is a step at the edge. Arity errors say "1 argument". `renameRefs` hands its callback the trimmed reference name.

- 217ae88: A host can keep a node looking exactly as it does when it moves it to another parent, as a design tool does. `reparentPlacementAt(root, path, parentPath, offsets)` (the player's `reparentPlacement`) carries `x`/`y` values the node takes under its parent now, its own and its moves' destinations, to the ones that put its centre at the same place under the new parent, and gives the turn to add to its rotation and the factor to scale it by so the two parents' own turn and scale, cameras included, are undone. It works through a freeform parent's padding and alignment and a parent's own coordinates, and answers `null` for a parent that arranges its children in a run or a grid. `flowOps.freeSlot` says where a freeform arrangement puts one more item.
- cd420db: Fixes in the 2D and 3D handlers: strokes, paths, text on a path, lights, textures, geometry and model overrides.

  - A stroke group holding two or more open lines or paths drew each one closed by a chord, because the group was unioned as if it were closed regions. Open outlines are now stroked as built.
  - A fractional stroke `align` (anything between -1 and 1 other than 0) narrowed the stroke and put all of it on one side, so a tween from `center` to `inside` jumped at its first step. The stroke is now `weight` wide at every `align` and slides across the edge continuously, solid and dashed. Text strokes still resolve to the three alignments by sign.
  - A path given as an SVG string with a `centerBounds` frame that is not symmetric about 0 was displaced, because the frame was mirrored into the canvas but the string was not. The frame now follows the data.
  - Text laid out along a path kept the glyphs of the fallback face it was first shaped with after its real font loaded. The shaped run is now keyed by the font epoch.
  - A directional or spot light's `target` is a world-space point again. It was applied as an offset from the light, so a light at (4, 6, 3) aimed at the origin had no direction. Scenes that set `target` on a light away from the origin will shade differently.
  - Two `Tex.data` textures of the same size and options resolved to one texture, the second showing the first one's pixels. A data texture is now told apart by its array, which should be kept between frames and `revision`-bumped to update.
  - `Torus3D` and `TorusGeometry3D` honour `startAngle` on a partial `sweep`.
  - A default `capsule`'s bounds were twice the size of the mesh built for it. `geometryBounds3D` now uses the renderer's default radius of 0.5.
  - A model's material override matched by mesh name was rebuilt and reassigned every frame and the old material never disposed. It is built once and written in place.
  - A luminance mask's colour filter and the shaders built by noise, stripe, unset-media and 3D-scene fills were never released.
  - `opacity` and `blend` on an individual shape have never been drawn. They are now marked `@deprecated` on `ShapeState`, and the renderer warns once per prop; use `Graphics2D.opacity()` or the node's own.

- 55a3b69: A still, a screenshot or an export refuses a font family the manifest does not describe.

  - A text node naming a family with no manifest entry was shaped against the fallback face, with a console warning, and the frame was returned as if it were the document's. Described later, the same document draws differently, so a frame stored or encoded in the meantime was the wrong one. `StorageAdapter` now throws `AssetNotLoadedError` (`assetType: "font"`, `src` the family) for it when its `DecodePolicy` is `"exact"`, which every still, screenshot and export sets while it draws. Nothing is remembered of the refusal, so a renderer handed a manifest that describes the family loads it on the next render.
  - A preview is unchanged: an undescribed family draws in the fallback face, with the warning, until a manifest describes it. The warning is no longer printed for a still or an export, which now fail instead.
  - A text node that names no family at all is refused by `requireFontFamily`, as before.
  - `renderImage` and `renderVideo` in `@motionscript/headless` reject with the page's error for such a document, where they used to return a frame with no text in it.

- 7c07443: `to()` maps a prop's destination once, so a mapper that is not idempotent no longer moves the prop twice as far.

  - A numeric prop behind a mapper was interpolated between stored values and then written through the setter, which ran the mapper on every step again: with `mapper: (v) => v * 2`, `to({ dbl: 10 })` ended at 40 and was at 20 halfway, and a second tween started from the wrong place. A string that snaps at the end was mapped twice the same way. The destination is now mapped once and every step is stored as it is, which is what a prop with a `tween` already did. A clamp behaves as before for any ease that stays between the two ends.
  - An ease that overshoots (`back`, `elastic`) is no longer held by a mapper alone. A prop that must stay in range says so in its `tween`, as `Globe`'s `elevation` and `zoom` now do, so they still stop at 89° and 1.02 under an overshooting ease.

## 0.1.0-alpha.3

### Patch Changes

- 47b6b7d: A curve on an `AudioBus` animates, over the bus's own span.

  - A curve in a bus's `filters` was resolved against a length of 0, so it held its first value: `AudioFilters.gain(fadeOut(1))` never faded, and a fade or `ramp` up from 0 silenced everything on the bus. It now runs over the bus's presence span, from its row's `startAt` to its `endAt`, or to its clip's end when nothing removes it, the way a sound's curve runs over the sound's. Every clip on the bus hears the same fade, wherever its own span falls.
  - A curve-valued bus `volume` was read as 1. It is now scheduled like a curve in `filters`.
  - A bus chain was built once per bus id and kept, so a later change to the bus's level, mute or filters was not heard for the life of the device, and the offline mix played every clip through whichever version of a bus it met first. A chain is now reused only for a bus that sounds the same, and the live device builds its bus chains again after each pause, so a curve lines up with wherever playback resumes.
  - The live device restarted a curve segment from its first value when it began playing partway through that segment. It now picks the segment up where it has got to, as the offline mix does.
  - `AudioBusStop` carries the bus's span as `startAt` and `endAt`, in the same seconds as the request that carries it, and `busStopKey` keys a stop by everything that changes its sound. `busPathOf` and `busPathTo` take the declaring `AudioScope` as a second argument, and `AudioBusGraph.inputFor` takes the time its start time falls at, in the stops' seconds, as a third.

- 6697bb4: Every chart command runs from a document.

  - Thirteen of the twenty chart commands returned a composition of seekable parts rather than a `Command`, so a document naming one failed to compile with `TypeError: made.at is not a function`: `enter` on all three charts, `showSeries`, `hideSeries` and `spotlightSeries` on the line and bar charts, and `selectSlice`, `deselectSlice`, `selectOnlySlice` and `clearSelection` on the pie. So did `zoomTo` with a region naming neither axis, and `resetZoom` before any zoom. Each now returns a `Command` that lasts the duration it was given. A line or bar `enter` without a legend, whose beats end before that, holds its last frame for the rest of it.
  - `@motionscript/sdk/component` gains `asCommand(part, duration?)`, which makes a composition built with `at`, `sequence`, `together`, `hold`, `compose` or `drive` the `Command` a `@command()` method returns. A part that ends before `duration` holds its last frame, and one that runs longer is played faster, so the command always ends where the part does.
  - A line chart's first `zoomTo` from an auto axis tweens. It started from the unset range and ticks, which the axis tween steps at the midpoint, so the first zoom cut halfway through and only later ones moved. A zoom, and `resetZoom`, now start from the range and ticks the axis draws.

- 979a467: A draw that throws no longer corrupts the next frame. When a node threw partway down the tree (an image that has not loaded, a custom `renderSelf` that fails), the render context kept the state it was in: the inherited opacity, the open node scopes, the canvas's saves and transforms, any clip, camera, boolean or mask scope, and an inherited text style. A host that reported the error and painted again drew the next frame inside it, displaced by the failed nodes' offsets and faded by their opacity.

  - `SkiaRenderContext.execute` still throws the error, and now puts the context back as a fresh one holds it before it returns, so a pass that threw is followed by one that draws as if it never ran.
  - `Node2D.render` closes its node scope in a `finally`, so every `begin` is matched by an `end` on the way out of a throw as well.
  - A `Graphics2D` that throws during `draw()` unwinds its own group opacity, rotation, scale and effect layers before the error leaves it.

- e2ce45c: A node compiled from source can use JSX and name its own variables freely.

  - The default compiler for a source-string node emitted classic `React.createElement` calls, so a script with JSX registered and then threw `React is not defined` the first time its constructor ran. It now compiles JSX with the automatic runtime and `@motionscript/sdk` as the import source, which links to `DynamicNodeConfig.jsxRuntime`. A script needs no pragma, and a `@jsxRuntime` or `@jsxImportSource` pragma in it still takes precedence.
  - A top-level `const`, `let` or `class` named like one of the globals a script is denied (`const frames = 30`, `let history = []`, `class Request {}`) failed with `SyntaxError: Identifier '…' has already been declared`. The script now runs in a scope of its own inside the one that denies those names, so its declaration shadows the denied global. Names it does not declare still read as `undefined`.

- ffd26fd: A `protein`'s `color` now paints. The prop resolves to an RGBA tuple when it is written, and `hexOf` turned anything that was not a string into `#ffffff`. So `colorScheme: 'uniform'` painted every atom, bond, tube and ribbon white whatever `color` was, the `residue` scheme's fallback was white, and a tween of `color` changed nothing. `hexOf` now writes any `Color` as hex through `colorOps`, so `color` drives `uniform` and the fallbacks, and a change to it rebuilds the cached tints. The `element`, `chain`, `secondary` and `residue` colours are unchanged.

  `colorOps` is now exported from `@motionscript/sdk`, and it gains `hex(value)`, which writes any `Color` as `#rrggbb`, or as `#rrggbbaa` when it is not opaque.

- 59c9944: A subclass that redeclares a `@property` or a `@command()` its base already declares now overrides it. `getPropertyMeta` and `getCommandMeta` kept the base's declaration and dropped the subclass's, so a redeclared default, mapper, tween or editor option, or a command's `args` and `name`, never took effect. The most-derived declaration of each key now wins, whole, in the position the base gave it, and an inherited key the subclass does not redeclare is kept as declared. `Registry.describe`, a node type's command table and a new instance's values all read that one declaration.

  A bare `Globe` now starts at its own camera and key light (orbit −10, elevation 25, zoom 2.8, ambient 0.55, key 1.9) rather than `Canvas3D`'s (35, 20, 12, 0.45, 2.4), which framed it as a small disc twelve radii away. A bare `Protein` likewise starts at elevation 18, zoom 2.6, ambient 0.55 and key 1.6. `describe("graph3d")` no longer reports `Canvas3D`'s defaults for `orbit`, `elevation` and `zoom`, which a graph derives from `camera.initialPosition`.

## 0.1.0-alpha.2

### Patch Changes

- 0227e28: A command published under a key of its own, `@command({ key: "press" }) pulse()`, runs the method it decorates. The registry recorded the key as the method to call, so dispatching it from a document called whatever the class had under that name: a prop (`Command "press" needs a "press" method`), an inherited method, or nothing. `CommandMeta` now carries `method` beside `key`, and `Registry.addNode` stores it as `NodeCommandEntry.method`. A command whose key is a core command's but whose method is not is no longer taken for the core command when compile decides whether it reads or writes layout. A command declared without a `key` is unchanged.

## 0.1.0-alpha.1

### Minor Changes

- 59cecba: A node compiled from source requires the SDK by its published name: `require("@motionscript/sdk")` resolves to `DynamicNodeConfig.sdk`, and `require("@motionscript/sdk/jsx-runtime")` to `jsxRuntime`. The earlier unscoped `motionscript` and `motion-script` specifiers resolve to the same objects, so a script written under either still compiles, and the error for an unknown specifier now names `@motionscript/sdk`.
- 59cecba: The SDK carries what a component is written against, so a kit no longer reaches into `@motionscript/core`. New in `@motionscript/sdk` (and `@motionscript/core/sdk`, which it passes through):

  - `PathShape` and `PathShapeProps`, the document's `"path"` node, whose `data` is in its own box's unit space.
  - `pathOps`, with the `PathSampler`, `PathAnchor`, `PathSubpath` and `VectorPath` types it takes and returns.
  - `textOps`.
  - `toPathString`, plus the `PathBounds` and `GraphicsOp` types.
  - `InsetsProps`, what a `padding`-style prop accepts, and `SizeConstraints`, what an overriding `measure()` is handed.
  - `SpaceCamera`, what `_spaceCamera()` returns to open a 2.5D space.
  - `BufferGeometry3D`.

  `@motionscript/sdk/component` is a new subpath over `@motionscript/core/component`: seekable entrances (`at`, `sequence`, `together`, `hold`, `compose`, `drive`), `declarePaints`, number formatting and the orbit-camera lerps. It is a subpath because a scene author never needs it, and because its `hold` (a seekable pause) is not the barrel's `hold` (an audio curve).

  Host machinery stays in core: the asset catalog and declaration pass, render and measure contexts, `SceneTimeline`, `Engine` and `Session`.

## 0.1.0-alpha.0

Initial release.
