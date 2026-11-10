# @motionscript/grids

Grid layouts for [Motion Script](https://motionscript.dev): a node that places
its children in a rectangular, radial, path or spherical arrangement, with
staggered reveals, waves, focus, reordering and morphs between arrangements.
Written against [`@motionscript/sdk`](https://github.com/motionscript-dev/motionscript/tree/main/packages/sdk), a peer dependency.

```ts
import { NODES } from '@motionscript/grids';

export const nodes = NODES; // [RectangularGrid, RadialGrid, PathGrid, SphereGrid]
```

Importing registers nothing (see [`packages/components/CLAUDE.md`](https://github.com/motionscript-dev/motionscript/blob/main/packages/components/CLAUDE.md)). Each grid
is a component (`component2d`); `ItemGrid`, the module the four are built from,
is no node type and is not in `NODES`.

## Install

```bash
npm install @motionscript/grids @motionscript/sdk
```

## Exports

| Path | Source | What |
|---|---|---|
| `@motionscript/grids` | `src/index.ts` | the four grids, `PATH_GRID_SHAPES`, `NODES`, and `src/engine.ts` |
| `@motionscript/grids/kit` | `src/engine.ts` | the `ItemGrid` module and what it uses (`src/kit/`): slot functions per arrangement, stagger, reveal and wave styles, order helpers, seeded random |

## Nodes

The items are the grid's children, in layer order; a group is one item. A grid is
`hug` by default, except `pathGrid` (640 x 400, fixed).

| Key | Arrangement props | Own commands |
|---|---|---|
| `rectangularGrid` | `columns`, `fillDirection`, `cellMode` (`fit`/`fixed`/`fill`), `cellWidth/Height`, `columnGap`, `rowGap`, `lastLineAlign`, `rowOffset`, `columnOffset` | `columnsTo`, `gapTo`, `cellSizeTo`, `focusRow`, `focusColumn` |
| `radialGrid` | `radius`, `startAngle`, `sweep`, `direction`, `rotateItems`, `spinSpeed` | `spin`, `turnTo`, `radiusTo`, `sweepTo` |
| `pathGrid` | `shape` (a template or `custom`), `path`, `pathNode`, `spacing`, `spacingDistance`, `offset`, `flowSpeed`, `trimStart/End`, `alignToPath` | `flow`, `trimTo`, `setPath` |
| `sphereGrid` | `radius`, `yaw`, `pitch`, `roll`, `facing`, `focalLength`, `depthFade`, `cullBackfaces`, `spinSpeed` | `spin`, `orientTo`, `turnTo`, `radiusTo`, `focalLengthTo` |

Every grid also has `order`, `spread` and `arrangeLike`, and these commands from
the `ItemGrid` module: `reveal`, `conceal`, `wave`, `focus`, `unfocus`, `spreadTo`, `shuffle`,
`swap`, `reorder`, `morphInto`. Per-item commands take `staggerOrder` (`index`,
`reverse`, `random`, `centerOut`, `edgesIn`, `row`, `column`, `angle`, `path`,
`depth`) and `stagger` (0 to 0.95); `shuffle`, `swap`, `reorder`, `morphInto`,
`columnsTo` and `setPath` are *transitions*.

## Rules worth knowing

- **A slot is a parent transform.** Each item is laid out where its slot is, and the
  rest of the slot (turn, scale, tilt, depth, fade) rides on its layout placement,
  applied about the item's centre before its own transform, so an item's own `x`,
  `y`, `rotation` and its commands keep working relative to the slot. A grid whose
  arrangement has depth (the sphere) opens a camera of its own with its render's
  `ctx.space`, unless it already sits in a space (`ctx.inSpace`).
- **`flowOps` sizes; it never places.** The grid's size is what its slots come to
  (`extentOf`), seen through the camera it has that frame, so a grid of grids is a
  grid of items.
- **`revealState`, `waveState`, `focusState` and `transition` are written by
  commands, not authored.** They are rewritten every frame as a pure function of
  time and set to `null` at the command's end, so a seek reproduces them. `reveal`
  hides every item at its start (place it where the grid enters); `conceal` leaves
  them hidden until a later `reveal`.
- **The stagger lives inside the duration**: a command lasts its row's `duration`.
- **An arrangement is data.** A transition keeps the arrangement it leaves as a
  `GridSnapshot` and re-evaluates it each frame, so a morph can start from any
  arrangement, including another grid's. `morphInto` writes `arrangeLike` (a node
  reference: the grid reads a view of the one it names, and where it stands) and keeps
  following that grid; a grid that cannot find `arrangeLike` or `pathNode` draws its
  own arrangement. Another grid's arrangement is worked out from its state by the
  `Arranger` it was defined with, so a grid is borrowable once `ItemGrid.define` has
  seen it.
- **A command reads the grid as its predecessors leave it.** Ranks for a stagger, the
  rows `focusRow` picks and the cell `cellSizeTo` starts from are worked out afresh from
  the command's state, its children's sizes and the grid's box, against the clock the
  timeline builds commands at (time 0).
- **`order[k]` is the child in slot `k`**, and `normalizeOrder` repairs any order
  (missing, repeated or out-of-range entries), so a stale order never throws.
- **The kit stays an import.** A copy of `rectangular-grid` (or `radial-grid`,
  `path-grid`, `sphere-grid`) takes one grid's two files and rewrites their kit
  imports to `@motionscript/grids/kit` (`registry.json`): a second copy of
  `ItemGrid` would keep a second register of grids, and a morph would not find the
  grids it should.

## A grid of your own

```ts
import { component2d, Types, type Values } from '@motionscript/sdk';
import { ItemGrid, type Arrangement } from '@motionscript/grids/kit';

const own = { radius: Types.number(120) };
const arranger: ItemGrid.Arranger<Values<typeof own>> = {
  arrangement: (s): Arrangement => ({ kind: 'radial', radius: s.radius, startAngle: 0, sweep: 180, direction: 'clockwise', rotateItems: false, spinSpeed: 0 }),
};

export const ArcGrid = ItemGrid.define(component2d({
  key: 'arcGrid',
  state: { ...ItemGrid.state, ...own },
  defaults: ItemGrid.defaults,
  commands: { ...ItemGrid.commands },
  ...ItemGrid.fields(arranger),
}), arranger);
```

`define` registers the arranger, which is what another grid and a host know it by:
`ItemGrid.isGrid(node)` tells a grid from any other node.

## Development

```bash
pnpm --filter @motionscript/grids build
pnpm --filter @motionscript/grids test
```

Tests are in `src/tests/` (`grid.test.ts`, `slots.test.ts`, `descriptors.test.ts`);
`harness.ts` builds, seeks and renders a document.
