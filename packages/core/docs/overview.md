# Core module tour

`@motionscript/core` (`packages/core/src`) is the animation engine: what a scene is (JSON documents of nodes and commands), how it changes over time, and the runtime that plays a project of them. It describes *what* to draw and *how it changes*; a renderer backend does the drawing. It has no DOM and no runtime dependencies: `tsconfig.json` sets `lib: ["ES2022"]` and `types: ["node"]`, and `package.json` lists only dev dependencies. Package layering is in [ARCHITECTURE.md](../../../ARCHITECTURE.md); terms are in the [glossary](../../../ARCHITECTURE.md#glossary).

## Model

| Directory | Holds |
|---|---|
| `document/` | What a scene is. Document types (`types.ts`, `project.ts`, `audio.ts`), the validator (`validate.ts`), `Registry`, the expression language (`expression/`), `ClipTimeline` and its patch planner (`timeline.ts`, `timeline-patch.ts`), `diffClip`, `indexDocument`, `commandTraits`. Start here. |
| `components/` | The scene graph and how a node type is written. `trees/`: `Node` (`node/`) is dimension-agnostic; `Node2D` (`2d/`), `Node3D` (`three/`) and `NodeAudio` (`audio/`) are its three trees, and `Canvas2D` (`root/`) the root the runtime builds. Every 2D node lays out its children through `flowOps`, driven by `Node2D`. `factory/`: the factories `component2d`, `component3d` and `componentAudio` (`factory.ts` is what they share) lower a spec onto a generated subclass of a tree's base; `Types` (`types.ts`) are the state entries, `timeline.ts` turns a command's pieces into a `Command`, `views.ts` holds the state, child and node views and the render context. `modules/`: the spread-in behaviours (`Paint`, `Flow`, `Shapes`, `Aim`, text, `Material`, `View3D`). `builtins/`: the built-in node types by family (`geometry/`, `text/`, `layout/`, `media/`, `audio/`, `three/`, `providers/`), each with the helpers only it uses; every one is a component. |
| `attributes/` | Animatable prop types (layout, shape, fills, strokes, shadows, filters, text, audio, 3D). Each has an ops value with `resolve` and `lerp`; the property metadata every `Types` entry lowers onto (`property` and the typed variants the tree bases register with `declareMembers`) is in `properties/`. |
| `props/` | `PropSlot`, the storage under every property: a value or a thunk, and a bound slot recomputes on every read ([why](./why.md#a-bound-prop-recomputes-on-every-read-there-is-no-dependency-graph)). `observer.ts` scopes read/write observation. |
| `tween/` | `Command` (a `duration` and a pure `at(t)`), easing and lerp math, loops, `command` (what a component's commands lower onto). |
| `layout/` | `flowOps` (`ops.ts`): every layout operation on one object, plain data in and boxes out. Freeform, runs (wrapped or not) and grid measure differently and share one placement rule. |
| `render/` | Render descriptors and the abstract `RenderContext2D` and `MeasureContext2D` a backend implements; `CanvasRenderContext2D` is the base class every backend extends. |
| `render3d/` | The 3D counterpart: `Graphics3D`, `Scene3D`, abstract `RenderContext3D`, the descriptor vocabulary. Imports no renderer. |
| `runtime/` | What plays a project: `Engine`, `Session`, `PlaybackController`, `ClipInstance`, `ClipStore`, `StateEvaluator`, `AssetTimeline`, `placeTracks`. Spans are arithmetic over the document; a `ClipStore` holds one built `ClipInstance` per track, shared by asset discovery, the `StateEvaluator` and the exporter. |
| `project/` | Theme and typography types a project carries (`config.ts`) and `TreeState` (`tree.ts`). |
| `assets/` | Asset manifest, catalog, manager and `AssetIndex`. |
| `platform/` | Seams a platform fills in: `Ticker`, `StorageAdapter`, `AudioSink`, `Exporter`. |
| `util/` | Leaf helpers (`clamp01`, `Random`, ...). |
| `sdk/` | Named re-exports that form `@motionscript/sdk` (`@motionscript/core/sdk`). |

Entry points (`package.json` `exports`): `.` (`src/index.ts`), `./sdk`, `./component` (`src/component.ts`, what a component package needs beyond the sdk: number formatting, text defaults, shape outlines, the orbit-camera lerps), and `./experimental` (`src/experimental.ts`, deprecated: a duplicate of the sdk's factories, `Types` and modules, kept until the next major; it names the corners and text modules `Corners` and `TextStyle`, where the sdk has `Shapes.corners` and `Typeface`).

### Document conventions

| Convention | Rule |
|---|---|
| Row identity | `NodeSpec.id`; `""` (`ROOT_NODE_ID`) is the root and must be `{ type: "canvas2d", parentId: null }` (`audioBus` in an audio clip) with no `startAt`/`endAt`. `parentId: null` is a direct child of the root; `targetId: null` is the root. |
| Id spaces | Node ids and variable ids share one space. Node `key` is a separate space, read only by `[key.prop]`. Command ids are unique among commands, track ids among tracks. |
| Units | Times in seconds, sizes in pixels. |
| Sibling order | `layerOrder`, ties by array index; two siblings may share a `layerOrder`. |
| Command order | `at`, ties by array index. |
| Spans | `[startAt, endAt)`, half-open; an effective span intersects the ancestors'. |
| Props | Sparse: only what differs from the node type's defaults; `{}` for a fresh node. |
| Clip kinds | A still's rows carry no spans and it has no commands; a composition's rows may carry `startAt`/`endAt`; an audio clip is lowered to a composition before it is compiled or diffed. |
| Project | `ProjectDocument.tracks`: array position is paint order (first at the back); each `Track` holds its clip inline. A lone clip becomes a one-track project (`asProjectDocument`). |

### Validation

`validateDocument(doc: unknown, options?)` checks a clip and `validateProjectDocument` a project and every clip in it; each returns `{ valid, issues: { path, message }[] }`. `assertValidDocument` and `assertValidProjectDocument` throw one `Error` listing the issues (the issues are only in its text). `Session` validates through `resolveProjectDocument`.

- **Total and structural.** Neither validator throws for any input (`null`, an array, a primitive) or inspects a prop value. A `formatVersion` must be a whole number no newer than `DOCUMENT_FORMAT_VERSION`, or absent. Only with `{ registry }` do they report an unregistered node `type` or a command the target's type does not publish (a build builds a placeholder and skips the command instead). These validate and fail later: an unregistered lerp or ease, a command aimed at the wrong kind of target, `variableTo` without `value`, a formula in a command that cannot bind one.
- **Exhaustive, with holes.** All issues come out in check order, except: a composition or audio clip whose `commands` is not an array reports that and stops; a project whose `tracks` is not an array stops after the top-level checks. A row that fails its own shape check is left out of the cross-row checks (tree, targets, presence, expressions, cycles), but later issues keep each row's authored index in their `path`.
- **`path` is the contract, not `message`.** Paths are JSON-pointer style (`nodes[2].parentId`, `tracks[1].clip.commands[0].at`), `""` is the document. Forms the format does not have are named by message (a clip's `constants`, a project's `visualTracks`, `audioTracks`, `backgrounds`, `overlays`, `commands` and `constants`, the `add` and `variable` command types). `migrateDocument` runs before validation when a document is opened ([project-document.md](project-document.md)).
- **Not checked:** `theme`, `viewport`, a command running after its target has left, a variable id containing `.` (valid, but no formula can name it).
- **`validateProjectDocument` caches per clip object** (a `WeakMap`), so re-validating after an edit that replaced one clip walks one clip; a clip mutated in place is not re-walked. The same identity contract holds for `diffClip` and `Session.replace`: documents are immutable by convention.

### What is exported

Pinned by `src/tests/barrels.test.ts` and `sdk-parity.test.ts`. `@motionscript/core/sdk` is a deliberate named subset of the root barrel.

| Surface | Names |
|---|---|
| Root and `/sdk` | `Registry`, `node`, `validateDocument`, `assertValidDocument`, `DOCUMENT_FORMAT_VERSION`, `DocumentTooNewError`, `documentFormatVersion`, `migrateDocument`, `migrateNodeProps`, `missingNodeOf`, `expressionOps`, `ExpressionError`, `documentDuration`, `commandSpan`, `hasTimeline`, `nodeSpan`, `effectiveSpan`, `untimed`, `ROOT_NODE_ID`, `isProjectDocument`, `asProjectDocument`, `property` |
| Root only | `DOCUMENT_MIGRATIONS`, `registryVocabulary`, `vocabularyBreaks`, `Engine`, `Session`, `ClipTimeline`, `PropSlot`, `getPropSlot`, `validateProjectDocument`, `assertValidProjectDocument`, `getNodeDescriptor`, `NODE_META`, `effectiveSpans`, the document type guards |
| Neither barrel | `installBuiltins`, `DENIED_GLOBALS`, `indexDocument`, `diffClip`, `jsonEqual`, `commandTraits`, `planTimelinePatch`, `MIN_REBUILD_NODES`, `resolveEase`, `expressionRefs`, `splitNodeRef`, `inertCommand` |

## Invariants and traps

- **Imports are linted** (`packages/core/eslint.config.js`): a non-barrel file imports the concrete module through the `@/` alias, never an `index.ts` (`import-x/no-internal-modules`), and file-level import cycles fail (`import-x/no-cycle`). Barrels are the only files that `export *`. Directory layering is not enforced beyond that, but holds today: `util/` and `props/` import nothing else from core; `tween/` imports only those plus one type from `attributes/`; nothing in `nodes/` imports `document/`; `document/` imports `nodes/`, `tween/`, `attributes/`, `props/`, `project/`; `runtime/` imports `document/` and everything below it.
- **Nothing renders here.** `render3d/` imports no renderer, so 3D stays data a backend draws ([ARCHITECTURE.md](../../../ARCHITECTURE.md)); `render/` holds interfaces and descriptors a backend implements.
- **Built-in keys and function names are document API.** Renaming a node type key, a command key, a lerp key or an expression function breaks stored documents silently ([registry.md](registry.md), [expressions.md](expressions.md)).
- **One registry per engine, handed to whatever compiles a document** ([why](./why.md#one-registry-per-engine-a-decorator-declares-it-does-not-register)); a host that omits it gets built-ins only.
- **A frame is a function of time** ([why](./why.md#a-frame-is-a-pure-function-of-its-time)): the timeline restores baselines and replays rather than advancing ([timeline.md](timeline.md)).

## Where to look

| Topic | Doc |
|---|---|
| Registry, built-in vocabulary | [registry.md](registry.md) |
| Variables, expressions, node references | [expressions.md](expressions.md) |
| Compile, seek, presence, incremental patching | [timeline.md](timeline.md) |
| Commands, tweens, easing, loops | [commands.md](commands.md) |
| Scene graph and the three trees | [scene-graph.md](scene-graph.md) |
| Attributes (fills, strokes, paths, shaders) | [attributes.md](attributes.md) |
| Layout and text | [layout-and-text.md](layout-and-text.md) |
| Assets | [assets.md](assets.md) |
| Project document, session, playback | [project-document.md](project-document.md) |

Tests sit beside the code (`<dir>/tests/`); `src/tests/` holds the barrel and subpath checks.
