# Contributing to Motion Script

Thanks for your interest in contributing! This guide covers the project
architecture, local setup, and the workflow for changes. By participating, you
agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

For the user-facing guides and the API reference, see
[motionscript.dev/docs](https://motionscript.dev/docs) and
[motionscript.dev/api](https://motionscript.dev/api).

## Prerequisites

- **Node.js** (LTS recommended)
- **[pnpm](https://pnpm.io/)**, the repo's package manager (pinned via
  `packageManager` in the root `package.json`)
- **Rust** (the toolchain `packages/renderer/rust-toolchain.toml` pins) and
  **wasm-bindgen-cli** at the version `packages/renderer/Cargo.lock` names: the
  renderer is built to WebAssembly as part of `pnpm build` (see
  [its README](packages/renderer/README.md))
- A browser with **WebGPU** to run anything (the tests and e2e use SwiftShader's
  adapter, so no GPU is needed)

## Initial setup

```bash
git clone https://github.com/motionscript-dev/motionscript.git
cd motionscript
pnpm install
pnpm build
```

## Repository layout

Motion Script is a **pnpm workspace** orchestrated by **[Turborepo](https://turbo.build/)**.
Workspaces live under `packages/*` (and `packages/components/*`). The root
`package.json` exposes the top-level scripts:

| Script | What it does |
| --- | --- |
| `pnpm build` | `turbo run build` across all packages |
| `pnpm build:lib` | build everything except the docs site and the example apps |
| `pnpm lint` | `turbo run lint` across all packages except the docs site |
| `pnpm typecheck` | `turbo run typecheck` across all packages except the docs site |
| `pnpm test` | `pnpm -r test`, runs every package's tests |
| `pnpm clean` | `turbo run clean` |

## Architecture

Motion Script separates the **animation engine** from the **renderer** from the
**platform**: `core` knows how a scene evolves over time but knows nothing
about pixels; `renderer` (Rust/wgpu on WebGPU) knows how to draw a frame but not
what it draws onto; `browser` builds the renderer in and supplies the entry
points, encoding and audio. `react`
mounts that into a host's UI, and `headless` drives the same browser render
from Node.

```
a project document (JSON: tracks of still / composition / audio clips)
        │
        ▼  engine.open({ document })
    a Session: one clip instance per track
        │
        ├──────────────────────────────┐
        ▼                              ▼
@motionscript/react            @motionscript/headless
  a hook that owns a session,    bundles a project entry with esbuild and
  a canvas bound to it           renders it in headless Chromium
        │                              │
        ▼                              ▼
@motionscript/core      ◀──▶   @motionscript/browser
  engine, no rendering           entry points, export, stills, audio
                                       │ depends on
                                       ▼
                               @motionscript/renderer
                               Rust/wgpu on WebGPU (WASM): 2D, 3D, WGSL
```

### `@motionscript/core`: the engine

The backend-agnostic heart of the library. It has no DOM/canvas dependencies; it
describes *what* should be drawn and *how it changes over time*, leaving the
*how to draw* to a render context. Key areas under `packages/core/src`:

- **`components/`**: the scene graph and its node types. `trees/` holds the
  dimension-agnostic base `Node`, split into `Node2D` (layout and 2D drawing),
  `Node3D` (a transform in space) and `NodeAudio` (sound), and the root
  `Canvas2D`; `factory/` the component factories (`component2d`,
  `component3d`, `componentAudio`) that lower a spec onto them; `modules/`
  the spread-in behaviours; `builtins/` the built-in components by family:
  geometry (`Rect`, `Ellipse`, `Path`, `Polygon`, `Polygram`, `BooleanGroup`,
  `MaskGroup`), text (`Text`, `RichText`), media (`Video`), layout
  (`Camera`), audio and 3D.
- **`attributes/`**: the animatable properties of nodes: layout, shape (fill,
  stroke, corners, shadow, filters/effects, paths), text, and audio. Each
  attribute knows how to interpolate (`lerp`) between values.
- **`props/`**: the storage under every declared property. A `PropSlot` holds a value
  or a thunk, and a bound slot recomputes on every read.
- **`tween/`**: a `Command`: a declared duration plus a pure `at(t)`, and the
  easing/lerp math behind it. A command carries its own placement, so
  sequencing is `at + duration`.
- **`document/`**: what a scene is — still, composition and audio documents, the
  `ProjectDocument` that lays them on tracks, the validator, and the per-engine
  `Registry` that turns a node key into a class.
- **`runtime/`**: what plays a project — `Engine`/`Session`, per-track clip
  instances, evaluation (`StateEvaluator`), and playback.
- **`layout/`**: `flowOps`, the flow layout every 2D node runs on its children:
  freeform, runs (wrapped or not) and grid.
- **`render/`** and **`render3d/`**: render descriptors and the abstract
  `RenderContext2D` / `RenderContext3D` interfaces a backend implements.
- **`project/`**: the theme and typography types a project carries.
- **`assets/`**: the asset manifest and manager (fonts, images, audio).
- **`platform/`**: platform seams the backend fills in: the ticker and the
  storage adapter.

### `@motionscript/renderer`: the renderer

A retained 2D/3D renderer in Rust/wgpu compiled to WebAssembly, and the adapter
that implements `core`'s `RenderContext2D` against it. Building it needs Rust;
its design is `packages/renderer/DESIGN.md`.

### `@motionscript/browser`: the browser platform

The entry points over the renderer. Notable exports
(`packages/browser/src/index.ts`):

- `createBrowserEngine`: an `Engine` with every browser seam wired in;
  `WebGpuUnavailableError` without WebGPU.
- `exportVideo`, `exportScreenshot`, `StillRenderer`: video and single frames.
- `WebAudioPlayer`, `WebTicker`: the browser implementations of `core`'s
  audio and clock seams.

### `@motionscript/react`: React bindings

`useMotionPlayer` opens a session on a document and owns its transport;
`MotionStage` is a canvas bound to that session. The host builds the engine
and passes it in.

### `@motionscript/headless`: rendering from Node

`createServerEngine` bundles a project entry with esbuild, loads it into a
headless Chromium page driven by Playwright, and renders it there with the
browser engine.

### Component kits

`packages/components/*` holds the published component kits: `audio`, `charts`,
`code`, `geo`, `grids`, `math` and `patterns`. A kit is
written against `@motionscript/sdk` (and `@motionscript/sdk/component`), which
it takes as a peer dependency; its lint config rejects imports from
`@motionscript/core`. When a kit needs a name the SDK lacks and a component
author would reasonably use it, add it to `packages/core/src/sdk/index.ts`.

### Supporting workspaces

- **`docs`**: the Next.js docs site behind [motionscript.dev](https://motionscript.dev).
- **`e2e`**: visual regression tests.
- **`apps/*`**: example hosts (a React app and a Node render server) used to
  exercise the engine during development.

## Per-package development

Most library packages support `dev`, `build`, `lint`, `typecheck`, and `test`
(where applicable). Run them inside a package or target one with a filter:

```bash
# work on the engine with a watch build
pnpm --filter @motionscript/core dev

# run the example React host
pnpm dev react

# run core's tests in watch mode
pnpm --filter @motionscript/core test
```

### Build orchestration & tsconfig convention

**Turbo owns build ordering, not TypeScript.** Each package compiles with plain
`tsc -p tsconfig.build.json` (project mode), *not* `tsc -b` (build mode). The
distinction matters: `tsc -b` walks a package's `references` and rebuilds its
dependencies, so running it under Turbo (which *also* builds those dependencies
via `dependsOn: ["^build"]`) makes two processes write the same `dist/`
concurrently, a race that corrupts output and intermittently fails the first
clean build. `tsc -p` compiles only the current package and reads its
dependencies' already-built `dist/*.d.ts`, which Turbo guarantees exist first.

Conventions for a buildable package:

- **Project `references` are for the editor only.** They give the language
  server cross-package go-to-definition. Point a reference at the dependency's
  **`tsconfig.build.json`** (e.g. `{ "path": "../core/tsconfig.build.json" }`).
  Never the bare directory: it resolves to the test-inclusive `tsconfig.json`
  and diverges from what the dependency actually builds.
- **Two tsconfigs:** `tsconfig.json` (test-inclusive, used by the editor and
  `typecheck`) and `tsconfig.build.json` (extends it, excludes tests, the emit
  config that `build` and consumer `references` point at).
- **`tsBuildInfoFile` lives in `dist/`** (`"dist/tsconfig.build.tsbuildinfo"`),
  so Turbo's `dist/**` output cache stores it alongside the emitted files.
  Caching `dist` without its buildinfo causes stale-declaration bugs on cache
  restore. Each package's `files` excludes it from the published tarball
  (`"!dist/**/*.tsbuildinfo"`).
- **Scripts:** `build` = `tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json`
  (or `&& vite build` for bundled packages like `react`);
  `typecheck` = `tsc -p tsconfig.json --noEmit` (or `tsc -b --noEmit` for the
  Vite app/solution packages, safe because the `typecheck` task emits nothing
  and never races on `dist`); `clean` = `rimraf --glob dist .turbo *.tsbuildinfo`.

## Testing

- **Unit tests:** [Vitest](https://vitest.dev/), `pnpm --filter <pkg> test`, or
  `pnpm test` for everything.
- **End-to-end:** `packages/e2e` renders its scenes through
  `@motionscript/headless` on SwiftShader's WebGPU adapter and pixel-diffs them
  against the committed `wgpu-baseline/`, `pnpm test:e2e` (see
  [its README](packages/e2e/README.md)). On Linux, run browser tests and e2e
  under `xvfb-run`: a headless page reads a WebGPU canvas back empty.

Please add or update tests alongside behavior changes.

## Commits and branches

These rules apply to everyone, people and coding agents alike. Agents commit or
push only when asked to; when asked, follow this section exactly.

### Commit messages

Commits follow [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<scope>)<!>: <subject>

<body: why the change is needed, not a restatement of the diff>

<footers>
```

| Type | Use it for |
| --- | --- |
| `feat` | behaviour a user or caller can newly do |
| `fix` | a bug fix |
| `perf` | a change whose point is speed or memory |
| `refactor` | restructuring with no behaviour change |
| `docs` | documentation and comments only |
| `test` | adding or fixing tests only |
| `build` | build config, dependencies, packaging |
| `ci` | CI workflows and release automation |
| `chore` | anything else that ships nothing (tooling, cleanup) |
| `revert` | undoing an earlier commit; the body names it |

- **Subject**: imperative mood ("add", not "added"), lower case after the colon,
  no trailing period, the whole first line at most 72 characters.
- **Scope**: optional, lower case, the package or area touched (list below).
  Several scopes are comma-separated with no space: `docs(site,e2e): ...`.
- **Breaking change**: put `!` before the colon and add a `BREAKING CHANGE:`
  footer saying what callers must do now.
- **Body**: wrap at about 72 columns; say why, and what you ruled out when it is
  not obvious. Link issues in a footer: `Closes #123` or `Refs #123`.
- **One logical change per commit.** Never "wip", "fix stuff", "more" or
  "update". Move or rename files in their own commit when you can, so history
  follows them.
- Merge commits that git writes for a merged branch keep git's own message.

Scopes in use:

- Packages: `core`, `renderer`, `browser`, `headless`, `react`, `sdk`, `cli`, `e2e`
- Component kits: `charts`, `geography`, `audio`, `code`, `math`, `grids`, `patterns`
- Other workspaces: `apps` (`apps/engine`, `apps/react`, `apps/shaders`)
- Repo-wide: `deps`, `release`, `changeset`, `ci`

### Commits and changesets are separate

A commit type does not version anything. A user-facing change to a published
package also needs a changeset (`pnpm exec changeset`); a breaking one needs a
`**Breaking:**` note in it, which CI checks (`scripts/check-changesets.mjs`,
[release and CI](scripts/runbooks/release-and-ci.md)). A commit marked `!` and its
changeset should say the same thing.

### Branches

A branch is named for the kind of change it carries:

```text
<type>/<short-kebab-description>          feat/geo-border-cache
<type>/<issue>-<short-kebab-description>  fix/123-export-audio-drift
release/<version>                         release/0.1.0-alpha.8
```

- `<type>` is one of the commit types above, so the branch name says what the
  commit subjects will.
- Lower case, hyphens, ASCII, at most about 50 characters. No names, dates or
  tool prefixes (`claude/`, `wip/`, `tmp/`).
- Work goes straight to `alpha`, which publishes an alpha once CI passes;
  `main` only moves by `pnpm promote`, a fast-forward to `alpha`, and each
  promote publishes a stable version (`scripts/runbooks/release-and-ci.md`). A branch is for work that should not
  land yet: keep it short-lived and one topic, fast-forward it into `alpha` and
  delete it.
- Contributions from outside the team arrive as pull requests; title one as a
  Conventional Commit line, in the format above, and say why in the
  description.

## Submitting changes

1. **Fork** the repo and create a branch off `alpha`, named as in
   [Commits and branches](#commits-and-branches)
   (`git checkout -b feat/my-feature`).
2. Make your change. Keep it focused; match the style and idioms of the
   surrounding code.
3. Run **lint, typecheck, build, and tests** for the packages you touched:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm build
   pnpm test
   ```
4. Add a changeset (`pnpm exec changeset`) for a user-facing change to a published
   package. The repo is in Changesets pre-release mode, so packages version as
   `0.1.0-alpha.x`.
5. Write Conventional Commit messages that describe the *why*, not just the
   *what* ([Commits and branches](#commits-and-branches)).
6. Open a **pull request** against `alpha`, titled as a Conventional Commit, with a description of the change and
   any relevant context (screenshots/recordings help for editor or rendering
   changes).

## Reporting issues

Open an issue on [GitHub](https://github.com/motionscript-dev/motionscript/issues)
with steps to reproduce, what you expected, and what happened. For rendering
bugs, a minimal scene and your platform/browser are very helpful.

## License

By contributing, you agree that your contributions will be licensed under the
project's [Apache License 2.0](LICENSE).
