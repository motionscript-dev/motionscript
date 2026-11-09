# Registry

`Registry` (`packages/core/src/document/registry.ts`) is the code half of the document model: the object that turns the strings a document names (`"rect"`, `"fillTo"`, `"color"`, `"swirl"`) into a node class, an animation, an interpolation and a shader pack. An `Engine` builds one from its options and exposes it as `engine.registry`; a document is compiled against it, so what a document may name is a property of the engine opening it. Why it is an instance and not module state: [why](./why.md#one-registry-per-engine-a-decorator-declares-it-does-not-register).

## Model

Five tables, one value per key:

| Table | Named by | Value | Filled by |
|---|---|---|---|
| node types | `NodeSpec.type` | `NodeTypeRecord`: `key`, `ctor`, `commands`, `descriptor` | `addNode`, `addNodeFromSource`, `RegistryOptions.nodes` |
| node-less commands | `CommandSpec.type` | `CommandTypeEntry`: `scope` (`"node"` or `"variable"`), `factory`, optional `args`, `binds` | `addCommand`, `addVariableCommand` |
| lerps | `VariableSpec.lerp`, `variableTo` `args.lerp` | `VariableLerp`: `(from, to, t) => unknown` | `addLerp`, `lerps` |
| eases | `{ kind: "custom", args: key }` | `EasingFunction` | `addEase`, `eases` |
| shaders | a shader fill or effect | normalized `Shader` (`fill` or `effect` scope) | `addShader`, `shaders` |

- **Seeding.** `new Registry(options)` seeds in this order: the built-ins (`installBuiltins`, internal; `builtins: false` skips every built-in node type, lerp and command), `nodes`, `lerps`, `eases`, `shaders`. `EngineOptions` forwards `nodes`, `shaders`, `lerps` and `dynamicNodes` but not `eases`: register an ease with `engine.registry.addEase`.
- **Who holds it.** `ClipTimeline` takes it at construction; `ClipInstance`, `ClipStore`, `AssetTimeline` and `StateEvaluator` reach it through their runtime scope; `Session` passes `engine.registry`. A host that renders without a session (`createStillRenderer`, `exportVideo`, `mixTimelineAudio`) takes a `registry` option.
- **Declaring is not registering.** A factory (`component2d`, `component3d`, `componentAudio`) declares its spec's `key` on the class it generates: `node(key | descriptor)` (core-internal, on no barrel) stores a `NodeTypeDescriptor` on the class prototype under `NODE_META`, and `getNodeDescriptor(ctor)` reads it back. A component value shares its generated class's prototype, so the descriptor reads off either. A type is known to a registry only once handed to it: `{ nodes: [Blob] }` (key from the declaration), `{ nodes: { blob: Blob } }` or `addNode("blob", Blob)` (key from the caller; the declared one is ignored and a mismatch is not detected). Wherever a class goes, a component value may: `addNode` registers it as its generated class (`Blob.node`).
- **A node type's commands and properties are read without constructing it.** `addNode` reads `command` and `property` metadata through `Object.create(ctor.prototype)`, over the whole prototype chain; a subclass redeclaring a key replaces the inherited declaration at the base's position. A factory writes that metadata onto the class it generates: each public `state` entry becomes a property (its `Types` builder gives the default, mapper, tween and editor hints), each plain `defaults` value for a built-in entry redeclares it (a function is a binding the node writes when built, and a 2D `width`/`height` the generated class applies itself, so neither changes what `describe` reports), and each command becomes an `command` method. A private entry is a slot with no metadata, so a host never sees it. `instantiate(spec, props?)` is what constructs: `props` replaces the row's props (the timeline passes only the literal ones) and the row's `id` and `key` are written over them.
- **A type has only what it declares.** A component takes only the modules it spreads, so there is nothing inherited to withdraw: a plot that should not offer `fill` does not spread `Paint`.
- **Which commands a type takes.** `takesCommand(type, key)`: its own table, or a node-scoped node-less command (`to`, `set`, `save`, the paint commands), except one registered with a `method` (`addCommand(key, factory, { method })`; `fillTo`, `overlayTo`, `strokeTo`, `shadowTo` name theirs) that the type lacks or withdrew. A host offers a node its table and the node-less commands it takes.
- **Descriptor.** `describe(key)` is `{ ...declared, dimension, properties }`. `dimension` (`"2d"`, `"3d"`, `"audio"`) is read off the prototype getter, `properties` from `property`, each with a `kind` taken from the declaration or inferred from the default: number to `number`, string to `text`, boolean to `boolean`, array of numbers (empty included) to `vector`, other non-null object to `object`, anything else to `unknown`. `parentKey`, `forkable`, `layout` and `seed` are carried and never interpreted by core; a factory declares only `key`, so a component reports none of them unless it is re-declared on its class (`node(descriptor)(X.node)`, which kits do until a host keeps these itself). `within`, `beside` and `closed` say where a type goes (inside which types, beside which, and whether it takes only children that name it); nothing checks them at build, and `document/placement.ts` (`parentIssue`, `siblingIssue`, `placementIssues`, `nodeTypeIsA`) answers them for a host, together with the 2D/3D seam and `layout.acceptsChildren`.
- **Command resolution** (`ClipTimeline._buildPlaced`): the node-less table first (`registry.command(type)`), then the target type's own table (`nodeCommand(typeKey, commandKey)`). Type commands are keyed per type, so two types may publish the same key; only the nine node-less keys are global, and a type's own `command` method named like one of them (`fillTo`) is never consulted by a document: the node-less factory calls the node's method of that name. `nodeCommand` dispatches by calling the method named in `NodeCommandEntry.method`, never by `instanceof`, so a forked component class works. Only keys listed in `command({ args })` reach the method's `data`; other document `args` are dropped. A component's commands list their args from the spec: a list command's entry names, a record command's own `args` entries.
- **Dynamic nodes.** `addNodeFromSource(source)` registers a node type authored as a source string; it needs `RegistryOptions.dynamicNodes`. The evaluation is hardened (`DENIED_GLOBALS`), not sandboxed; mechanics and the `require` rules are in [dynamic-nodes.md](dynamic-nodes.md).

### Built-in node types (51)

`installBuiltins` (`document/builtins.ts`) writes each key out in `NODE_TYPES`; keys are document API, never derived from class names.

| Group | Keys |
|---|---|
| Clip root and structural | `canvas2d`, `provider`, `theme-provider`, `default-text-style` |
| Geometry | `rect`, `ellipse`, `path`, `polygon`, `polygram`, `boolean`, `mask` |
| Layout | `camera`, `orbitCamera`, `rotated-box` |
| Text | `text`, `richtext`, `number` |
| Media | `video` |
| Audio | `audioBus`, `sound` |
| 3D scene | `canvas3d`, `group3d`, `mesh3d`, `camera3d`, `fog3d`, `environment3d` |
| 3D geometry | `box3d`, `sphere3d`, `plane3d`, `circle3d`, `cylinder3d`, `cone3d`, `capsule3d`, `torus3d`, `torus-knot3d`, `tube3d`, `lathe3d`, `extrude3d`, `ring3d`, `polyhedron3d` |
| 3D drawables | `points3d`, `line3d`, `sprite3d`, `instances3d`, `model3d` |
| 3D lights | `ambient-light3d`, `directional-light3d`, `point-light3d`, `spot-light3d`, `hemisphere-light3d`, `area-light3d` |

`path` is `PathShape` (`components/builtins/geometry/geometry.ts`), the unit-box path whose `data` is a fraction of the node's own box, so a resize is a `width`/`height` write. `Path` (face-value, key `facePath`) and the named outlines (`triangle`, `rightTriangle`, `pentagon`, `hexagon`, `octagon`, `star`) are exported and declare their keys, but are not built in: a host that wants one hands it to the registry. The mixed casing (`audioBus`, `orbitCamera` beside `theme-provider`) is what stored documents contain.

### Built-in node-less commands, lerps, eases

| Key | Scope | Behaviour |
|---|---|---|
| `to` | node | `node.to({ data: { ...args }, duration, easing })`; args are copied because `_prepareStep` expands sugar into its target in place |
| `set` | node, `binds` | a stamp: `node.set(args)`; expressions in args bind |
| `save` | node | a stamp: `node.save()` |
| `fillTo`, `overlayTo`, `strokeTo`, `shadowTo` | node | the node's method of the same name, reading one arg (`fill`, `overlay`, `stroke`, `shadow`) |
| `variableTo`, `variableSet` | variable | see [expressions.md](expressions.md) |

`registry.commandKeys()` is exactly these nine, sorted. `restore`, `fadeTo`, `moveTo`, `rotateTo`, `scaleTo`, `layoutTo`, `effectTo`, `pulse`, `wiggle`, `progressTo` and `flash` (shapes), the camera and text commands and the lifecycle commands are a type's own (a component's `commands`, lowered onto `command` methods; the lifecycle commands are `Node2D`'s); `commandKeys(typeKey)` lists a type's.

Lerps: `number`, `vector2`, `vector3`, `color` (parses both ends with `parseColor`, blends per channel, returns `rgba(r, g, b, a)`), `step` (holds `from` until `t >= 1`). There are no built-in eases or shaders.

## Invariants and traps

- **One key, one value.** Re-registering the same thing under a key is a no-op; a different class, factory, function or pack throws. `{ replace: true }` on `addNode`, `addNodeFromSource` and `addShader` is the only opt-out. Built-ins are seeded first, so an option that clashes with one throws from the constructor. New shader keys stop at `Registry.MAX_SHADERS` (512); replacing an existing key does not count.
- **`getNodeDescriptor` reads the class's own prototype only.** A subclass has no identity until it declares one; it must not answer to its base's key. Every factory call generates a class of its own, so two components never share a key by inheritance.
- **`command({ key })` publishes the method under another key.** `NodeCommandEntry.method` is the registered method's name, so the renamed key dispatches to it, not to a same-named prop or inherited method. A factory does this for a command whose key a node member already uses (`remove`, `clear`): it publishes through `_command_<key>`.
- **An unregistered node type costs one node, not the track.** `instantiate` still throws `Unknown node type`, but a timeline asks `hasNode` first and builds an empty placeholder in its place, recording a coded `BuildError` ([timeline.md](timeline.md)). `new Registry({ strict: true })` (`EngineOptions.strict`) makes the build throw instead, failing the track as before. `validateDocument(doc, { registry })` reports unregistered types and unpublished commands without building.
- **A component's props evolve without breaking stored rows.** A spec's `renamed` (old key → entry), `deprecated` (entry → message) and `migrate` (key → value hook) are checked when the factory runs (a rename from a live entry or onto none, or a hook naming nothing, throws) and recorded on the class (`document/prop-evolution.ts`). `migrateNodeProps(registry, type, props)` applies them: renames first (a hook keyed by the old key converts only that value; a row setting both keys keeps the new), then each entry's hook (run on every value, so it must return a current one unchanged; `undefined` drops the prop), then reports deprecated props still set. An expression is renamed but never handed to a hook. `instantiate`, the timeline's rows and `to`/`set` args all pass through it; a `[key.old]` reference in another row's expression is not rewritten. The descriptor shows `renamed` and each property's `deprecated`.
- **Omitting `registry` means built-ins only.** `createStillRenderer`, `exportVideo` and `mixTimelineAudio` default to `new Registry()`; pass the engine's own or custom node types fail to build there while working in the player.
- **Listings are sorted** (`nodeKeys`, `commandKeys`, `lerpKeys`, `easeKeys`, `shaderKeys`); do not rely on registration order.
- **Packages register nothing on import** ([rules](../../../RULES.md)); a kit exports a `NODES` array of components and the host hands it to the engine.

## Where to look

- `document/builtins.ts`: the built-in vocabulary; the types themselves are in `components/builtins/`. `components/factory/factory.ts`: how a spec becomes a registered class. `document/node-decorator.ts`, `node-descriptor.ts`: `node` and the descriptor. `tween/command-decorator.ts`: `command`.
- `document/tests/registry-api.test.ts` pins the 51-key list above (`the built-in vocabulary`) and the nine node-less commands; `registry.test.ts`, `builtins.test.ts`, `dynamic-nodes.test.ts`, `deny-globals.test.ts` pin the rest.
- `src/tests/barrels.test.ts` pins what is exported: `Registry` and `node` on the root and `/sdk` barrels, `installBuiltins` and `DENIED_GLOBALS` on neither.
