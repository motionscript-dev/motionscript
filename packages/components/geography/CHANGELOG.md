# @motionscript/geography

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

- ad28707: Component kit fixes.

  - Charts: a bar chart maps its columns across the plot panel as laid out (and takes the line chart's top headroom), so a column ends on its marker's grid line. A pie chart's wedges, labels and legend follow `data` and the palette once they are set. A restated value-axis or y/x-axis `range` or `ticks` in `to()` rescales continuously from the axis as drawn, instead of cutting at the midpoint. Without a legend (or without series) the entrance keeps that beat's share, so the call-out and legend land where the slot lays them out. A constant line series gets a scale with width, a `NaN` or infinite cell reads as 0, and tick captions gain decimals when the step is finer than 0.1.
  - Code: the compiled highlighter is cached per style object, so two styles sharing a name no longer colour alike. A `CodeRanges` chain serialises as its ranges, so a stored `highlight` target selects what it did before it was saved.
  - LaTeX: seeking from inside a morph to a time before it restores the source formula instead of leaving the last morph frame.
  - Geo: custom border rings are wound for d3, so a GeoJSON counter-clockwise ring draws as the small region it encloses; a great-circle path between antipodal points runs over the north pole instead of wherever rounding lands.
  - Audio: bottom-aligned waveform bars stand on the floor of the box instead of hanging from the top.
  - `Code` and `Latex` take an optional props bag, so `new Registry({ nodes: NODES })` and `createBrowserEngine({ nodes: NODES })` type-check without a cast.

- e818c6e: A `Globe` fades its markers, holds its camera and map to the ranges it advertises, and refuses 3D children. `GeoBorder` documents that `start` and `end` trim the fill too.

  - A marker's `opacity` was parsed and clamped and then only tested against 0; a marker at 0.5 drew fully opaque. It now reaches the material: instance colours carry no alpha, so markers are drawn together per distinct opacity, and a list of opaque markers is still one draw.
  - `zoom` below 1.02 drew as 1.02, so an `orbitTo` to the advertised minimum of 0.2 appeared to stall. `zoom` is now stored at 1.02 or more and `orbitTo` advertises 1.02. `elevation` is stored within ±89, and `resolution` is advertised as 256 to 2048 and a larger value bakes a 2048-wide map instead of allocating a 16384-wide one.
  - A 3D node parented to a `Globe`, which was validated and never drawn, is now refused. The inherited viewport settings (`showGrid`, `shadows`, `tone`, `exposure`, `post`) stay listed and stay inert, and the kit README says so.
  - The kit README states that the `markers` and `arcs` lists are JSON text and snap rather than tween, and that `GeoBorder`'s `start` and `end` trim the fill and overlay as well as the outline.

- 7c07443: `to()` maps a prop's destination once, so a mapper that is not idempotent no longer moves the prop twice as far.

  - A numeric prop behind a mapper was interpolated between stored values and then written through the setter, which ran the mapper on every step again: with `mapper: (v) => v * 2`, `to({ dbl: 10 })` ended at 40 and was at 20 halfway, and a second tween started from the wrong place. A string that snaps at the end was mapped twice the same way. The destination is now mapped once and every step is stored as it is, which is what a prop with a `tween` already did. A clamp behaves as before for any ease that stays between the two ends.
  - An ease that overshoots (`back`, `elastic`) is no longer held by a mapper alone. A prop that must stay in range says so in its `tween`, as `Globe`'s `elevation` and `zoom` now do, so they still stop at 89° and 1.02 under an overshooting ease.

## 0.1.0-alpha.3

### Patch Changes

- 59c9944: A subclass that redeclares a `@property` or a `@command()` its base already declares now overrides it. `getPropertyMeta` and `getCommandMeta` kept the base's declaration and dropped the subclass's, so a redeclared default, mapper, tween or editor option, or a command's `args` and `name`, never took effect. The most-derived declaration of each key now wins, whole, in the position the base gave it, and an inherited key the subclass does not redeclare is kept as declared. `Registry.describe`, a node type's command table and a new instance's values all read that one declaration.

  A bare `Globe` now starts at its own camera and key light (orbit −10, elevation 25, zoom 2.8, ambient 0.55, key 1.9) rather than `Canvas3D`'s (35, 20, 12, 0.45, 2.4), which framed it as a small disc twelve radii away. A bare `Protein` likewise starts at elevation 18, zoom 2.6, ambient 0.55 and key 1.6. `describe("graph3d")` no longer reports `Canvas3D`'s defaults for `orbit`, `elevation` and `zoom`, which a graph derives from `camera.initialPosition`.

## 0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- 59cecba: Build on `@motionscript/sdk` instead of `@motionscript/core`. The peer dependency is now `@motionscript/sdk`, every import goes through it (and `@motionscript/sdk/component` for the component machinery), and the browser build leaves `@motionscript/sdk` an import, so an import map names it once. A component copied with `ms add` imports the SDK too, and its registry item depends on `@motionscript/sdk` rather than `@motionscript/core`. `@motionscript/charts/kit` re-exports `@motionscript/sdk/component` where it re-exported `@motionscript/core/component`.

## 0.1.0-alpha.0

Initial release.

## Before the merge

The entries below belong to the data-only `@motionscript/geography` that this package
absorbed. The kit's own history is above, under its former name `@motionscript/geo`.

### 0.1.0-alpha.7

### 0.1.0-alpha.6

### 0.1.0-alpha.5

#### Patch Changes

- da6f97a: Every package ships a `NOTICE`, and a browser build lists what it bundles.

  - Each tarball carries the repository `NOTICE`: the copyright line and the MIT attributions for the noise functions in `skia-render`'s fractal-noise fill (David Hoskins' "Hash without Sine", Inigo Quilez's 2D simplex noise).
  - `@motionscript/canvaskit` ships `THIRD_PARTY_NOTICES.txt` with the licences of the libraries compiled into the binary: FreeType, HarfBuzz, ICU 74, zlib, libpng, Brotli, WOFF2, Emscripten and musl.
  - `dist/browser/manifest.json` gains `thirdParty`, the packages the browser build bundled (`name`, `version`, `license`), and their licence and NOTICE files are written to `dist/browser/THIRD_PARTY_LICENSES.txt`. `@motionscript/browser` bundles mediabunny (MPL-2.0, unmodified; source at https://github.com/Vanilagy/mediabunny), esbuild-wasm and three; `@motionscript/math` bundles MathJax.

- 1778355: The published packages carry what a user needs and say what they are.

  - `@motionscript/code` no longer ships `dist/tests/diff.bench.*`, and `@motionscript/math` no longer ships `dist/tests/harness.*` or `mathjax.setup.*`: test helpers under a `tests` folder are left out of every package's build.
  - `@motionscript/sdk`'s description no longer repeats core's, and `@motionscript/math`'s names the coordinate systems, plots, 3D graphs and network graphs it has as well as formulas.
  - The READMEs of `@motionscript/canvaskit`, `@motionscript/charts`, `@motionscript/geo`, `@motionscript/grids`, `@motionscript/skia-render` and `@motionscript/geography` say what to install, and `@motionscript/sdk`'s example now opens the document in an engine and plays it. Links between packages point at the repository, so they work on npm.

### 0.1.0-alpha.4

#### Minor Changes

- 3eefc7e: Package reshuffle.

  - `@motionscript/layout-grid` is now `@motionscript/grids` (`@motionscript/grids/kit`, and `packages/components/grids`), and its `LayoutGrid` base class is `ItemGrid` (`ItemGridProps`, `ITEM_GRID_TYPES`). `RectangularGrid`, `RadialGrid`, `PathGrid` and `SphereGrid` keep their names and document keys. Update the dependency, the imports, and any `@motionscript/layout-grid/kit` specifier a copied component carries.
  - `@motionscript/geo-data` is now `@motionscript/geography`. The data format on disk (`data/v1/…`) is unchanged, so `@motionscript/geo` reads it as before and a host that serves `@motionscript/geo-data/data` serves `@motionscript/geography/data` the same way.
  - `@motionscript/ui` is removed: its `Switch`, `Button`, `Window` and `Cursor` nodes, and the `ControlNode` base class, no longer ship. They are plain nodes over `@motionscript/sdk`, so a project that needs one writes its own and shapes it to taste.
  - `@motionscript/patterns` is new. It holds the pattern nodes (`LineGridPattern`, `DotGridPattern`, `GridPattern`, `ViewportPattern`) that `@motionscript/core` and `@motionscript/sdk` no longer ship.

### 0.1.0-alpha.3

#### Patch Changes

- 98ea74b: `@motionscript/geo-data` packs from a fresh checkout. `data/` is generated rather than committed, and `prepack` only verified it, so a publish from a clean tree, as the release workflow's is, failed. `prepack` now generates `data/` when it is missing, from the Natural Earth sources `sources.lock.json` pins by tag and sha256, and verifies it either way. A downloaded source is cached only once its checksum matches.

### 0.1.0-alpha.2

### 0.1.0-alpha.1

### 0.1.0-alpha.0

Initial release.
