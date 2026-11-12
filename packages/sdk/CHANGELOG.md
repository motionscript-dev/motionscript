# @motionscript/sdk

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

- e279864: **Breaking:** the deprecated shims and dead exports are gone. Core drops the `SceneDocument`, `SceneEffect`, `SceneTimeline`, `integrateSpeedToSceneTime` and `sourceTimeAtSceneElapsed` aliases, `Sound.sceneDurationFor`, the `Precomp*` aliases of the asset-timeline names, `ImageFilters` and `VideoFilters` (use `Adjustments` and `VideoAdjustments`), `PropertyMeta.withdrawn`, `AssetTimelineOptions.lifespans`, and the unused `opacity` and `blend` of per-shape descriptors (`ShapeState`). The `filters` prop of image and video fills is removed too: write the grade as `preset: { adjustments }`. Documents move to format 3, and opening one that carries `filters` on a media fill moves it into `preset.adjustments`. Also removed as unused: `sampleParam`, `IDENTITY_AFFINE3`, `neutralPreset`, `resolveMediaPreset`'s second argument, `paramAtDistance`, `arcPointFunction`, `segmentChord`, `isStyleOnlySegment`, `withTransformDescriptor`, `easeKey`, `isParentNode`, `AudioParams`, `ResolvedSoundProps`, `StarProps`, `RotatedBoxProps`, `ModelView3DProps` and `NumberNodeFormat`. In headless, `Semaphore`, `withDeadline`, `toRenderError` and `cleanPageErrorMessage` were internal and are deleted.

  Migration: a stored document needs nothing done to it. Opening a format 2 document moves a media fill's `filters` into `preset.adjustments` (dropped where `preset.adjustments` already states the grade), and saving it writes format 3. Code that named a removed export uses what it aliased: `Adjustments` for `ImageFilters`, `VideoAdjustments` for `VideoFilters`, and the asset-timeline names for the `Precomp*` aliases.

- Updated dependencies [3630b74]
- Updated dependencies [1c43a37]
- Updated dependencies [e279864]
  - @motionscript/core@0.1.1-alpha.0

## 0.1.0

## 0.1.0-alpha.10

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- 737f7d0: What was left of the class authoring system is gone. Each piece existed to write or extend a node class, and a node type is a component now; no built-in, kit or host used them.

  Removed from `@motionscript/core`:

  - the registration functions `property`, `node`, `command` and `withdraw`, and the thirteen typed property helpers (`fillProperty`, `strokeProperty`, `shadowProperty`, `effectsProperty`, `colorProperty`, `cornerRadiusProperty`, `cornerStyleProperty`, `pathProperty`, `insetsProperty`, `alignmentProperty`, `vector2Property`, `sizeProperty`, `textProperty`) with their `AttributePropOptions` type. A component declares its entries with `Types`. `getPropertyMeta`, `getNodeDescriptor`, `getCommandMeta` and the metadata types stay;
  - `TextSelection`, `TextSelectionHost`, `TextSelectionProps`, `TextRange`, `SelectionOverrides` and `normalizeRanges`: the component `Text` has no selection API, so nothing could make one. Style a range with `runs`;
  - `AudioScope` and the `declareAudio` hook on `Node`: sound plays from commands (`timeline.sound`). `busPathOf` and `busPathTo` take a function answering a node's span instead of an `AudioScope`;
  - the `Node.tick` hook and the `Node2D` hooks `beforeRender`, `afterRender`, `renderStroke`, `clipPathSelf`, `resolveSizeInput` and `constraints`, which only a subclass could reach;
  - `NodeTypeRecord.withdrawn` and `CommandMeta.withdrawn`. `PropertyMeta.withdrawn` stays, deprecated: nothing sets it.

  Removed from `@motionscript/core/component`, and so from `@motionscript/sdk/component` and `@motionscript/charts/kit`, which re-export it: the seekable composition `at`, `hold`, `sequence` and `together`, with the `Seekable` and `Placed` types. A component command returns timeline pieces.

  Removed from `@motionscript/sdk`: `TextSelection`, `TextSelectionProps`, `TextRange`, `SelectionOverrides`, `AudioScope` and `AudioClip`.

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

## 0.1.0-alpha.5

### Patch Changes

- da6f97a: Every package ships a `NOTICE`, and a browser build lists what it bundles.

  - Each tarball carries the repository `NOTICE`: the copyright line and the MIT attributions for the noise functions in `skia-render`'s fractal-noise fill (David Hoskins' "Hash without Sine", Inigo Quilez's 2D simplex noise).
  - `@motionscript/canvaskit` ships `THIRD_PARTY_NOTICES.txt` with the licences of the libraries compiled into the binary: FreeType, HarfBuzz, ICU 74, zlib, libpng, Brotli, WOFF2, Emscripten and musl.
  - `dist/browser/manifest.json` gains `thirdParty`, the packages the browser build bundled (`name`, `version`, `license`), and their licence and NOTICE files are written to `dist/browser/THIRD_PARTY_LICENSES.txt`. `@motionscript/browser` bundles mediabunny (MPL-2.0, unmodified; source at https://github.com/Vanilagy/mediabunny), esbuild-wasm and three; `@motionscript/math` bundles MathJax.

- 1778355: The published packages carry what a user needs and say what they are.

  - `@motionscript/code` no longer ships `dist/tests/diff.bench.*`, and `@motionscript/math` no longer ships `dist/tests/harness.*` or `mathjax.setup.*`: test helpers under a `tests` folder are left out of every package's build.
  - `@motionscript/sdk`'s description no longer repeats core's, and `@motionscript/math`'s names the coordinate systems, plots, 3D graphs and network graphs it has as well as formulas.
  - The READMEs of `@motionscript/canvaskit`, `@motionscript/charts`, `@motionscript/geo`, `@motionscript/grids`, `@motionscript/skia-render` and `@motionscript/geography` say what to install, and `@motionscript/sdk`'s example now opens the document in an engine and plays it. Links between packages point at the repository, so they work on npm.

## 0.1.0-alpha.4

### Minor Changes

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

- 7f8b4d0: A stroke's `startCap` and `endCap` take a marker as well as a cap: `arrow`, `triangle`, `stealth`, `dot`, `box`, `diamond` or `bar`. Any open path, arc or custom shape can be an arrow.

  - A pointed head has its tip on the path's end and turns with the path. A marker is `capScale × weight` long (`capScale` is new, default `4`, and tweens) and shrinks to fit a contour shorter than it, so a head rides `start`/`end` as a path is drawn on.
  - A marker is drawn even where a dash pattern leaves the end bare, and a marked stroke is centred on its path whatever its `align`.
  - `StrokeMarker` and `StrokeEnd` are exported; `cap` still takes the three caps only.

- 96ed4d4: The `Line` node is removed. A `Path` draws what it drew.

  - The `line` node type is no longer registered and `Line` and `LineProps` are no longer exported. A document that names `line` fails to build with `Unknown node type`. Write its points as a path instead: `<Line points={[[0, 0], [200, 0]]} />` is `<Path data="M 0 0 L 200 0" />`, and in a document a `path` node whose `data` is in the unit space of its box. A path's `y` runs down where a line's points ran up, and a face-value `Path` is centred on its own extent rather than drawn from the node's origin.
  - `shapeOutline` and `hasShapeOutline` no longer answer for `"line"`.
  - `Graphics2D.line` and the `line` op are unchanged: a custom node still draws a polyline with them, vertex `radius` and `closed` included.

### Patch Changes

- 217ae88: A host can keep a node looking exactly as it does when it moves it to another parent, as a design tool does. `reparentPlacementAt(root, path, parentPath, offsets)` (the player's `reparentPlacement`) carries `x`/`y` values the node takes under its parent now, its own and its moves' destinations, to the ones that put its centre at the same place under the new parent, and gives the turn to add to its rotation and the factor to scale it by so the two parents' own turn and scale, cameras included, are undone. It works through a freeform parent's padding and alignment and a parent's own coordinates, and answers `null` for a parent that arranges its children in a run or a grid. `flowOps.freeSlot` says where a freeform arrangement puts one more item.

## 0.1.0-alpha.3

### Patch Changes

- 6697bb4: Every chart command runs from a document.

  - Thirteen of the twenty chart commands returned a composition of seekable parts rather than a `Command`, so a document naming one failed to compile with `TypeError: made.at is not a function`: `enter` on all three charts, `showSeries`, `hideSeries` and `spotlightSeries` on the line and bar charts, and `selectSlice`, `deselectSlice`, `selectOnlySlice` and `clearSelection` on the pie. So did `zoomTo` with a region naming neither axis, and `resetZoom` before any zoom. Each now returns a `Command` that lasts the duration it was given. A line or bar `enter` without a legend, whose beats end before that, holds its last frame for the rest of it.
  - `@motionscript/sdk/component` gains `asCommand(part, duration?)`, which makes a composition built with `at`, `sequence`, `together`, `hold`, `compose` or `drive` the `Command` a `@command()` method returns. A part that ends before `duration` holds its last frame, and one that runs longer is played faster, so the command always ends where the part does.
  - A line chart's first `zoomTo` from an auto axis tweens. It started from the unset range and ticks, which the axis tween steps at the midpoint, so the first zoom cut halfway through and only later ones moved. A zoom, and `resetZoom`, now start from the range and ticks the axis draws.

- ffd26fd: A `protein`'s `color` now paints. The prop resolves to an RGBA tuple when it is written, and `hexOf` turned anything that was not a string into `#ffffff`. So `colorScheme: 'uniform'` painted every atom, bond, tube and ribbon white whatever `color` was, the `residue` scheme's fallback was white, and a tween of `color` changed nothing. `hexOf` now writes any `Color` as hex through `colorOps`, so `color` drives `uniform` and the fallbacks, and a change to it rebuilds the cached tints. The `element`, `chain`, `secondary` and `residue` colours are unchanged.

  `colorOps` is now exported from `@motionscript/sdk`, and it gains `hex(value)`, which writes any `Color` as `#rrggbb`, or as `#rrggbbaa` when it is not opaque.

- 59c9944: A subclass that redeclares a `@property` or a `@command()` its base already declares now overrides it. `getPropertyMeta` and `getCommandMeta` kept the base's declaration and dropped the subclass's, so a redeclared default, mapper, tween or editor option, or a command's `args` and `name`, never took effect. The most-derived declaration of each key now wins, whole, in the position the base gave it, and an inherited key the subclass does not redeclare is kept as declared. `Registry.describe`, a node type's command table and a new instance's values all read that one declaration.

  A bare `Globe` now starts at its own camera and key light (orbit −10, elevation 25, zoom 2.8, ambient 0.55, key 1.9) rather than `Canvas3D`'s (35, 20, 12, 0.45, 2.4), which framed it as a small disc twelve radii away. A bare `Protein` likewise starts at elevation 18, zoom 2.6, ambient 0.55 and key 1.6. `describe("graph3d")` no longer reports `Canvas3D`'s defaults for `orbit`, `elevation` and `zoom`, which a graph derives from `camera.initialPosition`.

## 0.1.0-alpha.2

### Patch Changes

- 0227e28: A command published under a key of its own, `@command({ key: "press" }) pulse()`, runs the method it decorates. The registry recorded the key as the method to call, so dispatching it from a document called whatever the class had under that name: a prop (`Command "press" needs a "press" method`), an inherited method, or nothing. `CommandMeta` now carries `method` beside `key`, and `Registry.addNode` stores it as `NodeCommandEntry.method`. A command whose key is a core command's but whose method is not is no longer taken for the core command when compile decides whether it reads or writes layout. A command declared without a `key` is unchanged.

## 0.1.0-alpha.1

### Minor Changes

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

- 59cecba: Ship a browser build in `dist/browser/`, like every other package: one ES module per export (`.`, `./component`, `./jsx-runtime`, `./jsx-dev-runtime`) and a `manifest.json` mapping each to its file. It imports `@motionscript/core` rather than bundling it, so an import map names core once and the SDK, the backend and every kit share it.

  `@motionscript/core` is now a peer dependency of the SDK rather than a dependency, as it is of everything else built on core. npm and pnpm install a missing peer for you; with a package manager that does not, add `@motionscript/core` beside `@motionscript/sdk`.

## 0.1.0-alpha.0

Initial release.
