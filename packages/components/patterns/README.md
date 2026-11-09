# @motionscript/patterns

Grid backgrounds for [Motion Script](https://motionscript.dev): `LineGridPattern`
and `DotGridPattern` fill a box of their own, and `GridPattern` is an infinite
grid that fills whatever a `Camera` can currently see.

```ts
import { NODES } from '@motionscript/patterns';

// hand them to an engine: new Engine(platform, { nodes: NODES })
```

Documents name them `lineGridPattern`, `dotGridPattern` and `gridPattern`.
The engine does not know these keys on its own: a document that names one needs
the engine given `NODES`.

## Laid together

`DotGridPattern` shares `divisions`, `subdivisions` and `offset` with
`LineGridPattern`, and both tile through the same function, so a dot grid laid
over a line grid with the same numbers keeps its dots on the intersections while
both scroll. `GridPattern` is built from `ViewportPattern`, a module exported for
a pattern of your own: spread its `state` and `commands` into a `component2d`,
pass its `measure` and `layout`, and draw with `ViewportPattern.draw(ctx, (bounds) => …)`,
which hands over the region the camera sees so only what is on screen is generated.

Core's `grid` and `dotGrid` **fills** are a different thing: paints over any
shape, built into the engine.

## Nodes and props

All three are shapes, built with a shape's paint and layout (`Paint`, `Flow`), so
they take a shape's paint props (`fill`, `stroke`, `shadow`, ...) and children,
and the paint commands, and declare no commands of their own: `to` on `offset`
(all three) and on `cellSize` (`gridPattern`) animates them.

| Key | Own props | Space |
|---|---|---|
| `lineGridPattern` | `divisions` (4), `subdivisions` (1), `subStroke`, `offset` | the node's box, in pixels |
| `dotGridPattern` | `divisions` (4), `subdivisions` (1), `radius` (3), `subScale` (0.5), `offset` | the node's box, in pixels |
| `gridPattern` | `cellSize` (100; a number or `{ x, y }`), `subdivisions` (1), `subStroke`, `offset` | world units |

`stroke` paints the major lines and `subStroke` the minor ones (drawn when
`subdivisions > 1`); when a pattern is built with a `stroke` and no `subStroke`, the
minor stroke is the major one at half opacity: the stroke it was built with, so a
later change to `stroke` leaves it as it was.

- **One tiling.** Every mark of every pattern comes from `addTiledLines`
  (`src/kit/grid-lines.ts`), so patterns with the same `divisions`, `subdivisions` and
  `offset` agree on every intersection. A mark is major by its tile index against the
  un-panned grid, so panning never changes a mark's class.
- **`gridPattern` is world-locked and has no box of its own.** `ViewportPattern.draw`
  covers `ViewportPattern.visibleBounds(ctx)`: the world rect the nearest `Camera`
  ancestor sees (`ctx.ancestor(Camera)`)
  (widened to the bounding box of the turned viewport when it has a `heading`), or,
  with no camera, the node's own layout rect centred on its origin. Nothing is kept
  between frames, so a pan or zoom regenerates the marks for the region; only
  `offset` moves it relative to the world. A dashed stroke is drawn line by line with
  its dash phase locked to the world, and each line's span snapped to whole dash
  cycles, so dashes do not crawl as the camera moves.
- **Lines are centred.** A line has no inside, so stroke `align` is ignored. A
  `lineGridPattern` insets its extent by half the thickest stroke so the outer lines
  are not cut by the box, and `dotGridPattern` by the dot radius.
- **A degenerate step or an empty box draws nothing**; none of them throws.

## Usage

```bash
npm install @motionscript/patterns @motionscript/sdk
```

Or copy one into a project with `ms add line-grid-pattern`, `ms add dot-grid-pattern`
or `ms add grid-pattern`; a copy keeps importing `ViewportPattern` and the tiling
helpers from `@motionscript/patterns/kit`.

## Development

From the monorepo root:

```bash
pnpm --filter @motionscript/patterns build
pnpm --filter @motionscript/patterns test
```
