# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Motion Script is an open-source motion design engine: it renders "scenes"
through a WebGPU renderer (Rust/wgpu), in a browser or from Node.

**A scene is data, not code.** It is a `StillDocument` (nodes and props) or a
`CompositionDocument` (the same nodes, each with a `startAt`/`endAt` span, plus
commands placed at times that animate them) — plain JSON, described in
`packages/core/src/document/`. **Node types are the code half**: a component
(one spec object handed to `component2d`, `component3d` or `componentAudio`,
which generates the node class) registered under its string key, which is also
where a custom node joins the system and where anything JSON cannot express
belongs. A frame is a **pure function of its time**: a scene is built once and
asked what it looks like at `t`, never advanced to it.

This file is the index and the rules that cross every package. Each package has
a `README.md`, the larger ones a `docs/` folder, and a directory with its own
`CLAUDE.md` has more rules for editing it (loaded when you work there).

| For | Read |
| --- | --- |
| Layers, packages, dependency rules, the layer diagram | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| How the engine works (registry, expressions, timeline, assets, 3D, …) | `packages/core/docs/` |
| Non-negotiable rules | [`RULES.md`](RULES.md) |
| Why it is built this way | `docs/why.md` in [`core`](packages/core/docs/why.md) and [`renderer`](packages/renderer/docs/why.md) |
| Which root script to run, and when | [`scripts/README.md`](scripts/README.md) |
| Build orchestration, release and CI | [`scripts/runbooks/`](scripts/runbooks) |
| What a word means here | [`ARCHITECTURE.md#glossary`](ARCHITECTURE.md#glossary) |
| Using the engine (authors, not contributors) | the docs site, [motionscript.dev/docs](https://motionscript.dev/docs) |

## Commands

pnpm workspace + Turborepo. Node.js LTS, pnpm (pinned via `packageManager` in
root `package.json`).

```bash
pnpm install
pnpm build            # turbo run build, all packages, topological order
pnpm build:lib        # build everything except apps/* (CI runs this before tests; needs Rust for the renderer)
pnpm test             # pnpm -r test, every package's vitest suite
pnpm lint             # turbo run lint, every package
pnpm typecheck        # turbo run typecheck, every package
pnpm check            # CI's checks in one go: build:lib, notices, changesets, lint, typecheck, test
pnpm dev [react|engine...]        # the example hosts (after build:lib)
pnpm release [--dry-run]          # what CI runs on alpha (prereleases) and main (stable); by hand for a first publish
pnpm promote [--dry-run]          # fast-forward main to alpha once alpha's CI passed: publishes the stable version
pnpm clean            # turbo run clean
```

Per package (every TypeScript library package supports `build`, `lint` and
`typecheck`; most also `dev` and `test`):

```bash
pnpm --filter @motionscript/core dev          # watch build
pnpm --filter @motionscript/core test         # vitest, watch mode
pnpm --filter @motionscript/core test -- run  # single run, no watch
pnpm --filter @motionscript/core test -- run src/document/tests/timeline.test.ts   # one file
```

`@motionscript/renderer` is Rust compiled to WebAssembly, and `@motionscript/browser`
depends on it, so `pnpm build:lib` needs the pinned toolchain and
`wasm-bindgen-cli` (`packages/renderer/README.md`). `@motionscript/browser`'s tests
run in a real Chromium on SwiftShader's WebGPU adapter via
`@vitest/browser-playwright` — install it once with
`pnpm --filter @motionscript/browser exec playwright install --with-deps chromium`.
Its tests import the **built** `dist/` of core and the renderer, so run
`pnpm build:lib` before `pnpm --filter @motionscript/browser test` on a fresh
checkout. On Linux a headless page reads a WebGPU canvas back empty, so run them
headed: `HEADED=1 xvfb-run -a pnpm test`.

CI (`.github/workflows/ci.yml`) builds once, with the renderer's WASM from a cache
keyed on its Rust inputs. Then, in parallel on that build, it runs lint and
typecheck, the Node tests, the browser tests and the e2e wgpu lane (each split in
two), and beside them the Rust tests. A `gate` job (`scripts/ci-tested.mjs`) skips
the tests when the code already passed and only release bookkeeping changed since,
as after `pnpm promote`. Release publishes CI's build (`release.mjs --prebuilt`).
Details: `scripts/runbooks/release-and-ci.md`.

### Visually verifying a change

`packages/e2e` renders every scene through `@motionscript/headless` (a Chromium
page on SwiftShader's WebGPU adapter — no dev server). Engine changes need a build first:

```bash
pnpm build:lib
pnpm --filter @motionscript/e2e run screenshot -- --scenes rect-basic
```

Frames land in `packages/e2e/out/wgpu/<id>.<first|mid|last>.png` — read the PNG
rather than assuming the render is right. Full workflow and the diff scripts:
`packages/e2e/README.md`.

### Build config traps

**Turbo owns build ordering, not TypeScript.** Each package builds with plain
`tsc -p tsconfig.build.json`, never `tsc -b`: build mode would rebuild
dependencies itself, race with Turbo's `dependsOn: ["^build"]` and corrupt
`dist/` on a clean build. Every package has two tsconfigs (test-inclusive
`tsconfig.json`, and `tsconfig.build.json` that excludes tests), and tests must
be in the test-inclusive `include` or nothing type-checks them. Read
`scripts/runbooks/build-orchestration.md` before touching a package's build config.

## Code style

Two conventions being actively rolled in as files are touched — apply them to
any file you edit, not just new ones.

**Comments are minimal, and only for a non-obvious WHY.** Not what a
well-named symbol already says, not a restatement of the code, not a
paragraph where a clause would do. A docblock earns more than one line only
when the method has a real invariant or gotcha to warn about — most don't.

**Class member order** (core's own classes): `declare`d property fields →
constructor → command methods → protected/overridable hooks (`renderSelf`,
`resolveContext`, …) → internal (`_`-prefixed) state → internal (`_`-prefixed)
helper methods, then one `declareMembers(Class, { … })` after the class body
registering the properties (`property(…)`) and commands (`command(…)`), in the
order a host's inspector lists them. Anything not part of the authoring API is
prefixed `_`; that prefix *is* the "not authoring surface" marker. A
foundational class with several distinct kinds of hook may reasonably group by
concern instead. A component spec's fields go in the order
`packages/components/CLAUDE.md` gives. Nothing uses decorator syntax: no
tsconfig enables `experimentalDecorators`.

A change to behaviour that a README, `docs/` file or nested `CLAUDE.md`
describes updates that doc in the same commit.

## Architecture in brief

The **engine** (`core`) knows how a scene evolves over time but nothing about
pixels; the **renderer** (`renderer`, Rust/wgpu on WebGPU, the only backend) knows
how to draw a frame but not what it is drawing onto; a **platform** (`browser`,
which builds the renderer in) supplies the entry points, encoding and audio;
`react` mounts that into a host's UI; `headless` drives the same browser render
from Node. `ARCHITECTURE.md` has the diagram and the
dependency rules. The ones that fail silently when broken:

- **Two copies of `@motionscript/core` in one module graph break class
  identity** (a chart renders as a bare rect, no error). Core is a peer
  dependency of everything built on it.
- **Component kits build on `@motionscript/sdk`, never on core**; each kit's lint
  config forbids `@motionscript/core*` (`packages/components/CLAUDE.md`).
- **An unregistered node type builds as an empty placeholder, and the issue
  is recorded in `buildErrors`, not thrown**: a host that ignores it sees the
  node missing and the rest of the clip. A strict registry fails the track.
  A factory's `key` declares a node type, the engine registers it; packages
  register nothing on import.

## Notes

- Every package is Apache-2.0. `@motionscript/renderer` also ships
  `THIRD_PARTY_NOTICES.txt` for the Rust crates compiled into its WASM, and the
  root `NOTICE` (copied into each package by `scripts/sync-notice.mjs`) lists the
  MIT code ported in.
- Changesets (`.changeset/`) drive versioning and `scripts/release.mjs`
  publishing — add a changeset for user-facing changes to published packages.
  `alpha` is in Changesets pre mode (`.changeset/pre.json`, tag `alpha`) and
  publishes `0.1.0-alpha.x`; `main` publishes stable versions. All public
  packages are one fixed group.
- 3D geometry anywhere (a kit, a scene, the `packages/e2e/zz-arch` and
  `zz-catan` sources) follows [3d.md, Depth](packages/core/docs/3d.md#depth-thin-and-touching-geometry),
  or thin parts that touch or lie on a surface flicker in zig-zag stripes.
- Nothing in this repo names the private studio app or any specific downstream
  product; consumers appear only as generic roles ("a host application", "a
  renderer backend", "a server").

## Commits and branches

Conventional Commits (`type(scope)!: subject`). Work goes straight to `alpha` (every push with a changeset publishes an alpha); `main` only moves by `pnpm promote` (a fast-forward to `alpha`), each a stable release. A `type/short-kebab` branch is only for work that should not land yet. Types, scopes and the rules are in [`CONTRIBUTING.md`](CONTRIBUTING.md#commits-and-branches). Commit or push only when asked.
