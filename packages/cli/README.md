# @motionscript/cli

`ms` copies the source of Motion Script components into your project, records
what it wrote, and tells you later which side changed. Copied source is yours to
edit; the lock file is what makes "did I change this, did upstream" answerable.
It is only the registry half of the tooling: rendering from Node is
[`@motionscript/headless`](https://github.com/motionscript-dev/motionscript/tree/main/packages/headless).

```bash
pnpm add -D @motionscript/cli
pnpm exec ms add code
```

The bins are `ms`, `motionscript` and `motion-script`, all `dist/cli.js`; run
them through your package manager. Node 22 or later. The working directory is the project root: no command looks in a parent
directory. For usage as an author, see the
[docs page](https://motionscript.dev/docs/cli/components).

## Commands

| Command | Does |
| --- | --- |
| `ms init` | Writes `motionscript.json` and adds `"<alias>/*"` to `tsconfig.json`'s `paths`. Asks where component source lives (`src/components`) and the import alias (`@/components`). Comments and formatting in `tsconfig.json` survive. |
| `ms add [name...]` | Copies items into `paths.components`, records them in the lock, merges their npm dependencies into `package.json` and runs the package manager. With no name, offers a picker over the default registry's index. Runs `init` first when there is no config. |
| `ms list` (`ms ls`) | One line per lock entry: version, `from <registry>` when not the default, and `unchanged`, `modified (N of M files)` or `N files missing`. `--check` asks each registry for a newer `version`. |
| `ms diff [name...]` | Per file of each installed item: `+` new upstream, `-` missing locally, `!` changed both sides, `↑` changed upstream, `~` changed locally, `×` dropped upstream. Summarises; prints no content diff and writes nothing. |

| Flag | Used by | Effect |
| --- | --- | --- |
| `--yes`, `-y` | `init`, `add` | No prompts. `add` also overwrites existing files. |
| `--overwrite` | `add` | Overwrite existing files without asking. |
| `--skip-install` | `add` | Neither merge dependencies into `package.json` nor install. |
| `--registry <url or path>` | `add`, `list`, `diff` | The default registry for bare names: an `http(s)` URL, a path or a `file:` URL. |
| `--check` | `list` | Ask each registry for a newer version. |
| `--help`, `-h`; `--version`, `-v` | all | Help; the package version. |

Exit code 0 on success and also on a declined overwrite, an `Aborted.` from the
picker, and a failed fetch inside `diff` or `list --check`. Exit code 1 for an
unknown command and for any thrown error, printed as its message with no stack.

- Unknown flags are ignored without a message. `ms init --force` overwrites an
  existing config but `--force` is not declared to the parser or the help, so
  `ms init --force word` reads `word` as its value.
- `ms add` checks every item's destinations and merges the dependency specs
  before it writes anything, so a refused path or a missing `package.json` leaves
  nothing half-installed. A file path in an item must be relative and stay inside
  `paths.components`; `paths.components` itself must stay inside the project.
- The lock is written before the install, so a failed install leaves the files
  tracked. An install overwrites a range already in `package.json`'s
  `dependencies`.
- Files overwrite without a prompt when the lock says the file on disk is
  unchanged since install. A modified or unrecorded file prompts (default no); a
  declined file keeps its old lock record, so it still reads as modified.
- A registry read is one attempt: no retry, timeout or cache.

## Project files

Both live at the project root and are meant to be committed.

`motionscript.json` is hand-written configuration: `$schema?`, `project`
(default `src/project.ts`), `aliases.components` (`@/components`),
`paths.components` (`src/components`) and `registries?`. It is read with
`JSON.parse` and no validation, so a file without `aliases` and `paths` makes
`ms add` fail with a `TypeError`. Older names `motion-script.json` and
`components.json` are still read, in that order after `motionscript.json`, and
never written. Nothing reads `project`; `@motionscript/headless` defaults its own
entry to the same path.

`motionscript.lock.json` is derived and rewritten by `ms add`: `lockfileVersion:
1` and `components`, keyed by the name an item was **requested** by (namespace
included, so `@acme/gauge` and `gauge` do not collide). Each entry holds
`registry`, `url`, `item`, `version?`, `kit?`, `installedAt` and `files`, a map
from the declared path to `{ target, installed }`, where `installed` is
`sha256-<base64>` of the bytes written. Comparing a file's hash with it is the
only fact `list`, `diff` and the overwrite prompt use. A lock whose
`lockfileVersion` is not 1 stops the CLI rather than guessing at its shape. The
lock's `url` is not used to fetch: `list --check` and `diff` re-resolve the key
through the current config and `--registry`.

## The registry

A registry is static JSON: `GET <registry>/registry.json` (the index) and
`GET <registry>/<name>.json` (an item: `name`, `type`, `description?`,
`version?`, `dependencies?` as `"pkg@range"`, `registryDependencies?` installed
first, `files` as `{ path, content }`, and `kit?`). Bare names resolve against
`https://motionscript.dev/r`. Others go under `registries`, keyed `@namespace`,
as a URL template containing `{name}` plus optional `headers`; `${VAR}` in a
header value is read from the environment. `params` is declared and never read.
`kit` names the package the copied files import and must not copy, so the host
keeps one copy of its classes (the engine keys prop machinery to class identity).
The protocol and resolution rules are in `src/registry/protocol.ts` (pure) and
`src/registry/fetch.ts` (`file:` and plain paths are read from disk, which is how
an unpublished registry is tested).

### The default registry is generated

The registry at `https://motionscript.dev/r` is generated when the docs site
builds, from the published kits: each one ships its `src` and `registry.json`,
and the site's builder turns them into the items below. Nothing in this
repository builds or serves it.

Every package under `packages/components/*` and `apps/*` that has a
`registry.json` publishes its `items`: `name`, optional `description`, a `root`
folder, the `files` under it (never `*.test.ts`/`.tsx`) and optional `flatten`
(publish a one-file item at `<name><ext>`). `kit` gives the `barrel` file and the
`specifier` a copy imports it by. The package must declare `@motionscript/sdk`
as a peer; an item's `dependencies` are the SDK at that range, then the kit
unless the package is `private` (such an item is copy-only and may not import
its kit).

A copied file lands without its siblings, so the build holds it to the **kit
import rule**: every relative import resolves inside the item's copied set (left
alone) or to a file reachable from the kit barrel (rewritten to `kit.specifier`);
anything else fails, naming the file and specifier. Every bare import must be
`@motionscript/sdk` (any subpath), the kit, or a declared dependency, so a copy
never imports `@motionscript/core`. A line over 400 characters fails the build:
data belongs behind the kit barrel, not in a user's `src/`. Imports are found by
a textual scan with comments blanked, so `require()` is not seen. The kit surface
is every file the barrel reaches by relative import, so a name the barrel does not
export still gets rewritten. See [`packages/components/CLAUDE.md`](https://github.com/motionscript-dev/motionscript/blob/main/packages/components/CLAUDE.md).

## Development

```bash
pnpm --filter @motionscript/cli build       # tsc -p tsconfig.build.json && tsc-alias
pnpm --filter @motionscript/cli test        # vitest, Node
pnpm --filter @motionscript/cli lint
pnpm --filter @motionscript/cli typecheck
```

Tests sit beside the code (`src/main.test.ts`, `src/registry/*.test.ts`) and run
the commands against temporary project folders. The package has no barrel:
`main` is `dist/cli.js`, which runs the CLI when imported.
