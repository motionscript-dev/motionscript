# Architecture

Motion Script is an open-source motion design engine: it renders scenes through a WebGPU renderer (Rust/wgpu), in a browser or from Node.

**A scene is data, not code.** It is a `StillDocument` (nodes and props) or a `CompositionDocument` (the same nodes, each with a `startAt`/`endAt` span, plus commands placed at times that animate them): plain JSON, described in `packages/core/src/document/`. **Node types are the code half**: a component (one spec handed to `component2d`, `component3d` or `componentAudio`, which generates the node class) registered under its string key, which is also where a custom node joins the system and where anything JSON cannot express belongs. A frame is a pure function of its time: a scene is built once and asked what it looks like at `t`, never advanced to it ([why](packages/core/docs/why.md#a-frame-is-a-pure-function-of-its-time)).

The rules behind this layout are in [`RULES.md`](RULES.md); the reasons behind non-obvious choices are in the `docs/why.md` of the package that owns them ([`core`](packages/core/docs/why.md), [`renderer`](packages/renderer/docs/why.md)); terms are in [`ARCHITECTURE.md#glossary`](ARCHITECTURE.md#glossary).

## Layers

The **engine** (`core`) knows how a scene evolves over time but nothing about pixels. The **renderer** (`renderer`, Rust/wgpu on WebGPU, compiled to WebAssembly) knows how to draw a frame, 2D and 3D, but not what it is drawing onto; it is the only backend, and a browser without WebGPU cannot draw ([why](packages/renderer/docs/why.md#webgpu-is-the-only-renderer-canvaskit-sksl-and-threejs-are-removed)). A **platform** (`browser`) builds the renderer in and supplies the entry points, the export frame loop, encoding and audio. `react` mounts all of that into a host's UI, and `headless` drives the same browser render from Node through a headless Chromium page.

```
a project document (JSON: tracks of still / composition / audio clips)
        │
        ▼  engine.open({ document }) — a lone clip is a one-track project
    a Session: one clip instance per track, each a compiled timeline over a Canvas2D
        │
        ├───────────────────────────────────┐
        ▼                                   ▼
@motionscript/react         @motionscript/headless
  useMotionPlayer + MotionStage:  Node-side driver: bundles the project entry
  a session and its transport,    with esbuild, runs it in headless Chromium.
  a canvas bound to it.           Same render, from a server or a script.
        │ uses                             │ uses
        ├──────────────────────────────┬────┘
        ▼                              ▼
@motionscript/core          @motionscript/browser
  engine, no rendering         entry points, export frame loop, encoding, audio;
  Node → Node2D | Node3D       draws through the renderer it builds in
  props/tweens/layout                  │ depends on
                                       ▼
     implements core's        @motionscript/renderer
     RenderContext2D          Rust/wgpu (WebGPU, WASM): 2D and 3D, WGSL shaders
```

## Packages

| Package | Role |
|---|---|
| `core` | The animation engine: documents, registry, expressions, timeline, commands, scene graph (`Node2D`, `Node3D`, `NodeAudio`), layout, runtime and session. No DOM, no rendering. |
| `sdk` | The authoring surface: a deliberate subset of core (the component factories and their modules, the built-in components, attributes and their ops values, `Graphics2D`, commands, `Registry`). No classes to extend, no decorators, no JSX. Component kits build on it, never on core. |
| `browser` | The browser platform: `createBrowserEngine`, stills, the export frame loop and encoding, audio; draws with `renderer`, a dependency. |
| `react` | `useMotionPlayer` and `MotionStage`: a session, its transport and a canvas. |
| `headless` | Renders from Node by driving the browser engine in headless Chromium. |
| `components/*` | Seven published kits of scene components (audio, charts, code, geography, grids, math, patterns), built on the SDK. `geography` also carries the Natural Earth outlines its `GeoBorder` draws. |
| `renderer` | The renderer, in Rust/wgpu (WebGPU): a retained 2D/3D renderer compiled to WASM, its storage and text measurement, and an adapter implementing `RenderContext2D` that drives core's render path. Imports nothing from `browser`. Building it needs Rust. |
| `e2e` | Visual regression: renders scenes through `headless` on SwiftShader's WebGPU adapter and pixel-diffs them against the committed `wgpu-baseline/` (not published). |
| `apps/*` | `react` (a Vite player page) and `engine` (an HTTP render server) run against built `dist/`; `shaders` is the demo kit of custom nodes on custom WGSL shaders they import. |

## Dependency rules

- `core` imports no renderer and no platform; it describes 3D as data, and the renderer draws it ([why](packages/core/docs/why.md#core-describes-3d-as-data-it-never-imports-a-3d-library)).
- `renderer` depends on `core` only; `browser` depends on `renderer`, and `headless` and `react` on `browser`. A dependency the other way is a cycle turbo refuses, so what the renderer needs from the platform (`loadAssetBytes`) is handed to `createWgpuRenderer`.
- `browser`, `headless` and `react` wrap core's `Engine`/`Session` and the renderer. They add platform I/O but no scene semantics: export, stills and playback of the same document produce the same pixels. User shaders are WGSL ([why](packages/renderer/docs/why.md#user-shaders-are-wgsl-sksl-loads-but-does-not-draw)); a shader stored in the retired SkSL language draws nothing and is reported.
- Kits take authoring names from `sdk`; only platform and renderer packages (`renderer`, `browser`, `headless`, `react`) use `core` directly. Kit lint configs forbid `@motionscript/core*`.
- `@motionscript/core` is a peer dependency of everything built on it: two copies in one module graph break class identity silently.
- Each package exposes a deliberate barrel plus documented subpaths; lint (`import-x/no-internal-modules`, `no-cycle`) enforces it. Members prefixed `_` are outside the authoring API.
- One registry per engine; packages register nothing on import ([why](packages/core/docs/why.md#one-registry-per-engine-a-decorator-declares-it-does-not-register)).

## Where documentation lives

| Question | Look in |
|---|---|
| How do I work here? Commands, traps | `CLAUDE.md`, then the nested `CLAUDE.md` of the directory you are editing |
| What does this package own, and how | its `README.md` and `docs/` (core has the most) |
| Procedures (build orchestration, release and CI) | `scripts/runbooks/` |
| Why was it built this way | `docs/why.md` in the package that owns it |
| Non-negotiables | `RULES.md` |
| What does this word mean | `ARCHITECTURE.md#glossary` |
| Using the engine (authors, not contributors) | the docs site, [motionscript.dev/docs](https://motionscript.dev/docs) |

## Glossary

Terms that carry a specific meaning in this repo.

| Term | Meaning |
|---|---|
| **Document** | A scene as JSON: a `StillDocument` (node rows), a `CompositionDocument` (node rows with `startAt`/`endAt` spans plus command rows) or a project document. Validated by core. |
| **Project document** | Tracks of still, composition and audio clips laid against each other in time. What `Session`, the exporter and the still renderer play; a lone clip is lifted into a one-track project (`asProjectDocument`). |
| **Clip** | One document played on one track of a project. A built `ClipInstance` per track, compiled by `ClipTimeline`. |
| **Node** | A row naming a type, a parent, a layer order and props. Its node type (the code half, a component) is registered under the row's `type` key. Three trees: `Node2D`, `Node3D`, `NodeAudio`. |
| **Component** | A node type written as one spec object handed to a factory: `component2d` (in a box), `component3d` (in space) or `componentAudio` (a sound or a bus). The factory generates a subclass of that tree's node class, declares its type key (what a row's `type` names), and writes its entries and commands where the registry reads them. Calling it builds a node. |
| **State entry** | A field of a component's `state`: a plain number, string or boolean, or a `Types` builder that knows how its value resolves and interpolates. Public entries are the node's props; a private one (`{ private: true }`) is written only by its commands. |
| **Module** | A plain ES module of `state`, `commands` and pure helpers that a component spreads in and calls (`Paint`, `Flow`, `Shapes`, `View3D`, a kit's `ViewportPattern`). What a base class was. |
| **Piece** | What a component's command returns: a timed part (`tween`, `animate`, `sound`, `wait`) or a composition of parts (`together`, `sequence`, `stagger`), built from the `timeline` the command is handed. |
| **Command** | A row that animates a node or variable: a declared `duration` plus a pure `at(t)`, placed at a time. A document's command rows never add, remove or reparent nodes (a node type may still expose tree-editing commands such as `addChildAt` for scenes built in code). |
| **Variable** | A named value with no place in the tree. Props follow it through expressions; one command can drive many nodes. A constant is a variable no command drives. |
| **Expression** | A prop whose value is a string beginning with `=`. `[id]` reads a variable; `[key.prop]` reads another node's prop. |
| **Key (`NodeSpec.key`)** | An optional, never generated handle that an expression's `[key.prop]` resolves against. Not in the id space. |
| **Registry** | The per-engine table that turns `"rect"` into a node type, `"fillTo"` into an animation, `"color"` into a lerp and `"swirl"` into a shader. `engine.registry`. |
| **Ops value** | The one implementation of an attribute's semantics (`fillOps`, `strokeOps`, `flowOps`, …): `resolve`/`lerp` plus the attribute's own helpers. Renderers, hosts and kits consume it, never re-derive it. |
| **Engine** | What a host constructs to open documents (`createBrowserEngine`, `createServerEngine`). Owns a registry and the platform seams. |
| **Session** | An opened project: one clip instance per track, its playback controller and asset timeline. |
| **Host** | An application embedding the engine (a player page, a server, an editor). Named only as a generic role in this repo's docs. |
| **Renderer** | `@motionscript/renderer`: Rust/wgpu on WebGPU compiled to WASM, the one backend implementing `RenderContext2D` / `RenderContext3D`. `@motionscript/browser` builds it in. |
| **Platform** | The package supplying surface, media decode, encoding and audio to a renderer: `browser`. |
| **Kit** | A published package of components built on `@motionscript/sdk` (`packages/components/*`) and exported as a `NODES` array plus a `kit` barrel. |
| **Declared asset** | An image, font, video or loader a node announces so the runtime loads it before it draws: a component's typed entries (`Types.fill`, `Types.image`, …) declare themselves, and its `load` declares the rest. A sound is scheduled from the command that plays it. |
| **wgpu lane** | The e2e suite: scenes in `packages/e2e/wgpu-lane.json` drawn on SwiftShader's WebGPU adapter and diffed against `wgpu-baseline/`. |
