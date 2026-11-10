# Release and CI

The two workflows, how a change becomes a published version, and the e2e baseline
they depend on. Files: `.github/workflows/ci.yml` (`CI`), `npm-publish.yml`
(`Release`), `scripts/release.mjs`, `.changeset/`, `scripts/sync-root-version.js`.
Package builds: [build orchestration](./build-orchestration.md). Running the e2e
suite: [`packages/e2e/README.md`](../../packages/e2e/README.md).

## The chain

Two release branches, and work lands on `alpha`:

```
push to alpha ─▶ CI ─▶ Release ─▶ release.mjs --ci --prebuilt ─▶ 0.1.0-alpha.N under "alpha"
pnpm promote  ─▶ CI (tests skipped) ─▶ Release ─▶ release.mjs --ci --prebuilt ─▶ 0.1.0, 0.1.1… under "latest"
```

`release.mjs` versions the pending changesets, publishes CI's build,
snapshots the document corpus and pushes the release commit and tags back to
the branch. `alpha` keeps changesets' pre mode (`.changeset/pre.json`, tag
`alpha`); on `main` the script runs `changeset pre exit` first, so the stable
release consumes every changeset since the last one and deletes `pre.json`.
Merging `main` back into `alpha` brings that deletion, and the next alpha
release enters pre mode again by itself. Pull requests go to `alpha`.

**`pnpm promote`** (`scripts/promote.mjs`) fast-forwards `main` to `alpha`
once alpha's latest CI run has passed, and refuses when `main` has commits
`alpha` lacks. A fast-forward, not a merge: `main` gets commits CI already
tested, so its run skips the tests (below).

### Never twice

CI's `gate` job (`scripts/ci-tested.mjs`) finds the nearest ancestor of the
commit that a pushed CI run passed on. When everything since is release
bookkeeping, the test jobs are skipped and the run still succeeds, so Release
fires. Bookkeeping means:
- changelogs and `pre.json`;
- consumed (deleted) changesets;
- `package.json` changes to `version` or `@motionscript/*` ranges;
- an added fixture snapshot, whose corpus test `release.mjs` runs before
  committing it.

That covers a promote and a release commit; any other change runs everything.
A dispatch with `full` runs everything regardless. The build job always runs,
because Release publishes its artifact.

## CI

Triggers: pull requests to and pushes to `alpha` and `main`, `workflow_dispatch`
(with a `full` input). A newer run on the same ref cancels the one in flight.
Everything runs on the runner itself, with no containers. The libraries are
built once and the tests fan out over that build:

- **`gate`**: whether this code already passed ("Never twice", above).
- **`build`**: `pnpm build:lib`, packed as the `build` artifact: every package's
  `dist/`, `packages/renderer/web/pkg` and `build-sha.txt`.
  - The renderer's WASM comes from an `actions/cache` keyed on every Rust input
    (the `wasm` step's key in `ci.yml`: the crates, `Cargo.*`, `rust-toolchain.toml`, the
    `include_str!`'d `web/src/user-shaders.ts`, `build-wasm.sh`, `wasm-env.sh`).
    On a hit `MS_WASM_CACHED=1` makes `build-wasm.sh` skip cargo, and the job
    installs no Rust. Turbo drops variables a task does not declare, so
    `turbo.json` lists it under the build's `passThroughEnv`.
  - On a miss it installs the pinned toolchain (`rust-toolchain.toml`),
    `Swatinem/rust-cache` and the `wasm-bindgen-cli` that `Cargo.lock` pins, then
    saves the new WASM.
  - A new crate input outside those paths must join both keys, or a stale WASM
    passes.
- **On the artifact, in parallel, no Rust** (`.github/actions/setup-built`:
  install and unpack):
  - **`lint-typecheck`**: `pnpm lint`; `sync-notice --check` (every published
    package carries the root `NOTICE`); `check-changesets` (the breaking marker,
    below); `pnpm typecheck`; and `node --test scripts/*.test.mjs`.
  - **`test-node`**: `pnpm -r test` without `browser`, `react` and `headless`.
  - **`test-browser`** (2 jobs): `browser`'s vitest in `--shard i/2`, plus `react`
    in one job and `headless` in the other. They run in real Chromium, headed
    under Xvfb (`HEADED=1`), because headless Chromium on Linux reads a
    SwiftShader WebGPU canvas back empty.
  - **`e2e`** (2 jobs): the wgpu lane, `wgpu-lane.ts --shard i/2`. Listed scenes
    are drawn on SwiftShader's WebGPU adapter under Xvfb and diffed against
    `packages/e2e/wgpu-baseline/`. Each shard's `out/wgpu`, `out/wgpu-diff` and
    `out/wgpu-summary.json` upload for 5 days, pass or fail.
- **`rust`** (in parallel with `build`):
  - It runs `cargo test --locked --workspace`, with naga validating every WGSL
    module; `notices:check`; the renderer, text and 3D WASM builds; and
    `scripts/check-declarations.mjs`, which compares the committed
    `web/pkg*/*.d.ts` with the build, masking the rustc crate hashes in
    closure names (they differ between Windows and Linux builds).
  - `test:effects` imports core's `dist/`, so it runs in `lint-typecheck`.
  - A cached marker keyed on all of its inputs (the `passed` step's key) skips the job when
    exactly these inputs passed before.

Playwright's browsers are cached under `~/.cache/ms-playwright`, keyed on the
lockfile.

CI does not run `changeset status`, the docs site's registry build, or a build
of anything under `apps/` (their `typecheck` runs).

## Changesets

`.changeset/config.json` has one `fixed` group of the 14 public packages (`core`,
`browser`, `renderer`, `react`, `headless`, `cli`, `sdk`
and the seven kits): a bump to any moves all to one version. `access` is
`public`, `baseBranch` `main`, `updateInternalDependencies` `patch`, and
`privatePackages` is `{ "version": false, "tag": false }`, so the apps, `e2e` and
`docs` are neither versioned nor tagged.

The repo is in **pre-release mode** (`.changeset/pre.json` has `mode` `pre` and
`tag` `alpha`): versions are `0.1.0-alpha.N` and publish under the `alpha`
dist-tag. A package that joins the group in pre mode needs no step of its own:
`changeset version` adds it to `pre.json`'s `initialVersions` at its current
version, and the group gives it the group's next `0.1.0-alpha.N` (`renderer` was
added at `0.1.0-alpha.7`, the group's version then). A changeset is pending until `changeset version` records its id in
`pre.json`'s `changesets` list; the file stays in `.changeset/`.

**A changeset accompanies every user-visible change to a published package**: a
behaviour change, a new or removed export. Run `pnpm exec changeset`, name the
packages and bump kind in the front matter, and write the note as the changelog
entry. A renamed API keeps a `@deprecated` shim until the next major.

**A change to what a stored document means is breaking** for every host that
keeps documents. That is renaming or removing anything a document can name (a
node type, a prop, a command or its arguments, an effect, a package a custom
node imports), and equally a stored value that now reads differently: a changed
**default** (rows are sparse, so every document leaving the prop out changes), a
changed **unit** (degrees to turns, pixels to a fraction of the box), or a changed
**meaning** (a coordinate space, an origin, a blend order, what `0` or `null`
means). Such a change ships with a way forward and a marked changeset:

1. **Make old documents read the same.** For one component, give its spec
   `renamed` / `migrate` (a unit or meaning change takes a new prop name, with
   the old one converted, never a new reading of the old key); for the document
   format, add a step to `DOCUMENT_MIGRATIONS` and bump
   `DOCUMENT_FORMAT_VERSION` (`packages/core/src/document/migrate.ts`, with a test).
2. **Start the changeset note with `**Breaking:**`**, say what each old name or
   value becomes, name each changed core prop or command as `type.prop`, and
   end with a `Migration:` paragraph giving the document migration in words
   (what the engine now does on open, and what a host with its own stored rows
   must do).

Hosts read that marker in the installed packages' changelogs to know which
releases need a migration of what they have stored, so a document-breaking change
without it reaches users silently. Below 1.0 such a change still ships in a minor
release; a host migrates it forward.

Two checks hold this. `scripts/check-changesets.mjs` (CI) fails a note that says
"breaking" without opening with the marker, or a marked note without
`Migration:`, and warns on wording that suggests a changed default, unit or
meaning. Core's `fixture-corpus.test.ts` diffs the built-in vocabulary (every
type's props, their defaults and its commands) against the newest release's
`vocabulary.json` and fails for any removed type, prop or command or changed
default that no pending `**Breaking:**` note names in backticks. A changed unit
or meaning under the same name is invisible to both: that is what review is for.

## The saved-document corpus

`packages/core/test/fixtures/documents/<version>/` holds documents as each release
wrote them: `e2e/` (every e2e scene that names only core's types, as a one-track
project), `coverage/` (every built-in node type and command family, stills,
audio, 3D, expressions) and `vocabulary.json`. Core's `fixture-corpus.test.ts`
migrates, validates (strictly, against a registry) and builds every document in
every set, forever. **A set is never edited or deleted**: a document that stops
building needs a migration, not a new fixture. `0.1.0-alpha.7` was taken from the
tree at that release plus its pending changes, before `formatVersion` existed
(`--unstamped`).

**Each release snapshots a new set.** `release.mjs`'s snapshot step does it
right after publishing, at the release commit (`packages/core/package.json`
already carries the published version). It runs
`pnpm --filter @motionscript/e2e exec tsx scripts/snapshot-document-fixtures.ts`
on the build, runs core's `fixture-corpus.test.ts` on the new set, and commits
the folder (`test: snapshot <version> documents`). The script refuses an
existing folder (`--force` is only for redoing the set of the release it just
made). Until it runs, the vocabulary check compares against the release before,
and the consumed breaking notes no longer excuse their changes, so the corpus
test fails: that is the reminder.

## Release

`Release` (`npm-publish.yml`) runs when a pushed `CI` run completes with
success on `alpha` or `main`, and never cancels a running release. Re-run a
failed one from its run page; there is no dispatch, because the build comes
from a CI run.

1. It checks out the commit CI tested. If the branch has moved past that commit,
   it stops: the newer push has its own CI run, which releases it.
2. Otherwise it names the branch (`git checkout -B`; under `workflow_run`,
   `GITHUB_REF_NAME` is the default branch) and unpacks that run's `build`
   artifact. It installs no Rust and builds nothing.
3. It runs `node scripts/release.mjs --ci --prebuilt` as `github-actions[bot]`.
   `--prebuilt` refuses a build whose `build-sha.txt` isn't HEAD. No package
   embeds its version in `dist/`, so a build made before the version bump is
   the build that ships.

Its pushes use `GITHUB_TOKEN`, which starts no workflow, so the release commit
does not run CI or Release again.

- **Version.** `changeset version`, then `node scripts/sync-root-version.js`
  (which copies `packages/sdk/package.json`'s version into every `fixed`
  package and the root `package.json`, which Changesets does not version), then
  `pnpm install --no-frozen-lockfile`; committed as `ci: release <version>`.
- **Publish.** `pnpm build:lib` (skipped with `--prebuilt`) and `sync-notice`,
  then each public package not on npm at the version is packed by `pnpm pack`
  (which rewrites `workspace:` ranges) and uploaded by
  `npm publish <tarball> --tag <alpha|latest>`, four at a time under `--ci` and
  one at a time by hand (npm's one-time password), then tagged
  `@motionscript/<name>@<version>`. A package already on npm is skipped, so a
  rerun publishes only what is missing; npm is asked about all of them at once,
  once per run.
- **Snapshot.** The release's document set (below), committed as
  `test: snapshot <version> documents`.
- **GitHub.** Pushes the branch and the tags, then `gh release create
  v<version>` with the first `## ` block of `packages/core/CHANGELOG.md` as
  notes (every package shares one version), `--prerelease` for an alpha.
- **Trusted Publishing, no token.** The job has `id-token: write`; npm 11.5.1 or
  newer exchanges it. No `NPM_TOKEN` exists; a stored npm secret would be a
  defect. Each package needs a Trusted Publisher on npmjs.com (package →
  Settings → Trusted Publisher → GitHub Actions: organization
  `motionscript-dev`, repository `motionscript`, workflow `npm-publish.yml`,
  no environment). One missing fails that package with `E404 Not Found - PUT
  https://registry.npmjs.org/@motionscript%2f<name>`; **renaming the workflow
  file breaks publishing**, and each `package.json` `repository.url` must name
  this repository exactly.
- **Provenance only from a public repository.** npm attaches it by itself to a
  trusted publish from a public repository and never from a private one.
- **A new public package is published once by hand.** npm sets up a Trusted
  Publisher only for a package that already exists. So a new package joins
  `pnpm-workspace.yaml` and the `fixed` group, goes out once with
  `pnpm release` from a maintainer's machine, then gets its Trusted Publisher.
- **A build by hand needs Rust for `renderer`**: rustup (the toolchain and target
  install from `packages/renderer/rust-toolchain.toml`) and `cargo install
  wasm-bindgen-cli --version <the wasm-bindgen version in
  packages/renderer/Cargo.lock> --locked`. The build runs under `sh` (Git Bash
  on Windows). A pack without the build fails in the renderer's `prepack`
  rather than shipping an empty `dist/`. `THIRD_PARTY_NOTICES.txt` is kept
  current by CI (`pnpm --filter @motionscript/renderer notices` regenerates it).
- **`geography` generates its data on pack.** Its `prepack` generates `data/`
  when absent, from the sources pinned (tag and sha256) in
  `sources.lock.json`, then verifies it.

## Publishing by hand

`pnpm release` is the same script on a maintainer's machine, on `alpha` or
`main`: for a package's first publish, or whenever CI can't. It refuses any
other branch, a tree with uncommitted changes and a checkout behind its remote,
and checks `npm whoami` (`npm login`, which the upload uses; pnpm's own login
is not involved), Rust with the pinned `wasm-bindgen`, and `gh auth status`.
It asks before publishing and before pushing (`--yes` answers), and
`--dry-run` stops after the checks and prints what each step would do.
`pnpm release snapshot github` runs only those steps, and each step skips
itself when its work is done.

## The e2e baseline

The e2e suite is the wgpu lane: `packages/e2e/wgpu-lane.json` lists the scenes,
each drawn on SwiftShader's WebGPU adapter and diffed against the PNGs committed in
`packages/e2e/wgpu-baseline/` (`pnpm --filter @motionscript/e2e test:e2e`). A change
that moves pixels on purpose rebaselines with `test:e2e -- --update` and commits the
new PNGs, saying in the commit which scenes moved and why; SwiftShader on Linux and
Windows agree to within the lane's threshold. Workflow:
[`packages/e2e/README.md`](../../packages/e2e/README.md).

## The docs site

The docs (guides, API reference, tools, the `ms add` registry at `/r`) are
the docs site at [motionscript.dev/docs](https://motionscript.dev/docs), built outside this repository from the published packages: the API reference from their `.d.ts`, the registry from each
kit's published `src` and `registry.json`. So a release reaches the docs when
the site moves its pin to it, and nothing here deploys anything.
