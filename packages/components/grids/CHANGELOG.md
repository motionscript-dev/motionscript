# @motionscript/grids

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

- 3eefc7e: Package reshuffle.

  - `@motionscript/layout-grid` is now `@motionscript/grids` (`@motionscript/grids/kit`, and `packages/components/grids`), and its `LayoutGrid` base class is `ItemGrid` (`ItemGridProps`, `ITEM_GRID_TYPES`). `RectangularGrid`, `RadialGrid`, `PathGrid` and `SphereGrid` keep their names and document keys. Update the dependency, the imports, and any `@motionscript/layout-grid/kit` specifier a copied component carries.
  - `@motionscript/geo-data` is now `@motionscript/geography`. The data format on disk (`data/v1/…`) is unchanged, so `@motionscript/geo` reads it as before and a host that serves `@motionscript/geo-data/data` serves `@motionscript/geography/data` the same way.
  - `@motionscript/ui` is removed: its `Switch`, `Button`, `Window` and `Cursor` nodes, and the `ControlNode` base class, no longer ship. They are plain nodes over `@motionscript/sdk`, so a project that needs one writes its own and shapes it to taste.
  - `@motionscript/patterns` is new. It holds the pattern nodes (`LineGridPattern`, `DotGridPattern`, `GridPattern`, `ViewportPattern`) that `@motionscript/core` and `@motionscript/sdk` no longer ship.

### Patch Changes

- 7f8b4d0: A node can give its children coordinates of its own, which is what a coordinate system needs: a child's `x`/`y` are then in the parent's units and the child keeps its size.

  - A parent answers `_planeOf(child)` with a `ChildPlane` (`toOffset` and `toCoords`, exported). Paint, `global`, the anchor getters, `moveTo({ target })` and `parentPlanePointAt` all read it, and the last two answer in the parent's coordinates. A node whose parent publishes none is unchanged.
  - `childPlanePointAt(root, path, point)`, and `childPlanePoint` on the player, say where a point lands in the coordinates a node positions its children in, for a host placing a node that is not there yet. They answer `null` for a node whose children are in pixels, and `_planeOf(null)` is what they ask.
  - `findNode2D(from, id)` and `frameIn(host, node)` are exported from the SDK, for a node that follows another by id. `@motionscript/grids` now uses them and still exports both names.

- e78f716: Kit gaps in waveforms, item grids, graphs and protein node.

  - `@motionscript/audio`: documents that the host supplies the baked envelope and states its JSON form. `AudioEnvelope.magnitude` and `speaker` are typed `ArrayLike<number>`, which accepts the plain arrays a document stores as well as typed arrays. The package description no longer claims the meter responds to a signal.
  - `@motionscript/grids`: the grids' descriptors name `children: "freeform"`, the one answer that is true of slot-placed children, in place of `flow` and `grid`.
  - `@motionscript/molecule`: `Protein` refuses children, as its descriptor says, and declares `quality` non-animatable.
  - `@motionscript/plot`: new `curveEquationIssues`, `surfaceEquationIssues` and `equationIssues` return a `ValidationIssue` for each equation whose expression does not compile and so is not drawn, which `validateDocument` cannot see. The `Canvas3D` scene props that `Graph3D` inherits and ignores are documented in its docs and a README.

## 0.1.0-alpha.3

## 0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- 59cecba: Build on `@motionscript/sdk` instead of `@motionscript/core`. The peer dependency is now `@motionscript/sdk`, every import goes through it (and `@motionscript/sdk/component` for the component machinery), and the browser build leaves `@motionscript/sdk` an import, so an import map names it once. A component copied with `ms add` imports the SDK too, and its registry item depends on `@motionscript/sdk` rather than `@motionscript/core`. `@motionscript/charts/kit` re-exports `@motionscript/sdk/component` where it re-exported `@motionscript/core/component`.

## 0.1.0-alpha.0

Initial release.
