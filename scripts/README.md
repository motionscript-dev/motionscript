# Root scripts: what to run when

Every command runs from the repository root. The detail behind each one is in
the runbook named beside it, and each script's header comment lists its flags.

## First time

```bash
pnpm install
pnpm --filter @motionscript/browser exec playwright install --with-deps chromium
pnpm build:lib
```

`build:lib` builds the renderer's WASM, so it needs Rust and `wasm-bindgen-cli`
at the version `packages/renderer/Cargo.lock` pins
(`packages/renderer/README.md`).

## Every day

| To | Run |
| --- | --- |
| Build every library (after pulling, or before a dev server) | `pnpm build:lib` |
| Rebuild one package while editing it | `pnpm --filter @motionscript/core dev` |
| Try a change in the example React host | `pnpm dev` (or `pnpm dev react`) |
| Start the Node host, alone or beside the React one | `pnpm dev engine`, `pnpm dev react engine` |
| Check before a push (CI's checks in one go) | `pnpm check` (`--no-build` after a fresh build, `--e2e` to add the e2e suite) |
| One part of that | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` |
| Note a user-visible change to a published package | `pnpm exec changeset` (`runbooks/release-and-ci.md#changesets`), or `node scripts/changeset.mjs add <patch\|minor\|major> [package] < note.md` |
| Take a pending changeset out of the next release | `node scripts/changeset.mjs drop <id>` |
| See branches, versions, pending changesets, build freshness and running apps | `node scripts/status.mjs` (`--fetch` asks GitHub, `--npm` asks npm; `--json` feeds the workspace pane) |
| Stop whatever serves a port (an example app left running) | `node scripts/status.mjs --stop 5174` |

## Branches and releasing (`runbooks/release-and-ci.md`)

Work lands on `alpha`; pull requests go there too. Once CI passes, every push
to `alpha` with pending changesets publishes the next `0.1.0-alpha.N` under
npm's `alpha` tag, and `pnpm promote` (a fast-forward of `main` to `alpha`)
publishes a stable version under `latest`. The Release workflow does it
(`release.mjs --ci --prebuilt`).

| To | Run |
| --- | --- |
| Ship an alpha | push to `alpha` with a changeset in it |
| Ship a stable version | `pnpm promote` once alpha's CI passed (`--dry-run` shows what moves) |
| See what a release from this branch would do | `pnpm release --dry-run` |
| Release by hand (a new package's first publish, or CI can't) | `pnpm release` on `alpha` or `main` |
| Finish a release that stopped partway | `pnpm release` again (finished steps skip themselves) |
| Run only some steps | `pnpm release snapshot github` (steps: `version publish snapshot github`) |

By hand needs `npm login` and `gh auth login` first.

## Odd jobs

| To | Run |
| --- | --- |
| Copy the root `NOTICE` into every published package | `node scripts/sync-notice.mjs` |
| Clear build output and turbo's cache | `pnpm clean` |
