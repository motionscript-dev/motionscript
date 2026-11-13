# CLAUDE.md — `packages/components`

Seven published kits (`audio`, `charts`, `code`, `geography`, `grids`, `math`,
`patterns`): components plus helpers, installed as a
dependency, or copied into a project from the same source (the files each
`registry.json` item lists).

## Imports

- **A kit imports `@motionscript/sdk` and `@motionscript/sdk/component`, never
  `@motionscript/core`.** Each `eslint.config.js` (eight identical files) bans
  `^@motionscript/core(/.*)?$` with `no-restricted-imports`. When the SDK lacks a
  name, add it to `packages/core/src/sdk/index.ts` if an author would reach for
  it and rebuild core; otherwise the kit is wrong. Do not import core to get round it.
- **Tests may take exactly seven names from `@motionscript/core`**, no subpath:
  `AssetDeclaration`, `CanvasRenderContext2D`, `ManifestAssetCatalog`,
  `NullRenderContext`, `ClipTimeline`, `sampleTree`, `TextState` (the override
  for `**/*.test.ts` and `**/tests/**/*.ts`), and only where a test plays the host.
- **The lint misses a dynamic `import()` of core and any `.tsx` file** (it
  matches `**/*.ts`). Keep both out; nothing else catches them.
- **Peers.** The SDK is a `workspace:^` peer plus a `workspace:*` dev dependency;
  core is at most a dev dependency, for tests.

## Registration

- **Registration is explicit.** Each kit's root barrel exports `NODES`
  (`src/nodes.ts`), an array of component values, which a host hands to the
  engine (`nodes: NODES`). A factory's `key` only declares the type. An import
  kept for its side effect is shaken out under `sideEffects: false` and a
  document names its types by string, so list the components. See `packages/core/docs/why.md#one-registry-per-engine-a-decorator-declares-it-does-not-register`.
- **`./kit` is the shared half** of a kit: `audio` exports `dist/kit.js`;
  `charts`, `grids`, `math`, `patterns` export `dist/engine.js`; the rest have none.
  What several components share is a module there (patterns' `ViewportPattern`:
  `state`, `commands` and helpers to spread in and call), never a base to extend.

## Naming

- **A node key is two words, what it is plus its family, in camelCase**
  (`lineChart`, `rectangularGrid`, `functionPlot`, `riemannSum`). Every kit's keys
  share one flat registry with core's, so a bare everyday noun (`point`,
  `vector`, `area`) is claimed once for all of them, can read as a property kind,
  or sits one letter from a core key (`points3d`). A 2D/3D pair follows core's
  `canvas2d`/`canvas3d`. `latex` and `code` predate the rule and keep their keys,
  because saved documents name them.

## Writing a component

- **A node type is a factory spec** (`component2d`, `component3d`,
  `componentAudio`), exported beside its type: `export const X = component2d({…})`
  and `export type X = NodeOf<typeof X>`. Write the fields in the order
  `key, state, defaults, renamed, deprecated, migrate, allowedChildren,
  children, provide, load, commands, measure, layout, render`: TypeScript infers in reading order, and a field that
  reads the built children before `children` is written types their commands as
  plain `string`.
- **Spread a module's `commands` with its `state`.** `...Paint.state` without
  `...Paint.commands` drops `fillTo` and the rest, silently.
- **Descriptor options are a host's, not a kit's.** A factory declares only
  `key`; `parentKey`, `forkable`, `layout`, `seed`, `within`, `beside` and
  `closed` are what a host keeps for offering a type, so `describe()` reports a
  kit node's key, dimension, entries and commands and nothing more. A kit's
  tests check those, never a shelf or a seed.
- **Nothing extends a node class or tests one by value.** `Node`, `Node2D`,
  `Node3D` and `NodeAudio` are types: tell a node apart by a component's
  `.is`, or `X.node` with `instanceof` for one component, or by shape.
  A test that needs a node of its own writes a `component2d`.
- **A `component3d` never puts two faces at nearly one depth**, or they
  z-fight in zig-zag stripes: shared or flush faces and hair-thin lifts are the
  usual causes. The rules and gaps are [3d.md, Depth](../core/docs/3d.md#depth-thin-and-touching-geometry).
- **A kit's `dist/*.d.ts` name `@motionscript/sdk` alone**, never core (a dev
  dependency only). Type `NODES` (and any list of components) by name,
  `(typeof A | typeof B)[]`, and where an inferred component type spells a
  spread entry's type through core, name that type in the file
  (`type Fill as _Fill` in its sdk import) so the emit reaches it through the
  sdk. Check with `grep -rl "@motionscript/core" dist` after a build.

## Defaults

- **A default lives on the entry, or in `defaults`, never in code that runs
  at build.** A host builds a new node from `describe` and writes every default
  it reports, so a value a `children` builder or a command works out never runs
  there and the node paints the bare default (an empty fill, a mesh's white).
  An own entry carries its default (`Types.fill('white/10')`); an entry spread
  from a module or built in takes a new one in `defaults`
  (`defaults: { fill: 'white/10' }`), which is also how a mesh spreading
  `Material.state` gets a fill other than white (math's `surfacePlot3d` and
  `curvePlot3d` start in the plot colour; math's `nodes.test.ts` builds every
  node both ways). A `defaults` function of
  `(state, given)` is a binding the node writes only for an entry it was not
  given; `describe` reports the entry's plain default instead, and a host that
  writes every reported default gives the entry, so the binding does not run
  there either. Keep functions for a value that must follow other entries.
  `{ ...Paint.state, fill: '…' }` is not a new default: it redeclares `fill` as
  a text entry.

- **A list entry's `resolve` keeps every entry as written**, a blank or a repeat
  included, and the drawing skips what is incomplete. A host's panel shows the
  resolved value over what it stored, so a resolve that drops a blank entry makes
  an editor's "Add" look dead and a typed repeat delete its row (math's
  `networkGraph` and `latex` part fills, `tests/structures.test.ts`).

- **A line is a stroke, an area is a fill; never re-spell them.** A rule, an
  outline, a grid line or a spoke is one `Types.stroke(…)` entry (weight,
  colour, dash and caps come with it; an empty stroke draws nothing), a panel or
  a track is one `Types.fill(…)`, and likewise `Types.shadow` and
  `Types.cornerRadius`. No `…Width` + `…Dashed` + `…Color` + on/off switch for
  something those types already say: a host has full editors for them, and a
  look saved off one component carries them whole. This holds inside a
  `Types.style` group too.
  In 3D it is the same through `Paint3D`: spread `...Paint3D.state` and
  `...Paint3D.commands`, paint the surface with `Paint3D.material(s.fill)`
  and the lines with `Paint3D.lines(g3, s.stroke, segments)` (weight and dash
  in thousandths of a scene unit), never a `color`, `lineColor` or
  `lineWidth`. Built-in meshes keep `Material.state`
  (`packages/core/docs/3d.md#painting-a-custom-3d-node`).

- **A specialised node takes only the paints it draws.** Spread only the
  modules it draws with, or take part of one
  (`const { overlay: _o, ...paint } = Paint.state`, and the same for
  `Paint.commands`; math's `kit/component.ts` exports `PAINT`), so a host never
  offers a control that draws nothing. There is nothing to withdraw: what is not
  spread is not there. Math's `tests/nodes.test.ts` pins each node's paints in
  `PAINTS`.

## Evolving a published component

- **A stored row names props by key forever.** Renaming or removing an entry,
  or changing its default, unit or meaning, breaks saved documents silently.
  Rename it and keep the old key in `renamed`, convert old values in `migrate`
  keyed by the old key, mark what should go in `deprecated`, and mark the
  changeset `**Breaking:**` (`scripts/runbooks/release-and-ci.md`). Nothing ships
  one of these today; `core`'s `prop-evolution.test.ts` is the reference.

## Copied components (`registry.json`)

- **A copied file lands without its siblings.** `registry.json` lists each item's
  `root` and `files`, plus `kit.barrel` and `kit.specifier`. A shared component or
  module belongs behind the kit barrel, not in an item's `files`: a part is told
  apart by its component's identity, so a second copy of a component is a second
  component under one name, and a second copy of a module that keeps a
  register (grids' `ItemGrid`) is a second register. Copies import it by
  `kit.specifier`.
- **The docs site's registry builder (it reads the published kit) fails on:** a relative import that
  leaves the copied set and is not reached from the kit barrel; a bare import
  other than `@motionscript/sdk` (any subpath), the kit or a declared dependency
  (so never core); a test file in `files`; a line over 400 characters (move data
  behind the barrel); a package without `@motionscript/sdk` as a peer.
- The scan is textual (`require()` is not seen) and every file the barrel reaches
  by relative import counts as kit, exported or not. `public/r` is generated and
  never cleared; do not edit it.

## Packaging

- **A new kit joins these by hand**: `pnpm-workspace.yaml` (no glob), the `fixed`
  group in `.changeset/config.json`, `PACKAGES` in `scripts/pack-stable.js` if the
  e2e scenes need it. A folder here outside `pnpm-workspace.yaml` (`diagram`) is
  built, linted and versioned by nothing.

## Docs

- [`cli`](../cli/README.md) and [`sdk`](../sdk/README.md) READMEs; [Rules III](../../RULES.md); [why](../core/docs/why.md#one-registry-per-engine-a-decorator-declares-it-does-not-register), [why](../core/docs/why.md#node-types-are-factory-specs-not-decorated-classes)
- [Build orchestration](../../scripts/runbooks/build-orchestration.md), [Release and CI](../../scripts/runbooks/release-and-ci.md)
