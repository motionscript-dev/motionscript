# Dynamic nodes and custom-node internals

A dynamic node is a node type authored as a TS source string, compiled and linked at run time so a host can register it with a live engine. Code: `Registry.addNodeFromSource` and `_evalNodeModule` (`packages/core/src/document/registry.ts`), `DENIED_GLOBALS` (`document/deny-globals.ts`), `Engine.registerNode` (`runtime/engine.ts`), and the browser's defaults (`packages/browser/src/dynamic-nodes.ts`, `createBrowserEngine` in `engine.ts`). The last section carries what a component's editor fields lower onto, and render details, that the public guide ([motionscript.dev/docs/custom-node](https://motionscript.dev/docs/custom-node)) does not state. Registry mechanics are in [registry.md](registry.md) and [why](./why.md#one-registry-per-engine-a-decorator-declares-it-does-not-register).

## Model

`RegistryOptions.dynamicNodes` (a `DynamicNodeConfig`) is the opt-in. A registry without it never compiles or evaluates anything; class registration does not depend on it. Core has no compiler dependency and cannot import the `@motionscript/sdk` barrel (the sdk depends on core), so the host supplies all four fields:

| Field | Meaning | Browser default (`resolveDynamicNodes`) |
|---|---|---|
| `sdk` (required) | what `require("@motionscript/sdk")`, `"motionscript"` and `"motion-script"` return, as one object | `@motionscript/core/sdk` |
| `modules` | further modules by exact specifier, own keys only, consulted after the sdk specifiers (which it cannot shadow) | none |
| `compile` (required) | `(source) => Promise<string>`: TS to CommonJS text, called once per registration, result not validated | esbuild-wasm, loaded on its first call |

**Pipeline** (`addNodeFromSource(source, { replace? })`): `compile(source)`, evaluate the text in the host's realm, take `module.exports.default`, require it to be a component (`component2d({ key, ... })`, or another factory's), whose `key` the factory declared on its generated class (the key comes from the script, never from a parameter), then `addNode(component, options)`, which registers the generated class (`component.node`) and returns the component. A script is written with calls: there is no JSX runtime to link and no decorators to compile. `Engine.registerNode(classOrSource, options)` takes either and is always async. `createBrowserEngine({ nodes })` hands classes (and a record) to the `Engine` constructor and registers strings (array form only) afterwards with `await engine.registerNode(source)`, in array order; the first rejection rejects the call and no engine is returned. `dynamicNodes` is attached to every browser engine, so `engine.registerNode(source)` works after boot whether or not `nodes` held a string.

**Default compile** (`defaultCompiler`): esbuild `transform` with `loader: "ts"`, `format: "cjs"`, `target: "es2020"` (which rejects top-level `await`): no JSX and no decorators, so a script with either fails to compile. The wasm initialises once per page, shared by every engine, from the first caller's `compilerWasmUrl` (default `new URL("esbuild-wasm/esbuild.wasm", import.meta.url)`, read lazily because `import.meta.url` is empty in an IIFE bundle); a rejected initialisation stays cached. The headless page serves it at `/esbuild.wasm`.

**The script's scope.** The factory is `new Function("exports", "require", "module", ...DENIED_GLOBALS, '"use strict";\nreturn function () {\n' + js + '\n};')`, called with a fresh `module.exports` per registration and no argument for the denied names.

| Name | Value in the script |
|---|---|
| `exports`, `module` | a fresh `{}` and `{ exports }` |
| `require` | the registry's resolver (below) |
| each `DENIED_GLOBALS` name | `undefined` |
| top-level `this` | `undefined` (strict mode) |
| everything else | the host realm's globals and intrinsics, unchanged |

`require` resolves in this order and throws for anything else (relative paths, Node built-ins, `…/jsx-runtime` and `…/jsx-dev-runtime`, a `modules` key that is not an own property such as `constructor`): the three SDK specifiers (`SDK_SPECIFIERS`) to `sdk`; an own key of `modules`. The error is `"<specifier>" isn't available to a custom node. It can require "@motionscript/sdk"[, <each modules key>]; …`. `@motionscript/sdk/component` links only when a host lists it in `modules`.

**One key, one class per registry.** The same class again is a no-op. A different class under a held key throws unless `{ replace: true }` (the host's flag; a script cannot set it); then the class, commands and descriptor swap together, nodes already built keep the old class, and a built-in key can be replaced. A throw at any earlier step (compile, evaluate, link, export check) leaves the key as it was; the script's own top-level code may have run.

| Failure | Rejects with |
|---|---|
| no `dynamicNodes` | `` addNodeFromSource needs `dynamicNodes: { sdk, compile }` on the Registry constructor. `` |
| compile | whatever `compile` threw (esbuild: its own error with `errors`/`warnings`) |
| evaluate | the thrown error unchanged (`SyntaxError`, `ReferenceError`, the script's own, even a non-Error) |
| link | the `isn't available to a custom node` error |
| shape | `` This script must `export default` a component: `component2d({ key: "…", … })`. `` |
| register | `Node type "<key>" is already registered to a different class …` |

## What the deny list is and is not

`DENIED_GLOBALS` is 39 names bound to `undefined`, in groups: the global object and its aliases (`globalThis`, `window`, `self`, `top`, `parent`, `frames`); evaluating more code (`Function`, `importScripts`); the DOM (`document`, `navigator`, `location`, `history`, `screen`, `customElements`); network (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Request`, `Response`, `Headers`); storage and credentials (`localStorage`, `sessionStorage`, `indexedDB`, `caches`, `cookieStore`, `crypto`); other threads and documents (`Worker`, `SharedWorker`, `ServiceWorker`, `MessageChannel`, `BroadcastChannel`, `postMessage`); prompts and navigation (`alert`, `confirm`, `prompt`, `open`, `print`, `Notification`).

- **It is hardening, not a sandbox.** The script runs in the host's own realm because the node it produces must be a live class satisfying `instanceof` against the host's loaded core and joining the same reactive prop graph; a live instance cannot cross a worker or cross-origin boundary. `({}).constructor.constructor("return globalThis")()`, an indirect `eval`, a dynamic `import()` (syntax, so no name can close it) and mutation of the host's own classes all stay open, and `document/tests/dynamic-nodes.test.ts` pins them so a change to the boundary is deliberate. The security boundary is whatever gate the host puts in front of `addNodeFromSource`: a source is not evaluated until something upstream decides it should be.
- **`eval` and `arguments` cannot be listed.** Strict mode refuses to bind them, so naming one would make `new Function` throw and no dynamic node would link; a load-time check in `deny-globals.ts` throws `DENIED_GLOBALS cannot contain …`.
- **The list is a browser-realm list.** Timers, `Date`, `Math`, `Promise`, `console`, `performance` and browser globals such as `Image` or `opener` are not listed and stay reachable; Node globals (`process`, `Buffer`) are not either, because a registry only evaluates dynamic nodes in a browser-realm page (a tab, or headless's own page). Adding a browser API to the list is cheap; leaving one out is the bug.
- **A script may declare a binding with a denied name** (`const frames = …`): the body runs one function in from the denying parameters, so it shadows rather than redeclaring a parameter, and a body that closes that function early is still inside the outer one.

## Invariants and traps

- **`sdk` and every `modules` value must be the host's own loaded instances.** A second copy makes `instanceof` against the host's classes fail silently. `compile` must return CommonJS that assigns `module.exports.default` (or `exports.default`); ES module text fails to evaluate.
- **A script is one script, not a package.** No relative imports, no Node built-ins and no JSX: a component is written with calls.
- **`resolveDynamicNodes` is not exported from any barrel**, so another platform that wants the browser defaults repeats them.

## What the editor fields lower onto, and render details the public guide omits

- **`RenderContext2D.draw` is the seam for drawn text defaults, not the backend.** A backend implements `drawGraphics`; `draw` is final by convention and runs `applyGraphicsTextDefaults` (`render/text-defaults.ts`) first, so every backend resolves an under-specified family identically. A backend overriding `draw` ships a family that never loads and glyphs that never paint.
- **`pushTextStyle(null)` refuses the theme default too** (a component's `ctx.textStyle(null, body)`). It pushes an empty style, while an empty stack falls back to the theme's `default` typography preset (`CanvasRenderContext2D.defaultTextStyle`). `Code` opts out so its token positions stay measured against its own monospaced face.
- **The text merge copies, never mutates.** A node may submit one built `Graphics2D` more than once, each submission under different ambient state, so rewriting the shared instance would leak one scope's resolution into the next. `applyGraphicsTextDefaults` returns the same instance when nothing needs filling in and a copy (`Graphics2D._withOps`) otherwise.
- **A time-varying fill reads the clock at paint time.** A video fill resolves its source frame as it paints (`resolveVideoTimestamp`, against the painting node's `NodeRenderState.elapsed`), so it plays in a custom node's `Graphics2D`, a stroke or a shadow with nothing per frame of its own, and frame N is identical however the playhead reached it. `FillData` (`attributes/shape/fill/registry.ts`) has no per-frame hook.
- **A node that places its children in slots answers `_placementOf(child)`** (`Node2D`, `@internal`) with a `ChildPlacement` (turn, scale, tilt, depth, opacity), applied about the box's centre before the child's own transform, so the child's `x`/`y`/`rotation` and commands keep working relative to the slot. The renderer, picking and `global` all read it, which is what keeps a selection outline on the pixels. A component's `layout` sets it by returning `rotation`, `scale`, `opacity`, `depth`, `rotationX`/`rotationY` in a placement. A node opens a 2.5D space of its own by answering `_spaceCamera()` with a `SpaceCamera` (a component's `render` calls `ctx.space(camera)`, as `OrbitCamera` does); a node already inside a space returns `null` so its children join that one (`ctx.inSpace` tells a component).
- **A node whose children sit in its own coordinates answers `_planeOf(child)`** (`Node2D`, `@internal`; a component's placement `plane`, and its spec `plane` for `_planeOf(null)`) with a `ChildPlane`: `toOffset(x, y)` maps the child's `x`/`y` to a pixel offset (y-up) from the centre of its layout box, `toCoords` is the inverse. Position only, so the child keeps its size, turn and scale. Every position read in `Node2D` goes through `_offset()`, so paint, `global`, the anchors, `moveTo({ target })` and `parentPlanePointAt` agree; the last two answer in the parent's coordinates. `moveTo({ path })` writes path points to `x`/`y` unchanged, so under a plane the path is read in the parent's coordinates. The map need not be linear (a log axis), but then a drag delta is only exact when the pointer starts on the node's centre. `_planeOf(null)` asks for a child that is not there yet; it is what `childPlanePointAt` (the player's `childPlanePoint`) reads to tell a host where a dropped or pasted node goes, and its `null` is how a host knows the children are in pixels. `reparentPlacementAt` (the player's `reparentPlacement`) says what leaves a node looking as it does under another parent: its `x`/`y` values carried there, through that parent's plane or, in pixels, the slot `_slotFor(size)` says its own freeform layout would give the node, and the turn and scale that undo the two parents' own (cameras included, folded as `NodeBox` folds them); a parent that arranges its children in a run or a grid answers `null`.
- **A node with points an editor should drag answers `_handles()`** (`Node2D`, `@internal`; a component's `handles`, `{ entry: { at(state, size), value?(at, state, size) } }`) with `NodeHandle`s, each a `Vector2` prop and where it sits in the node's own frame (y-up, the frame `_localBounds` is in), and `_handleValue(prop, at)` with the value that puts it there. `nodeHandlesAt`/`handleValueAt` (the player's `nodeHandles`/`handleValue`) carry both through `renderMatrix`, so a handle stays on the pixels under any turn, scale, camera or parent plane. A prop the node reads in other units (an arrow's ends in graph units) converts in those two methods, never in the host. A node whose selection is its ink rather than its box answers `_localBounds()` (a component's `bounds`).
- **Each attribute's mapper/tween pair is its ops value**, which the `Types` builders (`components/factory/types.ts`) and the typed properties (`attributes/properties/typed.ts`) both take. Add the next attribute kind to both, never inline at a call site; an entry without a lerp snaps or stands still instead of animating, silently ([attributes.md](attributes.md)).

## Where to look

- `document/tests/dynamic-nodes.test.ts` (registration, scope, denial, what stays reachable, `replace`) and `deny-globals.test.ts` (the list's shape; the load-time check is an `it.todo`).
- `packages/browser/test/dynamic-nodes.test.ts` and `dynamic-nodes-compiler.test.ts` (the real compiler, boot-time strings, lazy initialisation).
- Public authoring guide: [motionscript.dev/docs/custom-node](https://motionscript.dev/docs/custom-node) (`introduction.mdx`, `properties.mdx`, `commands.mdx`, `declaring-assets.mdx`, `graphics/`, `graphics-3d/`).
- `components/factory/tests/capabilities.test.ts` (planes, handles, bounds, node references, `ctx.inSpace`).
