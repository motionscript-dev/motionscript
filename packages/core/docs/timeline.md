# Timeline: compile, seek, presence, patching

`ClipTimeline` (`packages/core/src/document/timeline.ts`) turns a still or composition document into a built node tree plus a list of compiled commands, and answers "what does the clip look like at `t`" for any `t`, in any order ([why](./why.md#a-frame-is-a-pure-function-of-its-time)). In-place update is the planner in `document/timeline-patch.ts`, fed by `diff.ts` (`diffClip`), `doc-index.ts` (`indexDocument`) and `command-traits.ts` (`commandTraits`). Span and duration helpers (`nodeSpan`, `effectiveSpan`, `commandSpan`, `documentDuration`) are in `document/types.ts`. An audio clip is lowered to a composition before any of this (`loweredAudioDocument`, `document/audio.ts`: the root bus becomes the row `@bus` under a synthesized `canvas2d` root).

## Model

`new ClipTimeline(doc, registry, canvas)` then `build()`, `compile(settle)`, and per frame `syncPresence(t)` then `evaluateAt(t)`. `planUpdate(next)` and `applyUpdate(patch, settle, prepare)` move a built timeline to another document. The timeline never attaches the clock, lays out, samples or clamps time; the caller does. `ClipInstance` (`runtime/clip-instance.ts`: `attach` binds the clock, `sample` is `sampleTree`) is the reference driver:

```
build():  attach(0); timeline.build(); sample(); layout();
          timeline.compile(() => { sample(); layout() }); layout()
frame t:  attach(t); timeline.syncPresence(t); timeline.evaluateAt(t); layout(); sample()
```

- **`build()`** (once): variables, then the root row's props, then one instance per non-root row (not yet parented), then each parent's base child count, then `syncPresence(0)`, then the initial snapshots (`initial` and `baseline` prop layers).
- **`compile()`** (once): walks commands in timeline order, each built against the tree as its predecessors left it, then restores baselines and syncs to 0. A still compiles nothing.
- **`evaluateAt(t)`**: restores animated variables, then animated nodes (and truncates their `save()` stack to the baseline depth), then part slots; then, for each placed command with `t >= start`, calls `command.at(clamp01(local))`, and for an entrance held ahead of its start (`holdFrom <= t < start`), `command.at(0)`. It does not move presence: call `syncPresence(t)` first, or the tree keeps the presence of the last synced time and only prop values follow `t`. `placedCommands()` lists each compiled command with its `start`, `holdFrom`, `duration`, `writes` (the slots building it and running it to its end wrote) and `readsLayout`; `evaluateAt(t, onWrite)` reports each slot written with that list's index (the asset sweep in [assets.md](assets.md) reads both).
- **Held commands.** A command marked `settling` (`tween/command`) promises that `at` reads only what it captured when built and only writes prop slots, ending them all at `at(1)`. When any placed command is marked, `compile` and `applyUpdate` build a `SettledIndex` (`settled-index.ts`) from the end values each marked command leaves, and `evaluateAt(t)` without `onWrite` uses it:
  - a finished marked command is held at its stored end values instead of being run;
  - marked commands still running, and every unmarked command, are run in placement order, so the later command still wins a shared slot;
  - a node that only marked commands write has just those slots put back, not its whole layer, so a value written onto one of its other slots from outside the timeline survives a seek;
  - a marked command writing a slot an earlier-placed unmarked command reads is run instead of held, since a held end value is in place before every command runs. An unmarked command counts as reading every slot of what it acts on (a `save` snapshots them without reporting it) and whatever it read while built.

  Two sources mark commands. A `component2d` command is marked by the factory from its pieces ([commands.md](commands.md#component-commands)). The timeline marks a built-in command when `holdsWhenFinished` (`command-traits.ts`) says so: it is `known`, it is listed in that module's `HELD` table (`to`, `set`, `moveTo`, `fadeTo`, `rotateTo`, `scaleTo`, `layoutTo`, `effectTo`, `pulse`, `wiggle`, the paint commands, `progressTo`, the canvas camera commands and the variable commands), and its args hold no expression. A looped command is wrapped after marking and runs every evaluation. A new built-in joins the table once `held-class-commands.test.ts` covers it.

  A frame then costs the slots marked commands write plus the commands still running, not the length of the timeline. `evaluateAt(t, onWrite)` still restores and runs everything; it is the reference `settled-index.test.ts`, `held-commands.test.ts`, `held-class-commands.test.ts` and `frame-equivalence.test.ts` (mixed scenes and the saved-document corpus, draw for draw) compare against.
- **Entrances.** A node command declared `entrance` (`CommandMeta.entrance`, a component command's `entrance: true`) holds its first frame ahead of its `at`, so the node never shows at rest before the command brings it in (`_holdEntrances`, rerun after every compile and update). `holdFrom` is the later of the target's effective span start (0 for the root) and the latest end of an earlier-placed command writing any slot the entrance writes; it is `start` when that is not earlier. A command on the same node writing other slots does not stop the hold; one still running at the entrance's `at` leaves no hold at all, and an exit followed by an entrance keeps the node gone between them. The held index treats `[holdFrom, finish)` as running, and the asset sweep counts the hold as active frames.
- **`baselineProps(id)`**: what a row holds before any command has acted on it (its baseline layer, or its initial one for a row that has not arrived), as a plain props object. It is the same at every time and answers for a row out of the tree, so a host shows it as the node's own props where `node.properties` is the node at the frame last evaluated; `PlaybackController.getNodeInitialProps` and the React player's method of that name read it for the current track.
- **`syncPresence(t)`**: attaches and detaches document nodes so the tree holds exactly the rows whose span contains `t`; returns whether anything moved. A `PresenceIndex` keeps span boundaries sorted with a cursor, so a seek visits only rows with a boundary between the last time and `t`, in either direction.

### Time conventions

| Quantity | Definition |
|---|---|
| Clip time | Seconds from the clip's start. The timeline never clamps it. The runtime clamps to the track's `duration` (`frameTime`, `runtime/placement.ts`) and evaluates the previous frame, then the frame (`StateEvaluator._evaluate`, so `evaluateAt` runs twice per frame). |
| Frame to time | `clipFrameToTime(frame, fps)` is `frame * (1 / fps)`, never `frame / fps` (they differ in the last bit and span boundaries must fall on one side). `clipTimeToFrame` snaps to a whole frame within 1e-9 relative (`runtime/frame-time.ts`). |
| Span | Half-open `[start, end)`: present when `start <= t < end`. Defaults `startAt` 0, `endAt` never. A node's effective span is its own intersected with every ancestor's; empty when `start >= end`. |
| Before 0, past the end | Not clamped. A negative time attaches nothing (no span has started); past the end every started command holds its last frame and a node with a finite `endAt` is gone. |
| Command local time | `clamp01((t - at) / duration)` once `t >= at`, 1 when `duration` is 0; before `at` the command is not run, except an entrance from its `holdFrom`, which runs at 0. |
| Stamp | A command with `duration` absent or 0: applies in full from `at` onward. A loop on a stamp is ignored. |
| Command span | `duration`, or `duration * passes` for a counted loop (`passes = floor(max(0, count)) + 1`); an unlimited loop counts one pass. `documentDuration` is `doc.duration` when present, else the max of `at + commandSpan`, `startAt`, finite `endAt`; 0 for a still. |
| Unlimited-loop fill | `max(0, timeline.duration - at)`: a spinner fills the scene it is in rather than stretching it. |
| Order | Commands: `at`, ties by array index (parallel is a shared `at`; later in the array wins a shared prop). Siblings: `layerOrder`, ties by array index. |

## Invariants and traps

- **Restore, then replay, is what makes a frame a function of `t`.** A prop written by a command that has not started would otherwise keep what the last evaluation left. Only nodes some command writes are restored: `WriteRecorder` records every slot a command wrote while it was built and run to its end, so a command that writes a node other than its target restores that node too (`_touch`). A slot on a part a node built for itself (no document row) is saved before its first write (`_notePartWrite`) and restored on its own.
- **Only a pure command may be marked `settling`.** Held, it freezes at the value compile stored, so a command that reads live state in `at`, moves structure or pushes the save stack must stay unmarked and run every evaluation. A composed `component2d` command is marked only when every piece in it is (a `run` piece on a class command makes it unmarked).
- **Commands are built in timeline order and each is run to `at(1)` before the next is built** (`buildToEnd`): a command reads `from` off its target when built. A factory that returns nothing (`restore` with no duration) is wrapped as a stamp that acts again on every evaluation.
- **Compile moves the tree to each command's `at` before building it.** An unmounted node hands back an inert stepper that the command caches, so a command built against the t=0 tree would never move a node that enters later. A command on a node that is not in the tree at its `at` writes nothing, at any time (validation rejects it). Arrivals are baselined at that sync.
- **A baseline is taken only while mounted.** A node's cells hold pre-attach values until an ancestor is in the tree, so a row that arrives under an absent ancestor waits in `_unmounted` and is baselined at the first sync that finds it mounted (`_baselineMounted`); otherwise a child entering before its parent loses what it inherits (a text under a `default-text-style`). A node that leaves and returns keeps its first baseline.
- **Settling is per presence window, at the window's start.** Compile re-lays the tree out (`settle`) only for a presence window containing a command that reads layout (`commandTraits(...).readsLayout`, unresolved traits, or a target bound to another node), and at the window's start: a size tween built earlier in the same window has already run to its end, and a settle after it would hand the reader that end state (`_settleWindows`). Settling on every presence change is quadratic for staggered entries.
- **Lifecycle commands displace rows.** An animated `removeChildAt` run to its end detaches a row present at 0, so every baseline restore first puts present rows back under their declared parent (`_collectDisplaced`, `_restoreDisplaced`). Any document containing `addChildAt`, `removeChildAt` or `reparent` always rebuilds instead of patching.
- **Insert index.** A document child lands after whatever its parent built for itself: `_baseChildCount[parent] + siblings.before(slot)` (a Fenwick tree per parent), so `layerOrder` is sibling order and a composite's own children keep their indices. Detaches run before inserts so a node changing parents is never in two places.
- **An unknown `targetId` throws** `Command <id> (...) targets node "<id>", which this document does not declare`, whether the type is node-less (`to`) or named (`moveTo`). An unknown `easing.kind` silently runs as the command's default; `custom` easing without a curve or registered key throws.
- **Duplicate node ids and keys are not detected here** (the validator reports them, the planner refuses them); a second `build()` or `compile()` is unguarded and not supported.
- **Documents are immutable by convention.** `diffClip` and the validation cache compare by object identity first, so a document mutated in place and handed back is seen as unchanged.

- **An unknown node type builds as a placeholder.** `_instantiate` hands a row whose type the registry lacks to `missingNode` (`document/missing-node.ts`): an unregistered component of the row's tree (its first registered child's, else the tree its parent holds, a viewport's added one first, else 2D) that keeps the row's id, key, placement props and children, draws nothing, and answers `missingNodeOf(node)` with the type and authored props. Every command aimed at one, and any command its target's type does not publish, is skipped: `_buildPlaced` returns `null` and records it. `ClipTimeline.issues()` lists both (`TimelineIssue`); `ClipStore` publishes them as coded `BuildError`s. A strict registry (`RegistryOptions.strict`) throws as builds did before. `commandTraits` calls a skipped command known and inert, and the patch environment compares a placeholder's class as `MISSING_TYPE`, so an edit near one patches and a type registered later re-instantiates it.
- **Props pass through the type's evolution first.** `_instantiate` runs `migrateNodeProps` on a row's props before splitting literals from expressions, and `_buildPlaced` on a `to`/`set` command's args ([registry.md](registry.md)).

### Incremental update

`planUpdate` returns a `TimelinePatch` or `null` (only a fresh build is sound); it changes nothing. Every rule errs towards doing more: a node marked dirty that did not need it costs one chain rebuild, a missed one renders a frame that disagrees with a fresh build of the same document. After `applyUpdate`, every frame equals a timeline built fresh from `next`. A patch is single-use: `patch.prev` must be the timeline's current index, and a throw from `applyUpdate` leaves the timeline unusable (dispose and build fresh, as `ClipStore` does). The canvas must be attached at time 0.

| Edit | Outcome |
|---|---|
| `kind` or `theme` changes; duplicate id or key, unresolved parent, parent cycle, bad root row; unparsable formula or undeclared reference in `next`; a key moved to another node; any lifecycle command; a command that does not resolve or whose target is the wrong kind; root `type`, `key`, `parentId`, `layerOrder`, `startAt` or `endAt` changes; a dirty root chain holding an unknown command | `null` |
| More than `max(0.5 * next.nodeCount, MIN_REBUILD_NODES = 16)` nodes would be re-instantiated | `null` |
| A node's `type`, `key` or `props` change; its `parentId` changes; its registered class differs from the live one; a targeted node's state at 0 (absent, unmounted, mounted) changes | re-instantiate it (and its descendants when a context provider is involved); dirty if targeted |
| Only placement props change, to literal values (`x`, `y`, `rotation`, `scale`, `opacity` in 2D; `x`/`y`/`z`, `rotationX`–`Z`, `scaleX`–`Z` in 3D; `isPlacementProp`), on any type, in a row with no anchor (`topLeft`, …) or 3D vector sugar | written onto the live node as its new initial values (`TimelinePatch.inPlace`); no layout flag, since placement applies after layout; dirty if targeted |
| Node added or removed; siblings reordered; `startAt`/`endAt` change | patch; a layout flag when the node is laid out |
| A command added, removed or changed; commands sharing an `at` reordered; a node's command list differs | the target (before and after) is dirty: its chain is rebuilt |
| A variable's `value` or `lerp` changes | the variable is dirty; targeted readers of it are dirty |
| Clip `duration` changes | nothing, except commands with an unlimited loop (`count: null`), whose target is dirty |
| A variable's `name`, key order in `props`, `startAt: 0` against absent | no change |
| Layout flag set | every node with a command that reads layout, or whose traits are unknown, is dirty; `replay` is `"all"` when a dirty chain reads layout |

`DocIndex.dependents` (`byVar`, `byKey`) lists which nodes' props read a variable or a keyed node's prop. `TimelinePatch.captures` are the arrival baselines the walk takes, at the first command `at` inside the span of a node that is absent at 0 (`DocIndex.captureTime`). A clean chain that reaches a re-instantiated node other than through its target or a `nodeRef` command argument keeps writing the disposed instance; the incremental frame then differs from a fresh build.

## Where to look

- `document/tests/timeline.test.ts`, `timeline-recording.test.ts`, `arrival-baseline.test.ts`, `compile-settles.test.ts`, `part-writes.test.ts`, `cross-node-writes.test.ts`: compile, seek, baselines, settling, writes beyond the target.
- `document/tests/timeline-patch.test.ts`, `timeline-update.test.ts`, `diff.test.ts`, `doc-index.test.ts`, `command-traits.test.ts`: the planner and its inputs.
- `src/tests/barrels.test.ts`: `ClipTimeline` is on the root barrel only; `planTimelinePatch`, `TimelinePatch`, `MIN_REBUILD_NODES` and `resolveEase` are on none.
