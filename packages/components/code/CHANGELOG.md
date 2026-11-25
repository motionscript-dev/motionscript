# @motionscript/code

## 1.0.0

### Patch Changes

- Updated dependencies [b05007b]
  - @motionscript/sdk@1.0.0

## 0.6.0

## 0.5.2

## 0.5.1

## 0.5.0

## 0.4.1-alpha.1

## 0.4.1-alpha.0

### Patch Changes

- @motionscript/sdk@0.4.1-alpha.0

## 0.4.0

### Minor Changes

- b996da5: Versioned component-API paths. `@motionscript/sdk/v1`, `@motionscript/sdk/v1/component` and each kit's `@motionscript/<kit>/v1` are the v1 API, today exactly the bare paths. A custom component imports the `/v1` paths, so a later major, which ships a v1 shim in the same engine, keeps it linking against one core. A bare import means the latest API, for npm users who follow the newest release. Each kit's `./kit` stays unstable and unversioned.

  A dynamic node's `require("@motionscript/sdk/v1")` resolves to the host's `sdk`, as `@motionscript/sdk` does, and the error for an unknown specifier now names `@motionscript/sdk/v1`. `@motionscript/sdk/v1/component` and the kit paths link through `dynamicNodes.modules`, like `@motionscript/sdk/component`.

## 0.4.0-alpha.0

### Minor Changes

- b996da5: Versioned component-API paths. `@motionscript/sdk/v1`, `@motionscript/sdk/v1/component` and each kit's `@motionscript/<kit>/v1` are the v1 API, today exactly the bare paths. A custom component imports the `/v1` paths, so a later major, which ships a v1 shim in the same engine, keeps it linking against one core. A bare import means the latest API, for npm users who follow the newest release. Each kit's `./kit` stays unstable and unversioned.

  A dynamic node's `require("@motionscript/sdk/v1")` resolves to the host's `sdk`, as `@motionscript/sdk` does, and the error for an unknown specifier now names `@motionscript/sdk/v1`. `@motionscript/sdk/v1/component` and the kit paths link through `dynamicNodes.modules`, like `@motionscript/sdk/component`.

## 0.3.0

### Minor Changes

- 39cb568: **Breaking:** each kit's root export is now its public surface, named one by one, and everything else moves to `./kit`, which every kit now has and which any release may change.

  - **The roots** carry the components and `NODES`, plus only what a host's setup or an author's code needs: audio's `AudioEnvelope` and `EMPTY_ENVELOPE`; charts' `CHART_STYLE_PRESETS` and `ChartStylePreset`; code's `defineCode`, `CodeStrategies`, `lines`, `word`, `CodeRanges`, `CodeRange`, `registerCodeTheme`, `initSyntaxHighlighter` and the theme types; geography's `geoRegistry`, `geoUrlSource`, `geoLoaderSource`, `GeoSource`, `GeoDefinition` and `GeoShape`; math's `loadMathJax`. A root name now leaves only after a deprecation, in the next major (the next minor while on 0.x).
  - **`./kit`** (`src/unstable.ts`) is all of each package: every name the root exported before, the shared helpers a copied component imports, and each component's parts. `code/kit` and `geography/kit` are new; the others now hold the component modules as well as the shared helpers.
  - **Copied components** (`registry.json`) import the kit from `<package>/kit` instead of the package root.

  Migration: no stored document is affected; node keys, props and values are unchanged. Code that imported a helper, a part or a type from a kit's root imports it from `<package>/kit` instead (for example `resolveXScale` from `@motionscript/charts/kit`, `canHighlight` from `@motionscript/code/kit`). A copied component made before this release that imports helpers from the package root changes that specifier to `<package>/kit`.

## 0.2.0

### Patch Changes

- e279864: **Breaking:** the component kits drop exports nothing used.

  - **math:** the hand-mirrored `*Props` interfaces of 24 components (`AngleMarkProps`, `CurlyBraceProps`, `EmphasisMarkProps`, `CurveAreaProps`, `DropLinesProps`, `PlotPointProps`, `RiemannSumProps`, `TangentLineProps`, `VectorArrowProps`, `PointsPlotProps`, `StreamLinesProps`, `TracedPathProps`, `VectorFieldProps`, `NetworkGraphProps`, `SampleSpaceProps`, `NumberLineProps`, `NumberPlaneProps`, `PolarPlaneProps`, `LatexMatrixProps`, `Axes3dProps`, `CurvePlot3dProps`, `PlotPoint3dProps`, `SurfacePlot3dProps`, `VectorArrow3dProps`), `FILL_PAINT`, `STROKE_PAINT`, `OUTLINE_TRIM` and `spaceOf` from `./kit`, and `LatexPathResult.commands`.
  - **charts:** `LineChartProps`, `BarChartProps`, `PieChartProps`, `PieRingProps`, `PieLegendProps`, `ChartBarsProps`, `CategoryAxisProps`, `ChartBorderProps`, `ChartCanvasProps`, `ChartLegendProps`, `VerticalAxisProps`, and from `./kit` `axisTweenTarget`, `resolvePalettePaint`, `legendShows`, `MarkerLabel`, `clampUnit` (use the SDK's `clamp`). `niceStep` and `enterBudget` stay reachable from `@motionscript/sdk/component`.
  - **audio:** `FullWaveformProps`, `LiveWaveformProps`, and `clamp01` from `./kit`.
  - **patterns:** `DotGridPatternProps`, `GridPatternProps`, `LineGridPatternProps`.
  - **code:** `DEFAULT_THEMES`, `splitTokensAt`, `LINE_ALIGN_CELLS`, `EDIT_ALIGN_CELLS`, and `phasesFor` (use `defaultCodePhases`). `ensureHighlighter`, `loadCodeLanguage`, `initSyntaxHighlighter` and `canHighlight` lose their ignored theme argument.
  - **grids:** the `findNode2D` and `frameIn` re-exports (import them from `@motionscript/sdk`), `ArrangementKind`, `PathGridShape`, `RectangularGridProps`, `RadialGridProps`, `PathGridProps`, `SphereGridProps`.
  - **geography:** `GeoBorderProps`.

  Migration: no stored document is affected; only TypeScript imports change. Code that imported a removed `*Props` interface states the props it passes inline, and code that used a removed helper uses the replacement named beside it above.

## 0.1.1-alpha.5

## 0.1.1-alpha.4

## 0.1.1-alpha.3

## 0.1.1-alpha.2

## 0.1.1-alpha.1

## 0.1.1-alpha.0

### Patch Changes

- e279864: **Breaking:** the component kits drop exports nothing used.

  - **math:** the hand-mirrored `*Props` interfaces of 24 components (`AngleMarkProps`, `CurlyBraceProps`, `EmphasisMarkProps`, `CurveAreaProps`, `DropLinesProps`, `PlotPointProps`, `RiemannSumProps`, `TangentLineProps`, `VectorArrowProps`, `PointsPlotProps`, `StreamLinesProps`, `TracedPathProps`, `VectorFieldProps`, `NetworkGraphProps`, `SampleSpaceProps`, `NumberLineProps`, `NumberPlaneProps`, `PolarPlaneProps`, `LatexMatrixProps`, `Axes3dProps`, `CurvePlot3dProps`, `PlotPoint3dProps`, `SurfacePlot3dProps`, `VectorArrow3dProps`), `FILL_PAINT`, `STROKE_PAINT`, `OUTLINE_TRIM` and `spaceOf` from `./kit`, and `LatexPathResult.commands`.
  - **charts:** `LineChartProps`, `BarChartProps`, `PieChartProps`, `PieRingProps`, `PieLegendProps`, `ChartBarsProps`, `CategoryAxisProps`, `ChartBorderProps`, `ChartCanvasProps`, `ChartLegendProps`, `VerticalAxisProps`, and from `./kit` `axisTweenTarget`, `resolvePalettePaint`, `legendShows`, `MarkerLabel`, `clampUnit` (use the SDK's `clamp`). `niceStep` and `enterBudget` stay reachable from `@motionscript/sdk/component`.
  - **audio:** `FullWaveformProps`, `LiveWaveformProps`, and `clamp01` from `./kit`.
  - **patterns:** `DotGridPatternProps`, `GridPatternProps`, `LineGridPatternProps`.
  - **code:** `DEFAULT_THEMES`, `splitTokensAt`, `LINE_ALIGN_CELLS`, `EDIT_ALIGN_CELLS`, and `phasesFor` (use `defaultCodePhases`). `ensureHighlighter`, `loadCodeLanguage`, `initSyntaxHighlighter` and `canHighlight` lose their ignored theme argument.
  - **grids:** the `findNode2D` and `frameIn` re-exports (import them from `@motionscript/sdk`), `ArrangementKind`, `PathGridShape`, `RectangularGridProps`, `RadialGridProps`, `PathGridProps`, `SphereGridProps`.
  - **geography:** `GeoBorderProps`.

  Migration: no stored document is affected; only TypeScript imports change. Code that imported a removed `*Props` interface states the props it passes inline, and code that used a removed helper uses the replacement named beside it above.

- Updated dependencies [e279864]
  - @motionscript/sdk@0.1.1-alpha.0

## 0.1.0

## 0.1.0-alpha.10

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

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

- c9535a6: `Code` can mark whole rows, beside dimming what is outside a range.

  - `highlightRows` (`target`, `color`, `radius`) lays a band behind every line a range touches, across the block and under the text. A second call slides and resizes the band onto its new rows; several ranges give a band each, and one with no counterpart fades. A band is tied to its lines, so it moves with them through an `append`, `insert` or `remove`.
  - `resetRowHighlight` fades the bands out.
  - `drawCode` takes the bands as optional fields of its state (`rowBands`, `rowsEdit`, `boxW`), so a caller that draws a listing itself is unaffected.

### Patch Changes

- 3ba3e98: A `code` node reports what it cannot highlight, follows its `language` and `theme`, reads Windows line endings, and diffs long edits within a budget.

  - An unknown language, a grammar whose import is rejected and an unknown theme name each logged nothing and fell back silently. Each now logs one `[Code]` warning per name, with the import's reason where there is one. `''`, `text` and `plaintext` mean plain text and stay silent.
  - A tweened or bound `theme` or `language` left the old colours once any listing command had run, because only `set()` re-tokenized. The listing now re-derives from `code`, `language` and `theme` on every read, and a theme-only change keeps the token ids a highlight names.
  - `\r\n` and a lone `\r` are line breaks, in `code`, in the text a command brings in and in `to({ code })`; they used to survive as a character at the end of each line. `normalizeSource` is exported from the engine barrel.
  - The kit's own commands (`append`, `prepend`, `insert`, `remove`, `replace`, `highlight`, `resetHighlight`, `to`) run their duration and write nothing on a node that is not in a tree.
  - Aligning the lines of an edit was quadratic (741 ms for 1,000 lines). Lines equal at either end and lines that occur once on both sides now anchor the alignment, and only the runs between anchors are compared, within `LINE_ALIGN_CELLS` per run and `EDIT_ALIGN_CELLS` per edit; a larger run leaves and enters as whole rows. `pnpm bench` measures it.

- ad28707: Component kit fixes.

  - Charts: a bar chart maps its columns across the plot panel as laid out (and takes the line chart's top headroom), so a column ends on its marker's grid line. A pie chart's wedges, labels and legend follow `data` and the palette once they are set. A restated value-axis or y/x-axis `range` or `ticks` in `to()` rescales continuously from the axis as drawn, instead of cutting at the midpoint. Without a legend (or without series) the entrance keeps that beat's share, so the call-out and legend land where the slot lays them out. A constant line series gets a scale with width, a `NaN` or infinite cell reads as 0, and tick captions gain decimals when the step is finer than 0.1.
  - Code: the compiled highlighter is cached per style object, so two styles sharing a name no longer colour alike. A `CodeRanges` chain serialises as its ranges, so a stored `highlight` target selects what it did before it was saved.
  - LaTeX: seeking from inside a morph to a time before it restores the source formula instead of leaving the last morph frame.
  - Geo: custom border rings are wound for d3, so a GeoJSON counter-clockwise ring draws as the small region it encloses; a great-circle path between antipodal points runs over the north pole instead of wherever rounding lands.
  - Audio: bottom-aligned waveform bars stand on the floor of the box instead of hanging from the top.
  - `Code` and `Latex` take an optional props bag, so `new Registry({ nodes: NODES })` and `createBrowserEngine({ nodes: NODES })` type-check without a cast.

## 0.1.0-alpha.3

### Patch Changes

- 4b23387: A `code` node draws the listing its props describe until its first command starts.

  - The structure, highlight and in-flight transitions the listing commands own live outside the props, and only a command that had started wrote them, so before the first one a frame showed whatever the last evaluation left: the end of every command. A listing appended to at 1 s drew the new rows from 0 s, and a `highlight` at 0.8 s, as in the README's own example, dimmed the listing from 0 s, jumped to full brightness when it started, then faded back. A seek back past an edit or a highlight also left it drawn mid-transition. Until a command applies, all three are now derived from the props, so a frame is the same however the playhead reached it, and a highlight still selects the tokens it was built against when a later edit returns the source to the same text.
  - The README says what the host supplies: a monospaced face under `fontFamily` (`Fira Mono` by default) in the engine's asset manifest, without which the listing draws no text or falls back to another registered face.

## 0.1.0-alpha.2

### Patch Changes

- 0227e28: A document's `remove` command on a `code` node erases its `target` range. It used to reach `Node.remove` instead of `Code.erase` and leave the listing as it was.

## 0.1.0-alpha.1

### Minor Changes

- 59cecba: Build on `@motionscript/sdk` instead of `@motionscript/core`. The peer dependency is now `@motionscript/sdk`, every import goes through it (and `@motionscript/sdk/component` for the component machinery), and the browser build leaves `@motionscript/sdk` an import, so an import map names it once. A component copied with `ms add` imports the SDK too, and its registry item depends on `@motionscript/sdk` rather than `@motionscript/core`. `@motionscript/charts/kit` re-exports `@motionscript/sdk/component` where it re-exported `@motionscript/core/component`.

## 0.1.0-alpha.0

Initial release.
