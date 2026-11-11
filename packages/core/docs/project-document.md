# The project document and the runtime that plays it

A clip document says what happens inside one composition. A **project document** says how clips are laid against each other in time to make the finished video: rows placed at times, evaluated rather than played. `Session`, the exporter and the still renderer all take one, and a lone still or composition is lifted into a one-track project by `asProjectDocument`. Code: `packages/core/src/document/project.ts` (the types), `packages/core/src/runtime/` (placement, `ClipStore`, `ClipInstance`, `StateEvaluator`, `Engine`, `Session`, `Playback`, `PlaybackController`) and `packages/core/src/platform/` (the seams a platform implements). How a clip compiles and seeks is the timeline; what its nodes load is [assets.md](assets.md).

## Model

```jsonc
{ "kind": "project", "name": "Reel", "fps": 60, "viewport": { "width": 1920, "height": 1080 },
  "tracks": [
    { "id": "bg",    "startAt": 0, "duration": 9,   "clip": { "kind": "still", "nodes": [ … ] } },
    { "id": "intro", "startAt": 0, "duration": 2.5, "clip": { "kind": "composition", "nodes": [ … ], "commands": [ … ] } },
    { "id": "wm",    "startAt": 0, "duration": 9,   "clip": { "kind": "still", "nodes": [
        { "id": "", "type": "canvas2d", "parentId": null, "layerOrder": 0, "props": { "opacity": 0.35, "blend": "screen" } }, … ] } },
    { "id": "music", "startAt": 0, "duration": 9,   "clip": { "kind": "audio", "commands": [], "nodes": [ … ] } } ] }
```

A `Track` is `id` (unique, non-empty), `clip` (inline `ClipDocument`: still, composition or audio), `startAt` (seconds on the project timeline, default 0) and `duration` (seconds, required). Validation is `validateProjectDocument` / `assertValidProjectDocument` (`document/validate.ts`).

| Space | Unit | Used by |
|---|---|---|
| Project frame | integer frames from the project's start | `TrackSpan`, `totalFrames`, `Session.seekFrame`, `PlaybackController.seek` |
| Project time | seconds from the start | `Ticker.currentTime`, `Session.seek` |
| Clip time | seconds from the track's start, clamped to `[0, track.duration]` | `ClipInstance.evaluateAt`, `frameTime` |
| Track-local frame | project frame − `span.startFrame` | `StateEvaluator.stateAt` |
| Viewport space | viewport units, origin at the centre, y up | `NodeBox`, `pickNode`, `NodeTextLayout` (`runtime/node-picking.ts`) |
| Structural path | child indices joined by `.` over `_allChildren`, root `""` | node overrides, `TreeState.path`, `getNodeBox` |

Conversions use `clipFrameToTime` / `clipTimeToFrame` (`runtime/frame-time.ts`; see the time table in [timeline.md](timeline.md)). In `runtime/placement.ts`: `trackFrameCount = max(1, ceil(clipTimeToFrame(seconds)))`, 1 for a non-finite length. `placeTracks`: start `max(0, round(clipTimeToFrame(startAt)))`, end inclusive (`start + count − 1`), `index` in document order. `totalFramesOf` is the furthest `endFrame + 1`.

| Object | Owns |
|---|---|
| `Engine` | registry, manifest, exporter and platform: shared and expensive, one per app |
| `Session` | one project bound to an engine and a surface: one catalog, storage adapter, render context, controller, and a `Playback` (null without a realtime clock) |
| `PlaybackController` | the clock wiring and every paint; builds one `ClipStore`, an `AssetTimeline` and a `StateEvaluator` over it, and an `AssetManager` |
| `ClipStore` | one build per track: `ClipInstance`, `AssetIndex`, `AudioIndex` and recorded dependencies |
| `StateEvaluator` | which tracks cover a frame; evaluates, lays out and draws them back to front |

`EnginePlatform` (`runtime/engine.ts`) is six factories: `createStorageAdapter`, `createRenderContext`, `createMeasureContext`, `createAudioSink`, `createTicker` (null for no realtime transport) and `createExporter`, plus optional `dispose`. All but the exporter run once per session, because a storage adapter is per viewport (it clamps decode resolution). Core stores and forwards what they return.

## Invariants and traps

**Document**
- **One list; array position is paint order**, first entry at the back. A background is the first track, an overlay the last, a cross-dissolve two overlapping tracks whose clips fade themselves. There is no `z`.
- **A clip is inlined, never referenced by id.** Two placements of one design are two documents, so each varies freely and no override mechanism or dangling reference exists. `Track.id` is what edits reconcile by.
- **There is no track opacity, blend or project command.** A clip's composite is its own root row's (`id: ""`, `canvas2d`): authored props are a baseline the timeline restores every frame, and a `to` on `targetId: null` animates over it.
- **`Track.duration` is required.** A project's length is arithmetic over its tracks, so a long media file cannot silently stretch an edit. It is the track's length, not the clip's: longer holds the clip's last frame, shorter cuts it (`frameTime` clamps). A lone still lifts to a track of `documentDuration` 0, which is one frame.
- **Length is the furthest track end, not the sum.** A gap renders transparent; past the end the evaluator holds the final stack (`_slotsToDraw`).
- **An audio clip is a scene with an empty visual half.** It is lowered to a composition ([timeline.md](timeline.md)), so `ClipInstance`, `StateEvaluator` and `ClipStore` need no second evaluator for sound.
- **Documents carry their format.** `formatVersion` on a still, composition, audio clip or project; absent is format 0 (everything written before the field). `DOCUMENT_FORMAT_VERSION` (3) is what this engine reads. `migrateDocument(doc)` (`document/migrate.ts`) runs every step in `DOCUMENT_MIGRATIONS` from the document's format up and returns `{ document, from, to, changes }`: the input itself when current, else a new document stamped `to`, the input never mutated. A step is a pure JSON → JSON function with its own test in `migrate.test.ts`, a `clip` hook run on every clip and an optional `project` hook. A clip in a project with no `formatVersion` of its own is read at the project's. A format above `DOCUMENT_FORMAT_VERSION` throws `DocumentTooNewError` (`version`, `supported`). Step 0 → 1 moves a clip's retired `constants` rows into `variables`. Step 1 → 2 finds every shader fill, shader effect (the retired `type: "sksl"` key becomes `"shader"`, its `shader` field `source`) and shader pack anywhere in a clip, stamps an SkSL one (`language: "sksl"`, or no `language` and an SkSL `main` or `uniform` in its source) with `language: "sksl"` and drops `coords`, noting a change; its source is kept for porting, and the renderer reports it as a `shader` issue and draws nothing. Step 2 → 3 moves the retired `filters` prop of every image and video fill anywhere in a clip into `preset.adjustments` (dropped when the fill already has one), noting a change.
- **Saved documents are a corpus.** `packages/core/test/fixtures/documents/<engine-version>/` holds documents as each release wrote them, and `fixture-corpus.test.ts` runs every one through migrate → validate → build, forever. Its `vocabulary.json` (`registryVocabulary`: every built-in type's props, defaults and commands) is what the next release is diffed against (`vocabularyBreaks`): a removed type, prop or command or a changed default fails the test unless a pending `**Breaking:**` changeset names it. A release snapshots a new set (`scripts/runbooks/release-and-ci.md`).
- **Output settings resolve once.** `resolveProjectDocument(document, override, fallback)`: `migrateDocument` (a result whose only change is the stamp keeps the input, so `replace` keeps its identity fast path), then override, else the document's, else the fallback, then `assertValidProjectDocument` (`fps` must be positive; `viewport` is not checked). `Session` and the exporters all use it, so every host agrees on which size wins; `PlaybackController` and the exporters throw on a project whose `fps` or `viewport` is unset.

**Edits** (`Session.replace` → `PlaybackController.setProject` → `ClipStore.setProject`)
- **Cost follows the edit.** Hand `replace` a new document object: identity is the fast path of every comparison, so one mutated in place is not seen as changed, while a copy equal in content keeps its trees. Tracks reconcile by `Track.id`. The same `clip` object keeps everything (a shorter `duration` only clips its index; a longer one keeps the tree but is swept again). A changed clip is diffed and handed to `planTimelinePatch` (the table under Incremental update in [timeline.md](timeline.md); a `null` plan, or an `applyUpdate` that throws, disposes the tree and builds fresh), `ClipInstance.applyUpdate` applies it in place and `dirtyOwners` re-declares only the asset owners it reached. A project `theme` change rebuilds every track (colours resolve as props are written).
- **The canvas is patched, never re-instantiated.** A changed root row resets the canvas's cells to the snapshot taken before the row was first set, then sets the row again, so a prop the row stopped naming returns to the constructed value.
- **A session's size and rate are fixed.** `replace` throws `Cannot replace a W×H @ Ffps document …` rather than change either. The `viewport`/`fps` given to `Engine.open` are remembered and win over every later document's own.

**Playback**
- **One clock, one generation.** Every tick, seek, swap, screenshot and `seekWhilePlaying` bumps `seekGeneration`; a pass checks `isCurrent(gen)` after every await and a superseded pass never paints. A tick awaits asset loading only, never the settle loop.
- **A frame is drawn by `renderAt` only, and it never throws.** A throw (a command at a time, a missing font while measuring) becomes a render error, reported once per distinct message in `buildErrors`; `onFramePainted` fires regardless. Missing assets are rescued first (see [assets.md](assets.md)). What the backend drew but not as the document says comes from `takeRenderIssues()` as a typed `RenderIssue` (`render/render-issue.ts`: `missing`, `shader`, `params`, `gpu`, `device-lost`, `crashed`) and lands in `buildErrors` with `issue` set, once per kind, feature and node. An export or still never sees `buildErrors`: `@motionscript/browser`'s export frame loop drains the same issues into `onIssue` and throws `RenderBackendError` (`retryable` for a lost device) on a `device-lost` or `crashed` one, since the frames around it are not to be trusted.
- **A paused frame is final.** When decodes or upgrades land behind it, `settleTrailing` repaints; while playing the next tick picks them up. `renderSettled` (`runtime/settle.ts`) renders and awaits `warmPendingDecodes` for at most `SETTLE_PASSES` (4), then warns.
- **A swap does not paint synchronously.** The canvas keeps the last complete frame until the new frame's assets load (`loadAndRepaint`); `repaint()` stands down while a swap's paint is owed (`pendingSwap`) and before the first frame. `whenReplaced()` resolves when that paint lands.
- **Seek and swap clamp differently.** `seek` clamps to `[0, totalFrames]`, one past the last frame (the evaluator holds the final stack); a swap clamps the playhead to `totalFrames − 1`. `Session.seek(seconds)` rounds to the nearest frame; the tick path keeps the fractional `clipTimeToFrame`.
- **`Ticker` actions take effect before they return** (`platform/ticker.ts`), so `seek()` then `play()` in one turn leaves the clock running. `PlaybackController.seek` pauses the clock, so a transport that seeks while playing uses `seekWhilePlaying`. A listener may `seek` (a host looping wraps on the last frame) and a subclass re-reads the end of the run afterwards (`WebTicker` does). There is no loop mode in the transport.
- **`play()` at or past the end seeks to frame 0 first**, swallowing errors. An empty project has 0 frames; the first tick pauses the clock.
- **The theme is process-global.** `Session.applyGlobals` calls `setTheme` before work the session starts itself (construction, `seekFrame`, `replace`, `image`, `export`), not before a clock tick, `repaint()` or `screenshot()`: two sessions with different themes contend.
- **No realtime clock is not no clock.** A platform answering `null` from `createTicker` gets a `SteppedClock`; `session.playback` is null and seeking, picking and drawing work as usual.
- **An exporter compiles against `request.registry` and builds its own storage adapter.** Reusing a session's would paint a 2× export from decodes sized for 1× (`WebExporter` in `packages/browser/src/engine.ts`).
- **Disposal.** After `PlaybackController.dispose()`, `seek`, `setProject`, `repaint` and every paint path return without touching the render context (each checks `disposed`), so an in-flight seek that resolves later does not draw. `Session.dispose()` has no guard of its own: call it once. `Engine.dispose()` clears manifest subscriptions and disposes the platform, not its sessions or exporter.

**Store**
- **One tree per track, drained rather than restarted.** Whatever the store does to a tree (refine, patch, rebuild, release) bumps the entry's `generation` and the evaluator evaluates again; a build parked by `runAsync` is drained by whoever needs the track first. Yield points are between frames.
- **A released tree is never drawn** (`StateEvaluator._live`). `release` keeps the index and audio; `trim` releases tracks further than 30 s (`TRIM_HORIZON_SECONDS`) from the playhead; a later `ensureBuilt` builds without refining.
- **A build that throws draws nothing** for that track and publishes a `BuildError`; other tracks carry on. `rebuild(trackId)` clears the failure.
- **A build steps around an unknown type or command** ([timeline.md](timeline.md)) and publishes each as a `BuildError` with a `code` (`"unknown-node-type"` with `nodeId`, `"unknown-command"` with `commandId`); the track still draws, and `ClipStore.failed` is false for it. A strict registry throws instead.
- **Track audio is clip-relative.** A bounded request is clipped to its track's length (`clampAudioToClip`) so a source outlasting the track does not sound past the cut; an open one resolves against the project end on assembly (`resolveOpenAudio`). There is no project-level audio outside a track.

**Editor surface** (`PlaybackController`, current track only)
- `getTreeState`, `getNodeBox(es)`, `pickNode`, `getTextLayout` read the evaluator's current track (topmost visual track on screen, else the last there was). `NodeBox.id` changes on every rebuild; key across rebuilds by `path`.
- **`setNodeOverride` writes straight onto live props**, re-applied after every evaluation. The timeline restores only what its commands write, so `clearNodeOverrides` rebuilds the track to drop them. It is for a pointer-rate drag; commit the value to the document on drop.

## Where to look

- Tests in `packages/core/src/runtime/tests/`: `track-placement`, `frame-time`, `clip-store`, `state-evaluator`, `playback-controller`, `controller-set-project`, `repaint-during-swap`, `settle`, `session`, `scrub-lifecycle-e2e`; `document/tests/{project,audio-document,validate-cache,timeline-patch}.test.ts`.
- `runtime/node-picking.ts` documents the viewport-space and one-walk rule for boxes and picks.
