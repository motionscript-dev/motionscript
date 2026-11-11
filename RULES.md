# MotionScript Engine Rules

Governs this repo: the `@motionscript/*` packages, the `@motionscript/sdk` SDK, the component kits, and the e2e suite. `CLAUDE.md` adds detail and must not contradict it.

Docs here describe the engine on its own terms. Consumers appear only as generic roles ("a host application", "a renderer backend", "a server"), never as specific downstream products.

## Core Principles

### I. One implementation of every semantic
Every rule about how a scene looks or moves has exactly one implementation, in `@motionscript/core`. For a tweenable attribute, that is its ops value (`fillOps`, `strokeOps`, `cornerRadiusOps`, `pathOps`, `flowOps`, `alignmentOps`, `sizeInputOps`, `colorOps`, `textOps`, …), which carries `resolve`/`lerp` and the attribute's own helpers.
- Renderers, platform packages and kits consume ops values; they never re-derive them.
- Ops values are public API. A host should never need to re-implement attribute maths, so a missing helper is added to the ops value.
- When a mechanism exists for a guarantee (asset gates, layout gates, timeline patching), a failure is fixed inside that mechanism. Never add retries, warm-up renders or sleeps.

### II. Documents are data; a frame is a function of time
A scene is a JSON document (Still, Composition, Audio clip, Project) validated by core. Rendering frame `t` depends only on the document, the registry and `t`.
- Validation returns `ValidationIssue[]` and has `assert*` variants. Retired fields are reported as issues, not silently dropped.
- Every document carries the `formatVersion` it was written in (absent is 0). Opening one runs core's pure, tested migrations up to the engine's format and refuses a newer one with `DocumentTooNewError`. Documents saved by every release stay in the fixture corpus and keep building.
- A document's command rows animate the tree its node rows declare; they never add, remove or reparent nodes. The tree a document plays is the tree its rows describe, so seeking never has to undo a structural edit. A node type may still expose tree-editing commands (`addChildAt`, `removeChildAt`, `reparent`) for scenes built in code. Variable commands (`variableTo`, `variableSet`) animate variables and are allowed.
- Node ids are unique within a document's id space.
- An unregistered node type builds as an inert placeholder that keeps its row's id, props and children, and an unknown command is skipped; each is recorded in `buildErrors`, not thrown, and the rest of the clip builds. A strict registry fails the track instead. Registries are per engine and populated explicitly.

### III. Explicit package surfaces
- Each package exposes a deliberate barrel (plus documented subpaths such as `/sdk`, `/component`, `/audio`). Internal modules aren't imported across packages, and lint (`import-x/no-internal-modules`, `no-cycle`) enforces this.
- Packages declare `sideEffects` honestly and register nothing on import. Kits export `NODES` and a `kit` barrel for explicit registration.
- `@motionscript/core` is a peer dependency of everything built on it. Two copies of core in one module graph break class identity silently.
- **Component kits build on `@motionscript/sdk`, the authoring surface, never on `@motionscript/core` directly.** The SDK is a deliberate subset of core tailored to writing components (plus `/component`). When a kit needs something the SDK lacks, the name joins the SDK if an author legitimately needs it; otherwise the kit is wrong. Kit lint configs forbid `@motionscript/core*`. Only tests that play the host's role may import host-only names, and only from a short allow-list. Platform packages (`browser`, `headless`, `react`) use core.
- Members prefixed `_` are outside the authoring API.

### IV. Platforms are adapters over one runtime
`browser`, `headless` and `react` wrap core's `Engine`/`Session` and the renderer. They add platform I/O (surfaces, decode, audio, encoding, process control) but no scene semantics. There is one renderer, so export, stills and playback of the same document produce the same pixels on every platform; what it cannot draw it skips and reports, never approximates.

### V. Fail loudly, at the call site
- Configuration and input errors throw where they're parsed. Server requests are validated (`parse*`) and fail with coded `EngineError`s.
- Errors that cross a package boundary are typed (`ExpressionError`, `AssetNotLoadedError`, `EngineError`, …).
- Silent fallbacks are allowed only where the code says so at the call site. Expressions yield `NaN` instead of throwing.

### VI. Tested at the level the behaviour lives
- Pure logic (ops values, document, timeline, layout) has vitest tests, in `tests/` folders in core or colocated elsewhere.
- Pixel output is guarded by browser parity tests in real Chromium and by the e2e visual-regression catalog.
- `--passWithNoTests` doesn't count as coverage. A package with behaviour and no tests is a recorded gap.
- Every gate contributors are told to run (tests, lint, typecheck) also runs in CI.

### VII. Docs are true or they are deleted
- READMEs, `docs/` topic files, `why.md` files, `CLAUDE.md` files describe the code as it is. A doc that names a file, API or option that doesn't exist is a bug.
- Comments are kept for a non-obvious *why*. A docblock earns more than a line only for a real invariant or gotcha.
- A constraint that can be encoded as a lint rule, a type or an assertion is encoded instead of described.

### VIII. One table per type, one place per fact
- Behaviour selected by a type key lives in one `Record` keyed on the union, with no `switch` towers or parallel maps. A `switch` stays where the arms genuinely differ (parsers, AST walks, narrowing).
- Data with a pinned upstream (Natural Earth, fonts) is regenerated from locked sources. It is never hand-edited or vendored twice.

## Additional Constraints

- **Stack.** TypeScript 6 and pnpm 11 catalogs, vitest 4. Turbo builds use `tsc -p tsconfig.build.json` + `tsc-alias`; `tsc -b` is banned in builds. The renderer is Rust/wgpu compiled to WASM (WebGPU) with WGSL shaders, the only backend: there is no fallback, and a browser without WebGPU cannot draw. Server rendering uses Playwright Chromium and esbuild. MP4 encoding uses mediabunny/WebCodecs.
- **Style.** Kebab-case files. Core class member order: `declare`d property fields → constructor → command methods → hooks → `_` internal state → `_` helpers, then one `declareMembers` call registering the properties and commands. No decorator syntax and no JSX. A node type is a component spec, not a class; its fields go in the order `packages/components/CLAUDE.md` gives.
- **Versioning.** Every publishable package is in one Changesets fixed group and versions in lockstep. Renamed APIs keep `@deprecated` shims until the next major, then they're removed. Publishing uses npm trusted publishing (OIDC), with provenance once the repository is public.
- **Generated content is never edited:** `browser/dist/browser`, `components/geography/data`.

## Development Workflow

- **Docs travel with the change.** A change to behaviour that a README, a `docs/` topic file or a nested `CLAUDE.md` describes updates that doc in the same commit. A decision whose *why* is not obvious from the code gets a section in the owning package's `docs/why.md`.
- **Gates.** The touched packages' build, tests, lint and typecheck pass. Changes that affect pixels pass the e2e catalog. A Changeset accompanies every user-visible package change.
- **Commits** use conventional prefixes (`feat:`, `fix:`, `perf:`, `docs:`, `chore:`).

## Governance

These rules supersede conflicting guidance in READMEs. `CLAUDE.md` elaborates it; when the two disagree, one is amended in the same change. Amendments bump the version: MAJOR when a principle is removed or reversed, MINOR when one is added or materially expanded, PATCH for wording.

**Version**: 3.0.0 | **Ratified**: 2026-10-08 | **Last Amended**: 2026-11-07 (WebGPU is the only renderer: the CanvasKit fallback, SkSL and the three.js backend are removed, and "same pixels" holds across platforms again; documents carry a format version and migrate on open; an unknown node type builds as a placeholder)
