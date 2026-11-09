# @motionscript/e2e

Visual end-to-end tests for Motion Script. One scene per entry in
[`src/scenes/catalog.json`](src/scenes/catalog.json), rendered at **960×540
(Quarter HD), 30 fps** through `@motionscript/headless` on SwiftShader's WebGPU
adapter. The suite, the **wgpu lane**, captures the **first, mid and last frame**
of each scene listed in [`wgpu-lane.json`](wgpu-lane.json) and pixel-diffs them
against the PNGs committed in `wgpu-baseline/`, so a rendering change shows up as
a visible diff and a non-zero exit code.

This package is private (never published). It exists only to render and compare.

---

## How it works

```
src/scenes/<id>.ts ──(src/doc el() builder)──▶ a CompositionDocument
src/scenes/catalog.json ──gen──▶ src/scenes/catalog.ts
        │
        │   shoot.ts builds each scene's document in Node as a one-track project
        │   (projectOf, src/project.ts — 960×540 · 30fps), renders it through
        │   @motionscript/headless and writes 3 PNGs per scene:
        ▼
   out/wgpu/<id>.{first,mid,last}.png
        │
        │   wgpu-lane.ts pixel-diffs the listed scenes against wgpu-baseline/ (pixelmatch)
        ▼
   out/wgpu-diff/<id>.<frame>.png  +  out/wgpu-summary.json
```

- **One scene file per catalog entry.** Each `src/scenes/<id>.ts`
  default-exports a `CompositionDocument`, its tree written with the local
  builder in `src/doc/`: `el(Type, { ...props, children: [...] })` is a node row
  keyed through the registry, and the steps after the tree are placed the way a
  chain places them — each after the previous, a number holds, an array runs
  together. Anything JSON
  cannot express lives in an e2e node type (`src/components/`, registered in
  `src/nodes.ts`). Unauthored entries are placeholder stubs (rendering the scene
  id), which still produce a valid, comparable frame. See
  [Adding / filling in scenes](#adding--filling-in-scenes).
- **Fixed-length scenes.** Each scene runs ~2s (≈60 frames). The harness reads
  the real frame count per scene and resolves first / mid / last to frames
  `0 / floor((n-1)/2) / n-1` (see [`scripts/lib/frames.ts`](scripts/lib/frames.ts)).
- **WGSL shader scenes.** `scripts/wgpu/scenes/` holds four `wgsl-*` scenes beside
  the catalog, as the lane first baselined its user-shader coverage.

---

## The suite (the wgpu lane)

```bash
pnpm build:lib                                        # builds the renderer too, so Rust is needed
pnpm --filter @motionscript/e2e run test:e2e          # shoot the listed scenes + compare; exits 1 on a failed frame
pnpm --filter @motionscript/e2e run test:e2e -- --update   # rewrite the baseline after a deliberate change
pnpm --filter @motionscript/e2e run test:e2e -- --scenes rect-basic,text-basic
pnpm --filter @motionscript/e2e run test:e2e -- --shard 1/2   # every other scene, as CI's two e2e jobs split it
```

`test:wgpu` is the same script. A frame fails when it changes more than its
scene's `threshold` (percent of pixels, pixelmatch at `pixelThreshold`), is
missing on either side, or is fully transparent (every scene fills its stage, so a
renderer that drew nothing must neither pass nor be recorded by `--update`).

- **WebGPU without a GPU.** The page runs on SwiftShader's adapter
  (headless's `softwareRender`, `--use-webgpu-adapter=swiftshader`), so the frames
  match across machines, not a GPU's.
- **Headed on Linux.** Headless Chromium on Linux reads a SwiftShader WebGPU
  canvas back empty (buffers and textures work, the canvas does not), so there
  the harness launches a windowed Chromium (headless's `headed`) and needs a
  display: `xvfb-run -a pnpm --filter @motionscript/e2e run test:e2e`, as CI
  runs it. On Windows it runs headless.
- **One baseline for both.** Frames from Windows (headless) and Linux (headed
  under Xvfb, Playwright's noble image) matched pixel for pixel when the
  baseline was recorded, so it can be recorded on either.
- Only the listed scenes are compared. Add one by naming it in `wgpu-lane.json` and
  running `--update`; a scene that draws something wrong is a renderer bug to fix,
  not a frame to record.

## Visually verifying a change

To see what a change to the engine actually draws, render the scenes. No dev
server is involved: they render through `@motionscript/headless`, which imports
the *built* `dist/` of the packages.

```bash
pnpm build:lib                                        # engine changes need a build first
pnpm --filter @motionscript/e2e run screenshot                       # every scene
pnpm --filter @motionscript/e2e run screenshot -- --scenes rect-basic
```

Frames land in `packages/e2e/out/wgpu/<id>.<first|mid|last>.png`. Open the PNG
rather than assuming the render is right. `--scenes` takes ids or PascalCase names,
comma separated. A scene that fails to build or render is reported with its first
error line and the run moves on, exiting 1 once it is done.

- **`scripts/golden.ts`** diffs the current renders in `out/wgpu/` against recorded
  frames, across every scene rather than the lane's subset:
  `pnpm --filter @motionscript/e2e exec tsx scripts/golden.ts --dir <path>`
  (or `MS_GOLDEN_DIR`, default `golden/`). Its `--threshold` is pixelmatch's
  per-pixel colour distance, so any differing pixel marks a frame changed, and
  changed frames are written to `out/golden-diff/`. Goldens are local scratch:
  `golden/` and `baseline-*/` are gitignored.
- **`scripts/snapshot-document-fixtures.ts`** writes this release's documents into
  core's saved-document corpus (`packages/core/test/fixtures/documents/<version>/`):
  the scenes that name only core's types, a coverage set, and the vocabulary. Run
  once per release (`scripts/runbooks/release-and-ci.md`, "The saved-document corpus").

## CI (GitHub Actions)

The `renderer` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
runs the suite under Xvfb on every PR and push to `main` and uploads `out/wgpu`,
`out/wgpu-diff` and `out/wgpu-summary.json` on every run, pass or fail.

---

## Adding / filling in scenes

A stub scene looks like:

```ts
import { placeholder } from './_lib';

export default placeholder('rect-basic');
```

To make it a **real** test, replace it with an actual scene. Keep the filename
(`<id>.ts`): the id is the catalog key. Author to ~2 seconds total and end on
`holdTail(usedSeconds)` so the mid frame lands on something meaningful:

```ts
import { Rect } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

const rect = createRef<Rect>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(el(Rect, { ref: rect, width: 320, height: 200, fill: 'primary', scale: 0.6 }));
}, [
    () => rect().to({ data: { scale: 1 }, duration: 1, easing: easeInOut('quad') }),
    holdTail(1),   // pad to the standard 2s runtime
]);
```

Every prop must be JSON: the builder throws on a function or a class instance,
because the document crosses into the page as JSON. A value that follows
another node, or a closure, belongs in an e2e node type.

The hand-authored sample scenes (good references, one per area) include:
`rect-basic`, `rect-corner-radius`, `ellipse-circle`, `polygram-star-5`,
`text-basic`, `fill-linear-gradient`, `transform-position`,
`transform-rotation`, `transform-scale-uniform`, `ease-bounce`,
`stroke-dash-animated`, `shadow-drop-basic`, `effect-blur`, `camera-zoom`,
`cardinal-node-center`, `shape-start-end-rect`, `latex-basic`, `code-basic`.

After adding an entry to `src/scenes/catalog.json` and its `<id>.ts`, run
`pnpm --filter @motionscript/e2e run gen` to regenerate `catalog.ts`.

Rules a scene file lives by:

- **The catalog entry is the scene.** `id` is the file name (`src/scenes/<id>.ts`)
  and the track id; a scene file with no entry is never rendered, and `gen` never
  overwrites an existing file. `catalog.ts` is generated and never edited.
- **A tree is `el` calls, not component calls.** `Rect({ … })` builds a node;
  `el(Rect, { … })` records the row a document holds. Its props are the node's,
  plus `ref`, `startAt`/`endAt` (the row's span, never handed to the node) and
  `children`: an array, where nested arrays flatten and `false`/`null`/`undefined`
  drop out, so a plain array is a fragment (`stage.add([el(A), el(B)])`).
- **Steps place themselves.** A number holds, a function is one command at the
  running time (which then advances by its duration), an array of functions runs
  together and advances by the longest. A ref's method records
  `{ type, targetId, duration, easing, args }`, `duration` is required, and a ref
  accepts only `set(props)` while the tree is being built.
- **Every value is plain data.** A function or a class instance in a prop throws,
  naming the path; a prop that follows another node, or a typed array, belongs in
  an e2e node type (`src/nodes.ts`). `el`'s type must be a component or a node
  class: anything else throws, and so does one with no registry key
  (`Name is not a registered node type`).
- **Media and fonts.** A media `src` must name a file under `public/` (the manifest
  is built from it on every run), and a font family must be `Inter` or `Fira Mono`.

---

## Layout

```
packages/e2e/
├── src/
│   ├── project.ts            # nodes, FPS/VIEWPORT/THEME, projectOf(id, clip)
│   ├── nodes.ts              # the e2e node types documents name
│   ├── components/           # those node types
│   ├── doc/                  # el() → document builder: scene(), refs, steps
│   ├── motion-script.d.ts
│   └── scenes/
│       ├── _lib.ts           # SCENE_SECONDS, holdTail(), placeholder()
│       ├── catalog.json      # the scene list: id, name, section, description
│       ├── catalog.ts        # AUTO-GENERATED from catalog.json: lazy loaders
│       └── <id>.ts           # one document per entry
├── fonts/                    # Inter and Fira Mono (SIL OFL 1.1), registered by shoot.ts
├── wgpu-lane.json            # the scenes the suite compares, and their thresholds
├── wgpu-baseline/            # the committed frames (<id>.<first|mid|last>.png)
├── scripts/
│   ├── gen-scenes.ts         # catalog.json → catalog.ts
│   ├── golden.ts             # diff a run against recorded frames (--dir)
│   ├── shoot.ts              # render first/mid/last per scene
│   ├── wgpu-lane.ts          # the suite: shoot the listed scenes, diff against wgpu-baseline/
│   ├── wgpu/scenes/          # the wgsl-* shader scenes
│   ├── snapshot-document-fixtures.ts  # this release's documents → core's fixture corpus
│   └── lib/                  # frames.ts, scene-name.ts
└── out/                      # GENERATED screenshots and diffs (gitignored)
```

---

## Notes & gotchas

- **Async components.** `Code`/`Latex` nodes resolve fonts/highlighting
  asynchronously; their layout can settle a frame late, showing up as a small
  (~1%) diff even between identical builds. Treat sub-threshold variance on those
  scenes as noise.
- **Soft failures fail the scene.** A browser shapes against a fallback face
  instead of failing, and a blank or wrong-typeface frame diffs clean against any
  other. So a page message of type `error`, or one matching an unloaded font,
  asset, colour format or video track, fails the scene being rendered
  (`page reported: …`). The faces are `fonts/inter/inter-regular.ttf` and
  `fonts/fira-mono/fira-mono.ttf`, tracked here; the italic face is deliberately
  not registered, because the adapter would then set every Inter scene in oblique.
- **Exit codes.** Scripts exit 0 on success and 1 on a render, comparison or fatal
  error.
