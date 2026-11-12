# @motionscript/audio

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

### Patch Changes

- ad28707: Component kit fixes.

  - Charts: a bar chart maps its columns across the plot panel as laid out (and takes the line chart's top headroom), so a column ends on its marker's grid line. A pie chart's wedges, labels and legend follow `data` and the palette once they are set. A restated value-axis or y/x-axis `range` or `ticks` in `to()` rescales continuously from the axis as drawn, instead of cutting at the midpoint. Without a legend (or without series) the entrance keeps that beat's share, so the call-out and legend land where the slot lays them out. A constant line series gets a scale with width, a `NaN` or infinite cell reads as 0, and tick captions gain decimals when the step is finer than 0.1.
  - Code: the compiled highlighter is cached per style object, so two styles sharing a name no longer colour alike. A `CodeRanges` chain serialises as its ranges, so a stored `highlight` target selects what it did before it was saved.
  - LaTeX: seeking from inside a morph to a time before it restores the source formula instead of leaving the last morph frame.
  - Geo: custom border rings are wound for d3, so a GeoJSON counter-clockwise ring draws as the small region it encloses; a great-circle path between antipodal points runs over the north pole instead of wherever rounding lands.
  - Audio: bottom-aligned waveform bars stand on the floor of the box instead of hanging from the top.
  - `Code` and `Latex` take an optional props bag, so `new Registry({ nodes: NODES })` and `createBrowserEngine({ nodes: NODES })` type-check without a cast.

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
