# @motionscript/math

## 0.1.0-alpha.8

## 0.1.0-alpha.7

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

- 62eb615: `surfacePlot3d` takes `floorShadow`: the opacity, 0 to 1, of a flat copy of the surface laid on the floor of its axes, coloured by the height above it. Zero, the default, draws none.

## 0.1.0-alpha.4

### Minor Changes

- 7f8b4d0: `@motionscript/math` is a new kit, and the `Latex` node now lives in it. Import it from there:

  ```diff
  - import { Latex, NODES } from "@motionscript/latex";
  + import { Latex, NODES } from "@motionscript/math";
  ```

  - The node, its `latex` key, its props, `morphTo` and the helpers (`buildLatexPath`, `LatexError`, `defaultLatexMorph`) are unchanged, so a document that names `latex` needs no edit. `ms add latex` now copies a node that imports `@motionscript/math`.
  - `@motionscript/math/kit` holds what a copied node imports rather than copies, and `@motionscript/math/tex` the typeset-math half alone.
  - `@motionscript/latex` and `@motionscript/plot` are no longer released. Their published versions stay on npm as they are.

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

- 7f8b4d0: A formula's parts can be named, and marks can be drawn on them.

  - Every piece of a `latex` formula's source is a part: `partColors` colours one by its source (`{ part: 'x^2', color: '#facc15' }`), `colorTo` animates that, and `partBounds(part)` says where it is. A morph now carries a term both formulas write as one, with its colour.
  - `written` writes a formula on glyph by glyph, each outlined and then filled; `writeTo` animates it.
  - `latexMatrix` typesets a matrix from its `entries` in the `brackets` it is given; each entry is a part, and `entriesTo` morphs to new ones.
  - `curlyBrace`, `emphasisMark` (box, circle, underline, cross) and `angleMark` annotate. The first two follow a node, or one part of a formula, by id and slide to another with `retargetTo`; a brace with no target spans two points.
  - A label written between dollar signs is typeset: on a brace, an angle, a plot point, and an axis.
  - `@motionscript/math/kit` exports `FollowMark`, `quadOf` and `findLatexParts` for a custom mark.

- 7f8b4d0: MathJax loads only when a scene typesets a formula.

  - MathJax and its font are a module of their own, imported once by `loadMathJax()`. A formula node, and a graph, point, brace or angle whose label is written between dollar signs, declares the `math:mathjax` loader (`MATHJAX_LOADER`), which a host waits for before layout; a scene without one never downloads or parses MathJax.
  - Code that typesets outside a scene awaits `loadMathJax()` first. Before then `buildLatexPath` throws `LatexNotLoaded`, `latexPartNames` returns nothing, and `mathJaxLoaded()` says whether it has arrived.

- 7f8b4d0: Network graphs and sample spaces.

  - `networkGraph`: vertices and edges arranged in a circle, by springs, as a tree or in a grid, directed or not. `arrangeTo` moves every vertex to where another arrangement puts it, and `colorTo` colours a vertex or an edge (`a-b`).
  - `sampleSpace`: a probability's whole cut into parts whose areas are their probabilities, named by braces, with `divideTo` to move the cuts.

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

### Patch Changes

- `@motionscript/math/kit` loads when it is the first part of the kit imported. The `Latex` node reached the kit barrel back for its helpers, so a host entering through `./kit` (a browser build loaded by import map, say) ran its decorators before `OUTLINE_TRIM` existed and the import failed with `OUTLINE_TRIM is not iterable`.
- 217ae88: A transformed `numberPlane` rules its grid at most four times as far as its own ranges reach, so a plane squeezed onto a line folds its grid into a narrowing band. Before, as the determinant neared zero, the grid's range grew as one over it, the box filled with lines (a solid wash, and slow frames), and then jumped back to the plain ranges once the plane was flat.
- ad28707: Component kit fixes.

  - Charts: a bar chart maps its columns across the plot panel as laid out (and takes the line chart's top headroom), so a column ends on its marker's grid line. A pie chart's wedges, labels and legend follow `data` and the palette once they are set. A restated value-axis or y/x-axis `range` or `ticks` in `to()` rescales continuously from the axis as drawn, instead of cutting at the midpoint. Without a legend (or without series) the entrance keeps that beat's share, so the call-out and legend land where the slot lays them out. A constant line series gets a scale with width, a `NaN` or infinite cell reads as 0, and tick captions gain decimals when the step is finer than 0.1.
  - Code: the compiled highlighter is cached per style object, so two styles sharing a name no longer colour alike. A `CodeRanges` chain serialises as its ranges, so a stored `highlight` target selects what it did before it was saved.
  - LaTeX: seeking from inside a morph to a time before it restores the source formula instead of leaving the last morph frame.
  - Geo: custom border rings are wound for d3, so a GeoJSON counter-clockwise ring draws as the small region it encloses; a great-circle path between antipodal points runs over the north pole instead of wherever rounding lands.
  - Audio: bottom-aligned waveform bars stand on the floor of the box instead of hanging from the top.
  - `Code` and `Latex` take an optional props bag, so `new Registry({ nodes: NODES })` and `createBrowserEngine({ nodes: NODES })` type-check without a cast.

- 1be0249: A formula MathJax cannot typeset now throws a `LatexError`, the same in a browser and in Node.

  MathJax does not throw on malformed TeX; it typesets an error box. In a browser `buildLatexPath` then returned no tokens for `\fra`, `\frac{a`, `{` or `\badcommand{x}`, so nothing was drawn and nothing was reported, while the DOM-free adaptor returned one wide token that drew as a filled bar. Both now detect MathJax's error node and throw `LatexError`, which carries the `latex` source and MathJax's `reason`. `\require` is an error too, since only the listed TeX packages are loaded. A `Latex` node whose formula cannot be typeset keeps throwing on every read instead of reading as blank after the first.

- 55a1ed3: `to` and `morphTo` on a `Latex` node that is not in a tree run their duration and write nothing, as every other command does. They used to write `latex` on the loose node when driven directly; a document could not reach this, since the validator rejects a command that runs before its target is present.
- 217ae88: A point, tangent or guide inside a `functionPlot` is drawn over the curve. A mark's stroke is its ink, so it is now painted before the mark's children; before, it was painted last, as a shape's outline is, and the curve ran across every dot and line riding it. A `Mark` subclass that strokes its ink its own way overrides the new `renderInk` hook rather than `renderStroke`, and one that paints no fill until its ink has an inside answers `paintsFill`.
