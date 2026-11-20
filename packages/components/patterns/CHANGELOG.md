# @motionscript/patterns

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

## 0.1.0-alpha.4

### Minor Changes

- 3eefc7e: Package reshuffle.

  - `@motionscript/layout-grid` is now `@motionscript/grids` (`@motionscript/grids/kit`, and `packages/components/grids`), and its `LayoutGrid` base class is `ItemGrid` (`ItemGridProps`, `ITEM_GRID_TYPES`). `RectangularGrid`, `RadialGrid`, `PathGrid` and `SphereGrid` keep their names and document keys. Update the dependency, the imports, and any `@motionscript/layout-grid/kit` specifier a copied component carries.
  - `@motionscript/geo-data` is now `@motionscript/geography`. The data format on disk (`data/v1/…`) is unchanged, so `@motionscript/geo` reads it as before and a host that serves `@motionscript/geo-data/data` serves `@motionscript/geography/data` the same way.
  - `@motionscript/ui` is removed: its `Switch`, `Button`, `Window` and `Cursor` nodes, and the `ControlNode` base class, no longer ship. They are plain nodes over `@motionscript/sdk`, so a project that needs one writes its own and shapes it to taste.
  - `@motionscript/patterns` is new. It holds the pattern nodes (`LineGridPattern`, `DotGridPattern`, `GridPattern`, `ViewportPattern`) that `@motionscript/core` and `@motionscript/sdk` no longer ship.

### Patch Changes

- a6c042d: `LineGridPattern` and `DotGridPattern` now put a line (or a dot column and row) on every edge of their box, whatever the number of cells. This changes how existing scenes with an odd `divisions × subdivisions` look: the lattice was centred on the box, so `divisions: 1` drew a single line through the middle and `divisions: 3` drew three lines with none on the edges, where a grid of `divisions: 4` has always drawn five. The lattice now starts at the near edge, and with an odd `divisions` and an even `subdivisions` (such as `3` and `2`) the major lines are the division lines, edges included, rather than the middle ones. A grid with an even `divisions`, and `GridPattern`'s world-anchored lattice, are drawn exactly as before.
