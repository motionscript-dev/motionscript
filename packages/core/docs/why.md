# Why

Decisions that shaped this code, with what was ruled out. Each section is one decision; add one when a choice is not obvious from the code.

## A frame is a pure function of its time

Status: accepted

### Context

A scene could be written as a generator function whose `yield*` handed control back to the engine. That made frame N reachable only by running frames 0..N-1, made a backward seek a replay from zero, and made a scene's duration unknowable without playing it to the end.

### Decision

A scene is data: a document of node rows and command rows. It is built once and asked what it looks like at `t`, never advanced to it. A command is a declared `duration` plus a pure `at(t)`, and carries its own placement, so sequencing is `at + duration`, running together is a shared `at`, and a wait is a gap. Rendering frame `t` depends only on the document, the registry and `t`.

### Consequences

- Seeking costs the same in either direction and however far.
- A document's duration is computable without playing it.
- A document's commands animate the tree its node rows declare; they never add, remove or reparent nodes, so seeking never has to undo a structural edit (`packages/core/docs/why.md#nodes-and-variables-are-fields-not-commands-a-constant-is-an-undriven-variable`).
- Anything JSON cannot express belongs in a node class (the code half), registered with an engine (`packages/core/docs/why.md#one-registry-per-engine-a-decorator-declares-it-does-not-register`).

## One registry per engine; a decorator declares, it does not register

Status: accepted

### Context

Vocabulary tables (node types, command types, lerps, shaders) were module-scope maps behind free functions, so a registration was a fact about the process: two engines shared one vocabulary, whichever host loaded first won a contested key, and a test had to remember to clear three modules.

### Decision

`Registry` (`packages/core/src/document/registry.ts`) is a class with an owner. An `Engine` constructs one and exposes it as `engine.registry`; a document is compiled against it, so the vocabulary is a property of the engine opening the document.

- `@node()` records the key on the prototype (`getNodeDescriptor` reads it back); a class becomes available only when handed to a registry (`{ nodes: [Blob] }`, or `addNode("blob", Blob)`). A decorator that registered would make module evaluation order part of the engine's state and make "imported" mean "offered", which a component package's `NODES` array exists to keep separate.
- `installBuiltins` is internal and runs from the `Registry` constructor, so there is no module-scope call for `sideEffects: false` to tree-shake away.
- Whatever compiles a document is handed a registry explicitly (`ClipTimeline`, `ClipInstance`, `ClipStore`, `AssetTimeline`, `StateEvaluator` through their runtime scope). A host that renders without a session takes a `registry` option.

### Consequences

- An unregistered node type is caught by the validator only when it is handed the registry (`validateDocument(doc, { registry })`). A build stands an empty placeholder in for the row and records a coded `BuildError` (the playback controller's `buildErrors` and `onRenderError`) rather than throwing to the host, so a host that ignores `buildErrors` sees that node missing and no exception; a strict registry fails the track instead (amended by [Documents carry a format version; unknown types build as placeholders](#documents-carry-a-format-version-unknown-types-build-as-placeholders)). Hosts register once, at module scope, in their composition root.
- Packages register nothing on import (RULES.md III).

## Nodes and variables are fields, not commands; a constant is an undriven variable

Status: accepted

### Context

Nodes and variables were once introduced by `add`, `remove` and `variable` commands, which gave a node a different shape in a still than in a composition, and a separate `constants` field existed beside variables.

### Decision

- A node is one row wherever it lives; a composition's row adds `startAt`/`endAt`, so a subtree moves between a still and a composition by dropping or adding those fields. A document's command rows only animate (node classes may still expose tree-editing `@command()` methods such as `addChildAt`, `removeChildAt` and `reparent` for scenes built in code); the validator names both retired command types, and a compile-time `remove` miss names `endAt`.
- A variable is declared in `variables` on every clip kind. On a still nothing can change it, so it is a fixed value; a `constants` field is a validation error. A variable has no presence span: it holds its declared value from t=0 until a command changes it.
- Nodes and variables share one id space, so a command's single `targetId` is unambiguous (`Registry.addVariableCommand` sets `scope: "variable"`); a collision is a validation error. `NodeSpec.key` is a reference handle, not in that space, optional and never generated.
- One command can drive many nodes through bound props: twelve nodes moving together is one `variableTo` and twelve expressions, and re-timing is one field.

### Consequences

- A host's timeline can group rows by `targetId`.
- An expression naming a variable that "does not exist yet" would be a broken document, which is why the "target not present yet" rule for nodes does not apply to variables.

## A bound prop recomputes on every read; there is no dependency graph

Status: accepted

### Context

An earlier property system tracked dependencies with a caching `Signal`. The renderer is immediate-mode: it reads every property every frame, so the caching bought nothing the renderer could use, and declaring edges was error-prone for bindings written mid-layout or over a variable a command had just written.

### Decision

`PropSlot` (`packages/core/src/props/slot.ts`) holds either a value or a thunk. A bound slot recomputes on every read; nothing is invalidated and no edge is declared. An expression compiles to a prop binding (`"=4[g]+3"` becomes `() => 4 * slot.get() + 3` written through `node.set()`), so a command writing a variable's slot is picked up by every prop that names it.

### Consequences

- `PropSlot.get` refuses to re-enter and returns the last settled value, so a cycle between two node props would render a frame that disagrees with the document; the validator rejects such cycles (per-prop edges, not per-node).
- A binding that reads an absent node reads `undefined`; `_writeProp` never hands that to a prop's mapper, so the prop holds the default a node built without it would hold, keeping the frame a function of the playhead.
- Asset and audio declarations are the exception that needs dependency information: `observeSlots` (`props/observer.ts`) records the slots a declaration reads so the runtime re-runs it only when one can have changed (`packages/core/docs/assets.md`).

## A prop is read through its class's prototype, by index

Status: accepted (2026-11-10)

### Context

Each prop's accessor was a pair of closures defined on the node itself. No two nodes then shared a hidden class, so every prop read in layout and render was megamorphic, and a component's state view looked props up by name inside one shared getter. On a scene of 2,100 laid-out rects (about 58 prop reads per node per frame), reads were a third of the frame.

### Decision

`PropLayout` (`packages/core/src/props/layout.ts`) gives each node class one index per prop and defines the accessor once, on the class's prototype; an instance keeps its slots in that order (`PropCells.list`). Accessors and state-view getters reach the slot by index, never by name: closures made at one site share their feedback, so a lookup by name inside one would see every prop of every class. A read the layout cannot answer (an instance that never registered the field, a class that already defines the name) falls through to what the node would read without it.

### Consequences

- A node's props are not its own properties: `Object.keys(node)` and a spread of a node no longer list them. A child's `state` lists them as its own, so a spread of it still does.
- Every node of a type shares one hidden class, so reads stay monomorphic with or without a JIT.

## Core describes 3D as data; it never imports a 3D library

Status: accepted

### Context

3D scenes need a renderer. Importing three.js into core would make the animation engine depend on a graphics library and on WebGL.

### Decision

The 2D/3D split mirrors itself. `core` describes a scene as pure data (`packages/core/src/render3d/`): `Graphics3D` is what one node draws, `Scene3D` is the recorded result a backend replays, `RenderContext3D` is what a `Node3D` draws into. Nothing in core imports a renderer or a 3D library. The renderer replays a `Scene3D` with its own 3D pass (`packages/renderer/crates/render3d`, encoded by `web/src/r3d/encode.ts`). `RenderContext2D` and `RenderContext3D` are siblings, not subclasses: they share no members.

### Consequences

- Core stays free of any graphics library; the renderer is the only place 3D is drawn ([WebGPU is the only renderer; CanvasKit, SkSL and three.js are removed](../../renderer/docs/why.md#webgpu-is-the-only-renderer-canvaskit-sksl-and-threejs-are-removed) removed the three.js backend).

## Node types are factory specs, not decorated classes

Status: accepted

### Context

A node type was a class: `@node`, then `extends Node2D | ShapeNode | Rect | ...`, `@property` and its typed variants, `@command` methods, children built in the constructor (often in JSX), and overrides of about 60 hooks, a dozen of them `_`-internal (`_planeOf`, `_placementOf`, `_spaceCamera`, `_handles`, `_prepareStep`) that kits overrode anyway. That openness is where the traps the docs warned about came from: a fixed constructor order, "declare the loose type, cast when you read", a bare `@property` silently snapping, command names colliding with inherited members (`remove`, `set`), `applyProp("_x")` for private state, `to()` overrides to reroute a prop, argument defaults that were never applied, and `@withdraw` to hand back paints a base class gave.

### Decision

A node type is one object handed to a factory: `component2d`, `component3d` or `componentAudio` (`packages/core/src/components/factory/`). Its fields are a closed set, typed per tree, so an unknown field or one from another tree is a type error: `key`, `state`, `defaults`, `allowedChildren`, `children`, `provide`, `load`, `commands`, then `measure`, `layout`, `render`, `plane`, `handles`, `bounds`, `space` for 2D, and `render`, `space` for 3D.

- **State** is plain values and `Types` builders, each carrying its resolve/lerp pair; every field reads it resolved and typed, with no cast. `{ private: true }` is state only commands write. `defaults` gives new defaults to built-in and spread entries.
- **Behaviour comes from modules**, plain ES modules of `state`, `commands` and pure helpers that a component spreads in and calls (`Paint`, `Flow`, `Shapes`, `Aim`, `Typeface`, `TextLayout`, `Material`, `View3D`, a kit's own), not from a base class.
- **A command** is a list of entries to tween, a function, or its own `args` and a `run`, and returns timeline pieces. Omitted arguments take their defaults. Sound is a piece (`timeline.sound`).
- **Children** are built by calling components in `children`, typed by `allowedChildren`.
- **The factory lowers a spec** onto a generated subclass of `Node2D`, `Node3D` or `NodeAudio`: it declares the key, writes the property and command metadata the registry already reads, and answers the `_` hooks from the spec's fields. The registry, documents, the timeline and a host's inspector see an ordinary node type, and `describe()` reports what the classes did, each difference recorded in the migration log; every core family was ported to pixel-identical e2e frames.
- Every built-in node type is a component. `canvas2d` stays an engine class: it is the root the runtime builds, never authored.

Why:

- **Nothing to override.** With no class to extend there is no constructor order, no inherited member to collide with and no hook to get wrong; the traps above have no form to take.
- **Fields are pure functions of their parameters**, so a component command reads only what it captured when built and writes only property slots. The timeline holds a finished one at its end values instead of running it, so a component timeline's evaluation stops growing with its length (100 nodes, 10,000 commands, one moving: 0.0013 ms against 0.499 ms, the whole frame about 6x cheaper).
- **Mistakes read as type errors**: a misspelt entry, a value of the wrong type, a command argument that is no entry, a child that `allowedChildren` does not list, a module helper called without the module's state.

### What was given up

- **Calling methods on a node from code** (`text().words().to()`, `plot.valueAt(x)`). These become command arguments and helper functions; the component `Text` has no selection API and `NumberNode` no `formatted()`.
- **Construction-only strategies** (Code's `diffStrategy`, Latex's `morph`). These become helper or factory arguments (`defineCode(strategies)`).
- **A row's whole-span audio** (`declareAudio`). Sound plays from commands. The built-in `sound` and `video` rows that carry no `play` command get one over their span, so documents and a host's audio lanes sound as they did.
- **Descriptor options as engine API.** A factory takes only `key`; `parentKey`, `forkable`, `layout`, `seed`, `within` and `beside` are a host's to keep.

### Consequences

- A kit exports components in `NODES`. The migration took the decorators, the authoring base classes and the JSX runtime out of `@motionscript/sdk`, and the `_` hooks became core's alone.
- A module is two spreads: forgetting `...Paint.commands` drops `fillTo` with no warning. Two modules declaring one entry differently resolve to whichever spread comes last, which the types do not catch.
- `defaults` is a field of its own because `{ ...Flow.state, flow: "grid" }` cannot be told from a new text entry named `flow`, at run time or in the types.
- Field order matters to inference: a field reading the built children (`commands`, `measure`, `layout`) is written after `children`, or a child's command names type as `string`.
- A command's pieces are built in order, each run to its end first, so two parts of one `together` writing the same entry do not start from the same value.
- Identity is still class identity: each factory call generates a class, `instanceof X` and `X.is(view)` test it, and two copies of core in one module graph still break it.
- The tree check between 2D and 3D stays at run time: a call's `children` narrows only as far as `allowedChildren` lists components.

## Documents carry a format version; unknown types build as placeholders

Status: accepted (2026-11-06). Amends the unregistered-type consequence of [One registry per engine; a decorator declares, it does not register](#one-registry-per-engine-a-decorator-declares-it-does-not-register).

### Context

A document is stored by hosts for as long as their users keep work, and is opened by whatever engine is current. Until now nothing in a document said which format wrote it, validation checked shape only, and the one protection was a `**Breaking:**` changeset that a host had to read and turn into its own migration. A changed default or unit was not covered at all. At build, one row naming a type the engine lacked (a kit not installed, a component removed) threw out of the whole track, so a document lost every node to one.

### Decision

- **A document says its format.** `formatVersion` on a still, composition, audio clip and project. Absent is format 0, which is every document written before the field. A clip in a project without its own reads at the project's.
- **Core owns the migrations.** `DOCUMENT_MIGRATIONS` is an ordered list of steps from format *n* to *n + 1*; each is a pure JSON → JSON function with a test, needing no registry, so a host can run it over a stored row it never opens. `migrateDocument` runs them and reports what each changed. `resolveProjectDocument`, which every way of opening a document goes through, migrates before it validates. A format above the engine's throws `DocumentTooNewError` instead of being read as whatever it resembles.
- **A component's props evolve in its spec.** `renamed`, `deprecated` and `migrate` sit beside `defaults` and apply wherever a row's props become a node, and through `migrateNodeProps` for a host rewriting rows. They have no version: a rule must leave a current value alone, which is why a unit change rides on a rename.
- **An unknown type costs one node.** A build stands an empty placeholder of the row's tree in for it, keeping its id, props and children, skips every command aimed at it and any command no type publishes, and records each as a coded `BuildError`. `validateDocument(doc, { registry })` reports the same up front, and a strict registry restores the throw for a caller that wants it.
- **Saved documents are a corpus.** Each release snapshots documents into `packages/core/test/fixtures/documents/<version>/`, and every set is migrated, validated and built by the test suite from then on. The set's vocabulary snapshot makes a changed default or a removed prop of a built-in fail the suite until a `**Breaking:**` changeset names it, which a rename-only convention never caught.

### Consequences

- A change to what a stored document means needs a migration step (document-wide) or spec evolution (one component), plus a `**Breaking:**` changeset; the fixture corpus fails a release that forgets.
- The format number moves only when a step is added, not every release. Hosts keep their own release-keyed migrations for their own envelopes and call these for the engine's part.
- A document can now render with a node silently missing for a host that ignores `buildErrors`; that is the trade for not losing the rest of the clip.
- Migrations go up only. A host that must hand a document to an older engine keeps the original.
