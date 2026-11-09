---
"@motionscript/cli": patch
---

`ms add` records what it installed correctly, `ms init` reads legacy config names, and `ms --version` works.

- Every component is recorded in `motionscript.lock.json` under the name it was requested by. A registry dependency that was a suffix of a requested item (`chart` for `line-chart`) used to be recorded under the item's key, and a namespaced dependency under its bare name with the default registry's URL.
- A file you declined to overwrite keeps its lock record, so `ms list` still reports it modified and `ms diff` still knows it. The closing line says `Skipped` instead of `Added` for an item whose files were all kept.
- The lock is written before the package manager runs, so a failed install leaves tracked files. A project with no `package.json`, or a malformed dependency spec, is refused before any file is written.
- `ms init` loads whichever config name is present (`components.json`, `motion-script.json`) and names it, instead of claiming `motionscript.json` exists and failing. With `--force` it writes `motionscript.json`, which takes precedence, and leaves the old file in place.
- `ms --version` and `ms -v` print the version instead of `Unknown command "undefined"`.
