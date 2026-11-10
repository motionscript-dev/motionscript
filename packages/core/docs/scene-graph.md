# Scene graph

The scene graph is `Node` (`packages/core/src/components/trees/node/node.ts`) and the three dimension classes built on it: `Node2D` (`components/trees/2d/`), `Node3D` (`components/trees/three/`) and `NodeAudio` (`components/trees/audio/`). A node type is a component: `component2d`, `component3d` or `componentAudio` (`components/factory/`) generates a subclass of one of them from a spec. A document row names a type and the registry builds the node ([glossary](../../../ARCHITECTURE.md#glossary), [why](./why.md#nodes-and-variables-are-fields-not-commands-a-constant-is-an-undriven-variable)); props are slots that recompute on read ([why](./why.md#a-bound-prop-recomputes-on-every-read-there-is-no-dependency-graph)). This file covers the base class, the three trees, how a 2D node owns its children's layout, what a component's generated class does, and the node families. Related: [attributes.md](attributes.md), [layout-and-text.md](layout-and-text.md), [audio.md](audio.md), [3d.md](3d.md).

## Model

### What `Node` owns (every dimension)

| Area | Members |
|---|---|
| Tree | `parent`, `children`, `_allChildren` (unfiltered, both dimensions), `add`, `remove`, `clear`, `addChildAt` |
| Identity | `id` (`props.id`, else a UUID; `""` is kept because it is the scene root's id), `key` (`props.key`, never generated). Neither is a prop: they do not tween and are not in `set()`/`to()`/`save()` |
| Props | property slots (a component's public `state` entries, or a core class's `declare` fields registered with `declareMembers`), `set`, `to`, `save`, `restore`, `properties`; protected `command()` builds a `Command` from a pure `t => props` function. A prop's accessor is on its class's prototype, reaching the slot by index (`props/layout.ts`, [why](./why.md#a-prop-is-read-through-its-classs-prototype-by-index)) |
| Context | `provideContext`, `resolveContext` (first attach only), `useContext`; a component's `provide` and an entry's `inherit` lower onto the first two |
| Clock | `time`: `total` (clip seconds), `creation` (clip time of the node's first advance), `elapsed` (`total - creation`); a node built at 3 s reads `elapsed === 0` on its first frame |
| Assets | `declareAssets` (`Node` declares nothing; a component's typed entries and `load` run in it; see [assets.md](assets.md)), `attachDetached` |
| Lifecycle | `attach(scope)` mounts and binds catalog, context, clock; `detach()` unmounts and keeps props, children and bindings; `dispose()` disposes slots and does not recurse |

`NodeProps` is only `children`, `id`, `key`. Everything that reads as a box (`x`, `width`, `padding`) is `Node2DProps`; everything that reads as a thing in space is `Node3DProps`.

### Three trees

| `dimension` | Class | Placed by | Drawn through | Accepts as child |
|---|---|---|---|---|
| `"2d"` | `Node2D` | flow layout (`flowOps`) | `RenderContext2D` | `"2d"`; `Canvas2D` also `"audio"`; a component's `allowedChildren` may name trees (`Canvas3D`: `["2d", "3d"]`) |
| `"3d"` | `Node3D` | a `Transform3D` | `RenderContext3D` | `"3d"` |
| `"audio"` | `NodeAudio` | its row's span | scheduled as `AudioRequest`s | `"audio"`; `SoundNode` accepts nothing |

`Canvas3D` and `Canvas2D` are where trees meet. `Canvas2D.childrenAudio` partitions its children; a component reads its 3D children through `ctx.scene3D()`, which renders them into a scene.

### Coordinate spaces

| Space | Origin | y | Used by |
|---|---|---|---|
| Author | the parent's centre | up | `x`, `y`, anchor getters, `lookAt`, `moveTo` data |
| Layout rect | the parent's centre | down | `layoutBounds`, `Node2D.layout(rect)` |
| Local | the node's own centre | up | `_localBounds()`, `hitTestSelf(local)`, `Graphics2D` ops |
| Canvas | the root's centre | down | `Matrix2D`, `_localMatrix()` |

A node's canvas position is `(layoutBounds.x + x, layoutBounds.y - y)`, with `x`/`y` first mapped to pixels when the parent publishes coordinates of its own (`_planeOf`, [dynamic-nodes.md](dynamic-nodes.md)). `flowOps` returns centre-relative y-up boxes; `Node2D.layoutChildren` converts them to y-down layout rects once.

### 2D layout ownership

Every `Node2D` lays out its own children. `measure(constraints, scope)` then `layout(rect, scope)`; `measure` leaves one pending `FlowMeasure` that the next `layout` consumes if `flowOps.reusable` says the box still fits, else it measures again. `flowArrangement()` says how for a class: centred freeform by default; `Canvas2D` returns `this` (their own `flow`, `gap`, `wrap`, `crossGap`, `columns`, `align`). `flowChildren()` is the 2D children minus hidden ones. `effectivePadding()` is `padding`. A component with a custom `layout` (every `Flow` shape) lays out through it instead, clearing the stroke with `Paint.inset` (see [attributes.md](attributes.md)).

A component with no `measure` or `layout` keeps `Node2D`'s (centred freeform). With them, its generated class calls the spec's: `measure(measurer, state, children)` returns the natural size and the class applies `width`/`height` to it through `flowOps.size` (`hug` keeps it, a number or `fill` replaces it); `layout(box, state, children)` returns one `Placement2D` per child, centre-relative and y-up, which the class converts to a layout rect once. A placement's `rotation`, `scale`, `opacity`, `depth`, `rotationX`/`rotationY` become the child's slot (`_placementOf`) and its `plane` the child's coordinates (`_planeOf`). `Flow.measure`/`Flow.layout` are the flow engine with the same rules, an `inset` (`Paint.inset`, the stroke's intrusion) beyond `padding`.

**Default size** is chosen once, in the constructor, from `props.children`:

| Node | Has 2D children | No children | `flex` set, size omitted |
|---|---|---|---|
| `Node2D`, and a component with no `flow` entry | `"hug"` | `"fill"` | `"fill"` |
| a component with a `flow` entry (`...Flow.state`: `Rect`, `Ellipse`, `Camera`, ...) | `"hug"`, or `"fill"` on a main axis where a direct child is `"fill"` | `"fill"` | `"fill"` |
| a component with a `defaults` size (`Path`, `RichText`, `OrbitCamera` hug; `Canvas3D` fills) | that size | that size | `"fill"` |

The `flex` branch runs before `applyDefaultSize`, so it covers classes that override it. A `defaults` size that is a function is a binding, written after the constructor's choice (`Text` binds its size to `fontSize` and `wrap`). A component whose `children` builder made nodes hugs on every axis that neither the call nor `defaults` sizes. For the promotion the main axis is width for `horizontal` and `grid`, height for `vertical`, both for `freeform`. Text sizing is in [layout-and-text.md](layout-and-text.md).

### Transform, pivot and 2.5D space

A `Node2D` turns about `transformOrigin` when one is set, else about its `pivot`; the two are one point read by both `_localMatrix` and `applyTransform`. `transformOrigin` is `undefined` until set (`null` reads as unset, so a document read back from JSON works), and a tween into an origin from "unset" starts where it ends. The nine anchor props (`center`, `topLeft`, ...) are sugar (at construction and as `to` targets) that derive `pivot`, `x` and `y`; passing two, or one with `pivot`, throws. A `to` whose target is an anchor, and the `pivot` option of `moveTo`/`rotateTo`/`scaleTo`, write `transformOrigin` (carried forward like any prop), never the node's own `pivot`. The local anchor getters rotate their offset by `rotation` only, ignoring tilt and mirrors.

`rotationX`, `rotationY`, `rotationZ`, `depth`, `perspective`, `flipHorizontal`, `flipVertical`, `backfaceVisible` and the `transform3D` bag (sugar that expands onto the props) tilt a node in its parent's plane. Tilt and mirrors are paint, not shape: picking and `layoutBounds` ignore them. `depth` shows only with a non-zero `perspective` or inside a space. `perspective` is the viewer's distance in px (`0` is a parallel projection) and tweens in reciprocal space (`lerpPerspective`), so `0` to `1000` passes `2000` at `t = 0.5` and never spikes through small distances. A **space** (`Canvas2D` with `space3D`, or an `OrbitCamera`) places its children in one 3D frame: their `depth` and tilt become positions and turns in it, they paint far to near, and a camera orbits, rises and dollies about `lookAt`. A space root's own tilt and depth are unused, and `OrbitCamera.perspective` is 1000 unless `perspective` or `transform3D` is passed.

### Node families

Document keys are public API (a stored document names them) and the full list is in [registry.md](registry.md); class names are not (`className` is a message aid).

| Family | Document key → class | Notes |
|---|---|---|
| Root and context | `canvas2d` → `Canvas2D`, `provider` → `Provider`, `theme-provider` → `ThemeProvider`, `default-text-style` → `DefaultTextStyle` | `Canvas2D` takes `fill`/`overlay`/flow props, not `stroke`/`shadow`; `space3D` opens a 2.5D space. `Provider` with no `context` passes its parent's map through |
| Shapes | `rect`, `ellipse`, `polygon`, `polygram`, `boolean` → `Rect`, `Ellipse`, `Polygon`, `Polygram`, `BooleanGroup`; `path` → `PathShape` | components spreading `Paint.state` (`fill`, `stroke`, `shadow`, `overlay`, `start`, `end`) and `Flow.state` (the flow entries); `Rect` adds `Shapes.corners`. `BooleanGroup`'s `op` is an entry |
| Code-only shapes | `Path` (`facePath`), `Triangle`, `RightTriangle`, `Pentagon`, `Hexagon`, `Octagon`, `Star` | exported with keys of their own, not in the built-in table; a host offers one by handing it to the registry |
| Structural | `mask` → `MaskGroup`, `camera` → `Camera`, `orbitCamera` → `OrbitCamera`, `rotated-box` → `RotatedBox` | `MaskGroup`: the first child is the stencil, the rest are content; `mode` and `inverted` are entries. `Camera` paints like a rect and lays its children out by its own `flow`. `OrbitCamera` places children in one 3D frame and paints them far to near |
| Media | `video` → `Video` (built like a rect) | no `src` declares nothing and paints a placeholder; sound comes from its `play` command, which a row with none gets per segment or over its span ([audio.md](audio.md)) |
| Text | `text`, `richtext`, `number` | [layout-and-text.md](layout-and-text.md) |
| Audio, 3D | `audioBus`, `sound`; 31 `*3d` keys | [audio.md](audio.md), [3d.md](3d.md) |

The document key `path` is `PathShape` (geometry as a fraction of the node's box); the `Path` class draws its `data` at face value and hugs it ([attributes.md](attributes.md)).

## Invariants and traps

- **A subclass calls `initProps(props)` then `adoptChildrenProp(props)` itself, at the end of its own constructor** (a factory's generated class inherits them from its tree's base, which does). The base constructor stores identity and the raw props only: a subclass's field initialisers run after `super()` returns, so applying property defaults earlier writes into cells that do not exist. `initProps` fires `ref` before it applies props, so a `ref` callback sees an unpopulated node. Enforced by construction order in `Node2D`, `Node3D`, `NodeAudio`.
- **The trees do not mix, and the check is at runtime.** `add`/`addChildAt` throw a `TypeError` naming both classes when `acceptsChild` rejects. A `Box3D` under a `Rect` would otherwise be skipped by the layout walk and the 3D walk and never appear. A component's `allowedChildren` overrides `acceptsChild` (by component class or by tree) and rejects through the same throw. `allowedChildren: []` makes a leaf, and `text`, `number`, `richtext`, `lineChart`, `barChart` and `pieChart` are leaves: a document row whose `parentId` names one fails to build with "It takes no children." A leaf with a `children` builder still builds its own parts; the rule is on the `children` an author passes in, checked before the builder runs. A call's `children` is typed only as far as `allowedChildren` narrows it: a parent that takes anything of its tree accepts any element in the types, so a 3D element under it is caught here.
- **`dimension` is a getter on the prototype.** It answers during construction, before field initialisers run, which is how `Registry.addNode` derives `NodeTypeDescriptor.dimension` without constructing a node. Do not turn it into a field.
- **`Node2D.children`, `flowChildren` and `renderChildren` skip non-2D children**; a `Canvas3D`'s 3D children never enter layout. `children` returns the live array untouched unless a non-2D child is present.
- **`mounted` gates only a handful of dispatch points**: `command`/`_prepareStep` (an unmounted node returns an inert command that spends its duration and writes nothing, `tween/inert.ts`), `attach`/`detach`, `Node2D.render`, and the owner walk `ClipInstance.forEachOwner`. `measure`, `layout`, `flowChildren` and `renderChildren` do not check it; the animated insert measures a child off-tree through `lastMeasure`.
- **`add` does not take a child out of its previous parent.** It ends in both child lists and `parent` points at the later one. Use `reparent` to move.
- **`render` guards, `renderContent` paints.** `render` performs the mounted, opacity, hidden and backface checks and opens the node's draw scope around `renderContent`: the transform, the effect envelope, then `renderSelf`, `applyClip`, `renderChildren` and `renderOverlay`. The clip opened for `clip` closes after the children, so the overlay is outside it. A component's `render` runs in `renderContent`, inside the transform and effect envelope, in place of the rest: its children draw only where it calls `ctx.children()`, or where a call draws them for it (`Paint.draw`, `ctx.mask`, `ctx.merge`, `ctx.camera`, `ctx.space`). A component with no `render` draws its children plainly.
- **`render` returns for an unmounted node always, and skips opacity-0, hidden, face-down and edge-on nodes only when `ctx.drawsVisibleOnly`.** The asset-tracking walk sets it false so such a node still has its fonts and images discovered.
- **Editor state is not a prop.** `applyEditorStates` writes `hidden` and `locked` onto the whole tree each frame, keyed by `Node.key`; a node whose key is missing from the record is reset. `hidden` drops paint, pick and the layout slot (its gap too) but keeps the node in the tree so sibling structural paths do not renumber. `locked` only declines being a pick answer.
- **Nothing resets a built tree.** A `ClipInstance` is built once and asked for times; a caller needing a fresh tree rebuilds (`StateEvaluator.rebuild`). A kept node whose command chain is rebuilt returns to the `initial` snapshot `ClipTimeline` captured when it was built (`document/timeline.ts`).
- **A node built from a document sees no `children`** (`Registry.instantiate` passes the row's props), so a container row with child rows and no `width`/`height` is `"fill"`/`"fill"`; say `"hug"` to wrap. The same node built in code with `children` hugs.
- **`moveTo`, `rotateTo`, `scaleTo` take `pivot` from code only**: their `command` args do not declare it, and a document command's data is built from declared args. `to` copies every arg.
- **A run laid out in a zero-length box warns once** (`flowOps.collapsedRun`, logged by `layoutChildren`): content lands at the centre, which reads as "the scene loaded at 0,0".
- **Animated `addChildAt`/`removeChildAt`** measure the child off-tree, then grow size and `gapScale` over 70% of the duration and fade opacity over 30% (`SIZE_PHASE` in `components/trees/2d/node-lifecycle.ts`); remove runs in reverse and detaches at the end. Setup runs lazily on the command's first evaluation, so the parent must have been measured by then.

## Where to look

- `components/trees/node/node.ts`, `node-reactive.ts` (with `props/layout.ts`), `node-time.ts`, `node-editor-state.ts`, `node-walk.ts` (per-frame `sampleTree` and `primeMotionTree`).
- `components/factory/component2d.ts` (what a 2D spec's generated class overrides), `component3d.ts`, `component-audio.ts`, `factory.ts`; the built-ins in `components/builtins/`.
- `components/trees/2d/node2d.ts` (props, render, layout), `node-lifecycle.ts`, `node-transform.ts`, `node-space.ts`.
- `components/builtins/geometry/` (the shape components and their outline math), `components/trees/2d/group-bounds.ts`, `components/trees/root/canvas2d-node.ts`; the key table is `document/builtins.ts`.
- Tests: `components/trees/node/tests/`, `components/trees/2d/tests/`, `components/builtins/geometry/tests/`, `components/builtins/layout/tests/`; the shared render recorder is `components/trees/tests/recording-context.fixtures.ts`.
