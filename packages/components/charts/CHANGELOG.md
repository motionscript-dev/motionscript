# @motionscript/charts

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

### Patch Changes

- d8ae489: A chart legend's entries now open and close from their own width. A series that started hidden stayed zero-width for the whole `showSeries` move and snapped open at the end, and a `hideSeries` that was seeked to straight away (a scrub or an export) collapsed at zero width, while the same hide played from before shrank from the measured width. An entry's width is now measured from its caption and swatch at any reveal, so playing and seeking give the same frame, and a fully shown entry is laid out exactly as before.
- 96d49af: A pie ring's wedge outline and shadow can be painted with an image. `PieRing` declared each slice fill and the leader stroke only, so an image in `ring.stroke` or in a `ring.shadow` fill was never loaded and the renderer failed on it. Both are now declared with the rest of the ring's paints.
- ad28707: Component kit fixes.

  - Charts: a bar chart maps its columns across the plot panel as laid out (and takes the line chart's top headroom), so a column ends on its marker's grid line. A pie chart's wedges, labels and legend follow `data` and the palette once they are set. A restated value-axis or y/x-axis `range` or `ticks` in `to()` rescales continuously from the axis as drawn, instead of cutting at the midpoint. Without a legend (or without series) the entrance keeps that beat's share, so the call-out and legend land where the slot lays them out. A constant line series gets a scale with width, a `NaN` or infinite cell reads as 0, and tick captions gain decimals when the step is finer than 0.1.
  - Code: the compiled highlighter is cached per style object, so two styles sharing a name no longer colour alike. A `CodeRanges` chain serialises as its ranges, so a stored `highlight` target selects what it did before it was saved.
  - LaTeX: seeking from inside a morph to a time before it restores the source formula instead of leaving the last morph frame.
  - Geo: custom border rings are wound for d3, so a GeoJSON counter-clockwise ring draws as the small region it encloses; a great-circle path between antipodal points runs over the north pole instead of wherever rounding lands.
  - Audio: bottom-aligned waveform bars stand on the floor of the box instead of hanging from the top.
  - `Code` and `Latex` take an optional props bag, so `new Registry({ nodes: NODES })` and `createBrowserEngine({ nodes: NODES })` type-check without a cast.

- 75b6908: Fixes in document validation, the clip timeline and the expression language.

  - `validateDocument` reports tree and command issues at the row's place in the document. A malformed row earlier in `nodes` or `commands` used to shift every later path by one.
  - The parts a command writes on a node's own children (a chart's ring, legend or bars) are restored to what they were built with before the command starts and after a seek back, so a frame no longer depends on how the playhead arrived. The chart legend's per-series reveal is now one slot, so the timeline can restore it.
  - A child that enters before its parent is baselined once the parent has mounted it, so it keeps what it inherits (a text style, for example) instead of the pre-attach values.
  - A row that an animated `removeChildAt` takes out of its parent is back in place before the command starts, in a fresh build and after a scrub alike.
  - An unknown `targetId` is one error naming it for every node-scoped command (`to`, `set`, `save`, `moveTo`, component commands). Global-table commands used to be skipped silently, and named ones blamed the node type.
  - Instant `removeChildAt` detaches the removed subtree, as `remove()` and `clear()` do.
  - Expressions: `toString`, `constructor`, `__proto__` and the other `Object.prototype` names are unknown functions and constants rather than a `TypeError`, in the shared parser and the plot kit (and `alignmentOps.resolve` rejects them as `isKey` does). A blank string operand is `NaN`, not `0`. `step` and `smoothstep` propagate `NaN`, and `smoothstep` with equal edges is a step at the edge. Arity errors say "1 argument". `renameRefs` hands its callback the trimmed reference name.

## 0.1.0-alpha.3

### Patch Changes

- 6697bb4: Every chart command runs from a document.

  - Thirteen of the twenty chart commands returned a composition of seekable parts rather than a `Command`, so a document naming one failed to compile with `TypeError: made.at is not a function`: `enter` on all three charts, `showSeries`, `hideSeries` and `spotlightSeries` on the line and bar charts, and `selectSlice`, `deselectSlice`, `selectOnlySlice` and `clearSelection` on the pie. So did `zoomTo` with a region naming neither axis, and `resetZoom` before any zoom. Each now returns a `Command` that lasts the duration it was given. A line or bar `enter` without a legend, whose beats end before that, holds its last frame for the rest of it.
  - `@motionscript/sdk/component` gains `asCommand(part, duration?)`, which makes a composition built with `at`, `sequence`, `together`, `hold`, `compose` or `drive` the `Command` a `@command()` method returns. A part that ends before `duration` holds its last frame, and one that runs longer is played faster, so the command always ends where the part does.
  - A line chart's first `zoomTo` from an auto axis tweens. It started from the unset range and ticks, which the axis tween steps at the midpoint, so the first zoom cut halfway through and only later ones moved. A zoom, and `resetZoom`, now start from the range and ticks the axis draws.

## 0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- 59cecba: Build on `@motionscript/sdk` instead of `@motionscript/core`. The peer dependency is now `@motionscript/sdk`, every import goes through it (and `@motionscript/sdk/component` for the component machinery), and the browser build leaves `@motionscript/sdk` an import, so an import map names it once. A component copied with `ms add` imports the SDK too, and its registry item depends on `@motionscript/sdk` rather than `@motionscript/core`. `@motionscript/charts/kit` re-exports `@motionscript/sdk/component` where it re-exported `@motionscript/core/component`.

## 0.1.0-alpha.0

Initial release.
