# @motionscript/math

Math for [Motion Script](https://motionscript.dev): coordinate systems whose
children sit in graph coordinates, plots of equations, the marks that go on a
graph, and typeset formulas that morph into one another.

Hand the kit's nodes to the engine through your project entry's `nodes`, and any
document that engine opens can name them by key:

```ts
// src/project.ts
import { NODES } from '@motionscript/math';

export const nodes = NODES;
```

## Exports

| Entry | Holds |
| --- | --- |
| `@motionscript/math` | Every component, `NODES`, and the kit below |
| `@motionscript/math/kit` | What the nodes share and a copied node imports rather than copies: the systems' and marks' helpers (`systemLayout`, `traced`, `drawMark`, the plane a system hands its marks), the coordinate map, the equation language, the sampler, and the LaTeX helpers |
| `@motionscript/math/tex` | The typeset-math half alone: `Latex`, `TEX_NODES` and its helpers |

## Nodes

Every node also has the shape commands (`moveTo`, `fadeTo`, `fillTo`,
`strokeTo`, `progressTo`, …).

| Key | What it is | Goes in | Own commands |
| --- | --- | --- | --- |
| `numberLine` | One axis with ticks and numbers | anywhere | `rangeTo({ range })` |
| `axes2d` | An x and a y axis, linear or log | anywhere | `rangeTo({ xRange, yRange })` |
| `numberPlane` | Axes over a full grid, square units | anywhere | `rangeTo`, `transformTo({ matrix })`, `warpTo({ warp })` |
| `polarPlane` | Rings and spokes about an origin | anywhere | `rangeTo({ radius })` |
| `functionPlot` | The curve of an equation | a system | `morphTo({ expression })`, `paramsTo({ params })`, `domainTo({ domain })` |
| `pointsPlot` | A line or closed shape through listed graph points | a system | `pointsTo({ points })` |
| `plotPoint` | A labelled dot, free or riding a plot | a system or a `functionPlot` | |
| `vectorArrow` | An arrow from `tail` to `head` | a system | `endpointsTo({ tail, head })` |
| `curveArea` | The region under a plot, or between two | a system, beside a `functionPlot` | `domainTo({ domain })` |
| `riemannSum` | Rectangles approximating that region | a system, beside a `functionPlot` | `refineTo({ dx })`, `domainTo({ domain })` |
| `tangentLine` | The tangent to a plot, or a secant with its run and rise | a `functionPlot` | |
| `dropLines` | Guides from a graph point to the axes | a system or a `functionPlot` | |
| `latex` | A typeset formula with nameable parts | anywhere | `morphTo({ latex })`, `partFillTo({ part, fill })`, `writeTo({ written })` |
| `latexMatrix` | A matrix typeset from its entries | anywhere | `entriesTo({ entries })`, and a formula's |
| `curlyBrace` | A brace along a node, a part of a formula, or two points | anywhere | `retargetTo({ on, part })` |
| `emphasisMark` | A box, circle, underline or cross on a node or a part | anywhere | `retargetTo({ on, part })` |
| `angleMark` | An angle's arc or square, with its label | anywhere | `radiusTo({ radius })` |
| `axes3d` | A 3D graph: three axes through a box of graph coordinates, z up, seen through its own camera | anywhere 2D (it is a `canvas3d`) | `rangeTo({ xRange, yRange, zRange })`, and a `canvas3d`'s `orbitTo` |
| `surfacePlot3d` | A surface: a height over x and y, or three parts in u and v | an `axes3d` | `morphTo({ expression })`, `paramsTo({ params })`, `domainTo({ uDomain, vDomain })` |
| `curvePlot3d` | A curve through space, three parts in t | an `axes3d` | `morphTo`, `paramsTo`, `domainTo({ domain })`, `progressTo({ start, end })` |
| `plotPoint3d` | A labelled dot, free or riding a surface | an `axes3d` or a `surfacePlot3d` | |
| `vectorArrow3d` | An arrow from `tail` to `head` | an `axes3d` | `endpointsTo({ tail, head })` |
| `vectorField` | A grid of arrows showing a field, `(P, Q)` in x and y | a system | `morphTo({ expression })`, `paramsTo({ params })` |
| `streamLines` | The lines a field carries a point along | a system | `flowTo({ phase })`, `morphTo`, `paramsTo` |
| `tracedPath` | The trail a point leaves as a value changes | a system | `traceTo({ value })`, and a plot's |
| `networkGraph` | Vertices and edges, arranged in a circle, by springs, as a tree or in a grid | anywhere | `arrangeTo({ arrangement })`, `partFillTo({ part, fill })` |
| `sampleSpace` | A probability's whole cut into parts whose areas are their probabilities | anywhere | `divideTo({ columnShares, rowShares })` |

A system is a `numberLine`, an `axes2d`, a `numberPlane` or a `polarPlane`. The
Goes in column is where each node is made to go; offering it only there is the
host's to do, since the engine is told only a node's key, entries and commands.
Nothing checks it when a document builds: a plot outside a system builds and
draws nothing.

Each node takes only the paints it draws. A node spreads the shape paints
(`fill`, `stroke` and the outline trim `start`, `end`, `progressTo`, `flash`) it
has a use for and leaves the rest out, so they are not offered: a plot, a tangent, an arrow or a brace is a line with
no fill; an area is a fill with no outline; a field is one stroke for every arrow
or line; a formula and a traced path reveal themselves (`writeTo`, `traceTo`)
rather than by trimming; a dot, a sample space and a Riemann sum have nothing a
trim would draw on. `shadow` stays on all of them.

## Coordinate systems

```ts
const document = {
  kind: 'composition',
  variables: [{ id: 't', value: 0 }],
  nodes: [
    { id: 'axes', type: 'axes2d', parentId: null, layerOrder: 0,
      props: { width: 800, height: 450, xRange: [-4, 4], yRange: [-2, 2], fontFamily: 'Inter' } },
    { id: 'curve', type: 'functionPlot', parentId: 'axes', layerOrder: 0, props: { expression: 'sin(x)' } },
    { id: 'dot', type: 'plotPoint', parentId: 'curve', layerOrder: 0, props: { x: '=[t]' } },
    { id: 'note', type: 'text', parentId: 'axes', layerOrder: 1,
      props: { x: 2, y: 1.5, text: 'y = sin x', fontSize: 24, fontFamily: 'Inter', fill: 'white' } },
  ],
  commands: [
    { id: 'a', type: 'progressTo', targetId: 'curve', at: 0, duration: 1, args: { end: 1 } },
    { id: 'b', type: 'variableTo', targetId: 't', at: 1, duration: 2, args: { value: 3.14 } },
    { id: 'c', type: 'rangeTo', targetId: 'axes', at: 3, duration: 1, args: { xRange: [0, 8] } },
  ],
};
```

- **A child's `x`/`y` are graph units, whatever the child is.** A text, an image
  or a shape dropped in a system sits at graph coordinates and keeps its own
  size; `moveTo` moves it in graph units; a range tween carries it. On a
  `numberLine`, `x` is a value on the line and `y` is pixels above it.
- **A mark is drawn through the system's map.** `functionPlot`, `pointsPlot`,
  `vectorArrow`, `curveArea`, `riemannSum`, `tangentLine` and `dropLines` are
  marks (`traced`): their geometry is in graph coordinates and their box is the tight box of
  their ink. A plot's or an arrow's own `x`/`y` shift it in graph units; a
  `tangentLine`'s and a `dropLines`'s `x` is where along the graph they are.
  Outside a system a graph unit is a pixel and a plot draws nothing.
- **Riding a plot.** A `plotPoint`, `tangentLine` or `dropLines` inside a
  `functionPlot` follows that plot, appears, moves and leaves with it, and is
  drawn over the curve: a mark's stroke is its ink, painted before its children
  rather than last as a shape's outline is (a mark drawn with `drawMark` that
  strokes its ink its own way passes its own `ink`). In the system instead, a
  point or guide names a plot by id in `on`, or none and is free. `curveArea`
  and `riemannSum` sit in the system beside the plots they read and name one in
  `on` (an area a second in `under`). A point that rides a plot
  takes its height from the curve and keeps its own `y` only where the curve has
  no value.
- **One value drives a scene through a variable.** Bind any graph prop with
  `"=[t]"` and animate `t` with `variableTo`; a formula may sit at any depth, so
  a `pointsPlot` corner can be `{ x: '=[t]', y: '=25/[t]' }`. `plotPoint.value`
  and `tangentLine.slope` can be read back as `[key.value]` and `[key.slope]`.
- **A system's `stroke` is its axis line and its `fill` its backdrop.** So
  `stroke.endCap` is the axis tip. Ticks, grid lines and numbers are drawn by the
  system itself; they are not child nodes. Drawn on with `progressTo`, the ticks
  and numbers appear as the line reaches them.
- **Numbers need a font.** A system's `fontFamily` is empty by default, which
  takes the scene's default text style; a scene with none has to set it, as any
  text does.
- **An axis crosses the other at its zero**, or at the nearest edge when zero is
  out of range or the other axis is logarithmic. A `step` of `0` picks a tidy
  spacing for the axis's length; a log axis is marked at the powers of ten.

## 3D graphs

```ts
nodes: [
  { id: 'axes', type: 'axes3d', parentId: null, layerOrder: 0, props: { width: 960, height: 540, labels: true, fontFamily: 'Inter' } },
  { id: 'bump', type: 'surfacePlot3d', parentId: 'axes', layerOrder: 0,
    props: { expression: '1.8 exp(-(x^2 + y^2) / 2)', colorScale: ['#1d4ed8', '#22c55e', '#facc15', '#ef4444'] } },
  { id: 'dot', type: 'plotPoint3d', parentId: 'bump', layerOrder: 0, props: { x: 0.8, y: -0.6, label: 'P' } },
],
commands: [
  { id: 'a', type: 'orbitTo', targetId: 'axes', at: 0, duration: 2, args: { orbit: 80, elevation: 32 } },
  { id: 'b', type: 'morphTo', targetId: 'bump', at: 2, duration: 1, args: { expression: '(x^2 - y^2) / 5' } },
],
```

- **A 3D graph is right-handed with z up.** The scene has y up, so graph x, y and
  z run along the scene's z, x and y: seen head-on, y is to the right and z is
  up, and the axes' default camera shows x coming toward the viewer.
- **An `axes3d` is its own viewport.** It is a `canvas3d` (camera, lights,
  `orbitTo`, a box on the stage), so it needs no canvas around it and cannot go
  inside one; a 3D shape you want beside the graph goes inside it instead.
- **The axes are a box, `xLength` by `yLength` by `zLength` scene units, centred
  in the scene**, showing the three ranges. An axis crosses the others at their
  zero, or at the nearest end of a range without one.
- **A child's `x`/`y`/`z` are graph units, whatever the child is**, and it keeps
  its own size and turn: a `sphere3d` at `x: 1, y: 2, z: 0.5` sits at that graph
  point, the built-in `moveTo` moves it in graph units, and `rangeTo` carries it.
- **A surface is held inside the axes.** A height that leaves the z range is
  drawn at its edge, and one with no value is drawn flat, so a pole does not tear
  the mesh. Left out, `uDomain` and `vDomain` are the axes' x and y ranges for a
  height and 0 to 1 for a parametric surface.
- **A point put inside a surface rides it**: its `x` and `y` say where, and its
  height is the surface's, which `surfaceValueAt(surface, x, y)` reads.
- **`colorScale` colours a surface by height** over the axes' z range, lowest
  first; without one it is painted in its `fill`, the plot blue unless given one
  (a `curvePlot3d` too). `meshLines` rules it each way.
- **A surface takes the mesh material props** (`opacity`, `roughness`, `wireframe`,
  …) and is lit by the axes' lights; it is drawn from both sides.
- **Lines are tubes and labels are cards.** A `curvePlot3d`'s and an axis's
  `thickness`, a point's `radius` and a label's `labelSize` are scene units, so
  they keep their size when a range changes. A label always faces the camera.
- **Moving the camera** is the canvas's `orbitTo({ orbit, elevation, zoom })`, or a
  `camera3d`'s `orbitTo` and `lookTo` when the scene has one.

| Written as | Is | Variables |
| --- | --- | --- |
| `sin(x) * cos(y)`, `z = x^2 - y^2` | a surface, as a height | `x`, `y` |
| `(cos(u) sin(v), sin(u) sin(v), cos(v))` | a parametric surface | `u`, `v` |
| `(cos(t), sin(t), t / 4)` | a space curve | `t` |

Any other name is a named value, as in a 2D plot (`surfaceParams`,
`spaceCurveParams`); `surfaceError` and `spaceCurveError` say why text will not draw.

## Equations

A `functionPlot`'s `expression` is read the way it is written:

| Written as | Is | Free variable, `domain` when not given |
| --- | --- | --- |
| `sin(x)`, `y = sin(x)` | a function of `x` | `x`, the system's width |
| `x = y^2` | a function of `y` | `y`, the system's height |
| `r = 1 + cos(theta)` | polar | `theta`, one turn |
| `(cos(t), sin(t))` | parametric | `t`, 0 to 1 |
| `x^2 + y^2 = 4` | implicit | drawn where it holds, over what the system shows |

- **The language is the engine's expression grammar under its own dialect**:
  bare names, trig in radians, `ln`, `log2`, `log10`, the hyperbolics, and the
  constants `pi`, `e`, `tau`, `phi`. Implicit multiplication (`2x`, `2(x + 1)`)
  and `^` work as in a document formula. It never evaluates text as code.
- **A name the equation does not know is a named value**, held in `params`:
  `{ expression: 'a * sin(k * x)', params: { a: 2, k: '=[speed]' } }`. One left
  unset is 1, so an equation draws as soon as it is written; `equationParams(source)`
  lists them for a host that draws a field for each. `paramsTo` animates them.
- **`morphTo` bends one curve into another**, of any kind into any kind: the two
  are blended point for point along their parameters.
- **Text that is not an equation draws nothing** and throws nothing, so a host can
  commit on every keystroke; `equationError(source)` gives the reason.
- **A curve is sampled adaptively** and broken at an asymptote or the edge of its
  domain, so `1/x`, `tan(x)` and `sqrt(x)` draw as they should.

## Planes, fields and trails

- **A number plane can be transformed.** `matrix` (`[[a, b], [c, d]]`, or flat)
  sends every point of the plane through a linear map about its origin, and
  `warp` (two parts in x and y, `(x + sin(y), y + sin(x))`) bends it by a
  function of its own points. The grid, the axes and everything on the plane go
  with it: a child's position, a plot's curve, a vector's ends. `transformTo`
  and `warpTo` animate them, each point travelling straight to where it ends up,
  and `warpTo({ warp: "" })` flattens the plane again. While it is transformed
  the plane leaves its flat self behind, faintly (`ghost`). The grid is ruled
  over whatever of the plane then falls in the box, up to four times its own
  ranges, so it stays full under a turn, a shear or a fourfold shrink, and a
  plane squeezed onto a line folds its grid into a narrowing band.
- **A polar plane is a plane with another ruling.** Its children are still at x
  and y, in the units its rings count, so `r = 1 + cos(theta)` in a
  `functionPlot`, a point or an arrow goes on it as on axes. `radius` is its
  outer ring, `spokes` how many divide the turn, and `angleUnit` writes them in
  degrees or as fractions of π.
- **An implicit equation is drawn where it holds.** `x^2 + y^2 = 4` in a
  `functionPlot` is traced over what the system shows. It has no parameter to
  bend along, so a morph to or from one changes over half way.
- **A field is two parts in x and y**, `(-y, x)`. A `vectorField` centres an
  arrow on each point of a grid `spacing` apart, as long as the field is strong
  there times `arrowScale` and never longer than the spacing; a `streamLines`
  follows the field from each of those points for `length` graph units. With a
  list of `strengthFills` both are painted by the field's strength, weakest
  first; without one, in the stroke's own paint.
  `streamLines.window` shows a stretch of each line and `flowTo({ phase })` sends
  the stretches along: one whole turn of `phase` runs every line end to end.
- **A traced path is a plot whose end follows a value.** It draws its equation
  from `from` to `value`; bind `value` to a variable (`"=[t]"`) and the trail
  grows as the variable is driven, or drive it with `traceTo({ value })`. `tail`
  keeps only its most recent stretch.

## Graphs and sample spaces

- **A network graph is its `vertices` (names) and `edges` (`{ from, to }`, or
  pairs).** Its `fill` paints the vertices and its `stroke` the edges; with
  `directed` each edge ends in an arrowhead, and an edge each way between two
  vertices bows apart. Labels are the vertices' names.
- **`arrangement` places the vertices**: `circular` (the first at the top,
  clockwise), `spring` (edges pull, every pair pushes; the same every time),
  `tree` (levels down from `root`, a parent over its children), `grid`. A vertex
  in `positions` is placed by hand, from -1 to 1 each way. `arrangeTo` moves every
  vertex to where another arrangement puts it. (`layout` is every node's own box,
  hence the other word.) `vertexPoints(graph, size)` says where each vertex is drawn.
- **`partFillTo({ part, fill })` paints a vertex by its name, or an edge written
  `a-b`**, arriving over the graph's own paint, as a formula's parts are painted;
  `partFills` holds them.
- **A sample space's `columnShares` cut it across** (any numbers, read as shares
  of their sum) **and each column's entry in `rowShares` cuts that column**
  (its upper share, 0 to 1), so each part's area is its probability. Braces name
  the columns below (`columnLabels`) and the rows on the left (`rowLabels`);
  `values` writes each part's probability in it; `divideTo` moves the cuts.
  `sampleParts(space, size)` gives each part's box and probability.

## Annotations

`curlyBrace`, `emphasisMark` (box, circle, underline, cross) and `angleMark`
work anywhere, not only on a graph. A brace or an emphasis mark names a node
in `on`, and optionally one `part` of a formula, and is drawn on it wherever
the two are in the tree; `retargetTo` slides it to another. A brace with no
`on` spans `tail` to `head`. An angle mark sits at its own position and sweeps
`fromAngle` to `toAngle` in degrees, so binding one to a variable opens it.
A label written between dollar signs is typeset, on these and on a plot point
or an axis. `FOLLOW_STATE`, `FOLLOW_COMMANDS` and `followedQuad` in
`@motionscript/math/kit` are what a custom mark of this kind is built on.

## Latex

The formulas below were published as `@motionscript/latex` up to
`0.1.0-alpha.3`; that package is no longer updated, and the same node, key and
exports are here.

```ts
import type { CompositionDocument } from '@motionscript/sdk';

export default {
  kind: 'composition',
  nodes: [
    { id: 'eq', type: 'latex', parentId: null, layerOrder: 0,
      props: { latex: 'a^2 + b^2 = c^2', fontSize: 64, fill: 'white' } },
  ],
  commands: [
    { id: 'solve', type: 'morphTo', targetId: 'eq', at: 0, duration: 1.2,
      args: { latex: 'c = \\sqrt{a^2 + b^2}' } },
  ],
} satisfies CompositionDocument;
```

- **`Latex`** node, a component that draws a formula as fillable, strokable
  glyph paths. Set `latex` to the TeX source and `fontSize` to scale it; `fill`,
  `stroke`, `shadow`, and `padding` work like any other shape.
- **Formula morphing**: `morphTo` (or any `to` that names `latex`) interpolates each
  glyph between the current and target formula, matching tokens that persist,
  fading out tokens that leave, and fading in tokens that arrive. A persisting
  glyph is carried by its geometry, so one that changes size on the way — the
  `2` of `b^2` becoming the `2` of `2a`, or a symbol dropping into a `\frac` —
  grows or shrinks across the transition instead of snapping. The hugging box
  resizes smoothly along with it.
- **Parts**: every piece of the source is a part, named by that source
  (`a^2`, `\frac{d}{dx}`, or neighbours that spell it together). `partFills`
  and `partFillTo` paint one with any paint, `latexPartBounds(node, part)` says where it is,
  and a morph carries a term both formulas write as one, with its fill.
- **`written`** writes the formula on glyph by glyph, each outlined and then
  filled; `writeTo` animates it. It is how a formula appears, so a formula has
  no outline trim (`start`, `end`, `progressTo`, `flash`).
- **`latexMatrix`** typesets `entries` in the `brackets` it is given. Each entry
  is a part; `entriesTo` morphs to new ones.
- **`buildLatexPath(latex, fontSize)`**, the underlying helper that turns TeX
  into positioned `LatexToken` glyph paths plus intrinsic size and bounds, for
  callers that want the geometry directly.

TeX is parsed through MathJax with the `base`, `ams`, `boldsymbol`,
`newcommand`, `cancel`, `color`, `mhchem`, `physics`, `bbox`, and `mathtools`
packages enabled. Rendering is synchronous and browser-only.

A formula MathJax cannot typeset (`\frac{a`, `\fra`, a stray `{`, or `\require`,
since only the packages above are loaded) throws a `LatexError` from
`buildLatexPath`, and from a `Latex` node that holds it whenever it is laid out
(a document holding one fails to build). The error carries the `latex` source and MathJax's `reason`. It is the same
in a browser and in Node; nothing is drawn in place of the formula.

This package is written against [`@motionscript/sdk`](https://github.com/motionscript-dev/motionscript/tree/main/packages/sdk), which it
takes as a peer dependency, and renders through whatever backend draws the
scene, such as [`@motionscript/browser`](https://github.com/motionscript-dev/motionscript/tree/main/packages/browser).

## Morphing, fills and what the host supplies

- **`morphTo({ latex })` is the document command, and every `to` of `latex` is a morph.**
  Mid-tween `latex` (a matrix's `entries` and `brackets`) holds both ends, a
  `Morph`, and the glyphs are drawn that far between them, so a seek to any time
  draws the morph there. A `to` of `fontSize` alone sets the formula again at
  each size. A morph reads its from-state on its **first evaluation**, not when
  the command is built, so two morphs in sequence start the second from the
  first's end.
- **Glyphs match by key.** A token's key is the character its MathJax glyph id
  decodes to (a mathematical italic `𝑥` is not `x`); a rule or fraction bar is
  `__rect_N` and a bare path `__path_N`, and those never match. `defaultLatexMorph`
  pairs keys greedily in order, fades deleted tokens over the first half and added
  ones over the second. A custom `morph` (`LatexStrategies`) replaces it, for a
  node built on the typeset helpers, which take it as an argument
  (`formulaFrame(source, fontSize, partFills, morph)`); a document cannot set it.
- **A `latex` row needs a `fill` or a `stroke` to draw anything**; `fill` defaults
  to none. The formula is typeset in display style, so double each backslash inside
  a JSON string.
- **MathJax loads only for a scene that typesets.** It and its default font,
  including the `\mathbb`, `\mathcal`, `\mathfrak`, `\mathscr`, `\mathsf` and
  `\mathtt` ranges, are bundled in a module of their own that `loadMathJax()`
  imports once. A `latex` or `latexMatrix`, and a graph, a point, a brace or an
  angle whose label is written between dollar signs, declares the
  `math:mathjax` loader (`MATHJAX_LOADER`), which the host waits for before
  layout; a scene with no formula never loads it. Until it is there a formula
  draws nothing and is asked again. Code that typesets outside a scene (a tool, a
  test) awaits `loadMathJax()` first: `buildLatexPath` throws `LatexNotLoaded`
  before then, and `latexPartNames` answers with nothing.
- **Module state is shared per process**: one MathJax document, and two LRU memos
  (typeset geometry by formula, 128 entries; paths by size and formula, 64).
  Importing the module registers MathJax's HTML handler, with the DOM-free adaptor
  when there is no `window` or `document`.
- **`ms add latex` copies only `tex/node.ts`** (`registry.json`); typesetting, the
  morph and the drawing (`tex/typeset.ts`) stay in this package behind `src/engine.ts`.

## Usage

```bash
npm install @motionscript/math @motionscript/sdk
```

Or copy the node's source into your project with `ms add latex`
(see [`@motionscript/cli`](https://github.com/motionscript-dev/motionscript/tree/main/packages/cli)). See the [docs](https://motionscript.dev/docs) for the full feature set and API
reference.

## Development

From the monorepo root:

```bash
pnpm --filter @motionscript/math build
pnpm --filter @motionscript/math test
```
