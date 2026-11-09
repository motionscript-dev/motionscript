# Assets: declaring, windowing, loading

A node states what it loads in `declareAssets(assets: AssetScope)` (a no-op on `Node`, `components/trees/node/node.ts`), and what it plays through its commands' `timeline.sound` ([audio.md](audio.md)). The runtime turns those statements into per-clip frame windows, merges them onto the project timeline with lead and tail time, and loads each asset ahead of the frame that needs it. Code: `packages/core/src/assets/` (`scope.ts`, `asset-index.ts`, `manager.ts`, `catalog.ts`, `errors.ts`), `packages/core/src/runtime/` (`asset-refine.ts`, `asset-update.ts`, `project-assets.ts`, `asset-timeline.ts`, `clip-store.ts`) and `packages/core/src/platform/storage-adapter.ts`. How a decoded image or video frame is sized is the platform's business (`@motionscript/browser`); how the runtime drives this is [project-document.md](project-document.md); node-author guidance is the public guide [motionscript.dev/docs/custom-node/declaring-assets](https://motionscript.dev/docs/custom-node/declaring-assets).

## Model

| Stage | Code | Frame space |
|---|---|---|
| Declare | `AssetDeclaration` collects one node's `AssetDecl`s | none |
| Find windows | `refineAssets` sweeps a built `ClipInstance` into `AssetSegment`s per owner | clip-local frames |
| Union per key | `AssetIndex` (`setOwner`, `learn`) holds one `AssetRecord` per key | clip-local frames |
| Merge onto the project | `ProjectAssets.update` gives `AssetTrack { record, cacheAt, discardAt }` | project frames |
| Publish | `AssetTimeline` returns an immutable `AssetTimelineResult` | project frames |
| Load | `AssetManager.loadAt` / `prefetch` / `loadRecords`, then `StorageAdapter.loadAsset` | project frames |

Video `trimStart`/`trimEnd` are source seconds. `TrackAssets.audioRequests` are clip seconds: `AssetManager.syncAudio` and the exporter's `collectAudio` add the track's start.

**Scope methods** (`AssetScope`): `image(src)`, `video(src, { start, end })`, `font(family, weight?)`, `loader(key, load, { gate })`, `fill(fills)`, `effects(effects)`, `subtree(node)`. `fill`/`effects` dispatch to the registry kind's own hook (`FillData.declare`, `EffectData.declare`, which use `declareFilter` and `declareMediaPreset`); a recorded `Graphics3D`/`Scene3D` declares through `declare3DResources` (`render3d/tracking.ts`). A new fill or effect kind that loads something declares it in its own hook, once. `subtree(node)` binds a detached node (`attachDetached`) and walks it as part of the declaring owner: the path for a `Tex.surface` source, which no owner walk reaches.

**Keys**

| Key | Form |
|---|---|
| Asset key (`assetKey`) | image and video: the `src` as written; font: the family alone; loader: its key |
| Owner key | nearest document row's id, plus `/` and the child indices joined by `.` for a node a composite built (`ClipInstance.forEachOwner`, inverse `ownerKeyOf`); the root canvas is `ROOT_NODE_ID` (`""`) |
| Slot id (`asset-update.ts`) | `<ownerKey>\u001f<prop>`; `\u001e<name>` hostless (`var:g`, `presence:card`); `\u001d<name>` host no row built |

Pseudo-slot names (`props/observer.ts`): `PRESENCE_PREFIX` `presence:`, `STRUCTURE_SLOT` `structure`, `VAR_PREFIX` `var:`, `LAYOUT_SLOT` `layoutBounds`.

**Windows** (`project-assets.ts`; decoded MB is `width × height × 4 / 1 MiB` from the catalog, 0 when it cannot size the source; `cacheAt` floors at 0)

| Type | `cacheAt` | `discardAt` |
|---|---|---|
| image | start − clamp(round(2 × MB), 2, 120) | end + 30 |
| video | start − min(120, 2 × image lead + round(fps)) | end + 30 |
| font | 0 | `null`: never discarded |
| loader | start − 120 | end + 30 |

An asset several tracks use is one entry over the union window, the first holder's content speaking.

**Gates.** `AssetGate` is `"layout"` (resident before the track measures) or `"render"` (before the frame draws, the default). A font is always a layout gate; `loader(..., { gate: "layout" })` opts a loader in. `AssetIndex.layoutGates()` lists them, `TrackAssets.layoutGates` publishes their keys, and `PlaybackController.loadFrame` loads every unready gate of the tracks covering the frame together with the frame's assets.

**Manifest.** `AssetManifest` is `{ image, video, audio, font }`. Image, video and audio are keyed by path relative to the host's media folder (forward slashes, no leading `./` or `/`); `ManifestAssetCatalog` normalizes a source before lookup and every lookup but `getFontFamilyMetas` throws on a miss. A width or height of 0 means size unknown. A session holds one catalog; `Engine.setManifest` reconciles it in place (`ManifestAssetCatalog.reconcile`), hands it to the storage adapter (decodes are kept) and `PlaybackController.reconcileCatalog` starts every track again.

## Invariants and traps

- **A declaration is a pure function of the props and context it reads.** `refineAssets` runs each one inside `observeSlots`, recording every `PropSlot` read. Reading `layoutBounds` or the node clock, or writing a slot, logs a development warning once per class and nothing else: nothing re-asks the declaration when those change.
- **Dependencies are recorded, never annotated.** An owner is declared on arrival and again on the frames where a recorded read can have changed: every frame a placed command that writes a read slot is active, the first frame after it, and any frame a `presence:` or `structure` slot it read moved. A re-run whose reads all hold (`Object.is`) reuses its result. Compile records each command's writes around its factory call and `at(1)` (`PlacedCommand.writes`); a write the sweep catches outside that set extends it, re-queues the readers and warns (dev), at most `MAX_REQUEUES` (3) times per owner, after which windows may be incomplete.
- **Declare every candidate of an asset chosen over time.** A pick from a prop (`slides[Math.round(this.index)]` under `to({ index: 4 })`) is tracked frame-exactly, one segment per switch; a pick from the clock at draw time is invisible to the sweep. Declaring the whole set is right in both cases and lets the manager load ahead.
- **Call `super.declareAssets(assets)` first.** Without it what the base declares (`Node2D` effects; on a component's generated class, its paint, image, video and font entries and its `load`, which is where a text's families and run paints, a video's source and `Canvas3D`'s `three:runtime` loader come from) stops loading.
- **One key space; the first declaration wins, silently.** `image("a")`, `font("a")` and `loader("a", ...)` collide. Keys are the string as written, so `a.png` and `./a.png` are two records and two loads even though the catalog resolves both. Across owners and tracks the earliest-starting segment speaks for the key: its video trims, font weight or loader function describe the whole union window.
- **Loaders are keyed and the function never captures the node.** `loader(key, load, { gate })` dedupes by key; a second, different function for a key is ignored with a development warning, and a declaration compares its loader by identity, so a fresh closure per call is a changed declaration on every re-run. Hoist one function per key. The record outlives the instance (`ClipStore.release` keeps the index), so a closure over `this` pins a disposed tree. `"layout"` wins whichever declaration asked first.
- **A loader that resolves no disposer is forgotten when its window closes** (`AssetManager.syncLoader`) and runs again when a window reopens; only a layout gate is exempt from window eviction. Return a disposer to be freed on purpose. The `LoaderFn` docblock's "resolving nothing keeps it resident" is not what the manager does. The manager never unloads images, videos or fonts; their memory belongs to the adapter's caches.
- **An owner is a row, not a node.** Segments key by owner key so an index survives `release`/`trim` and an edit re-declares only the owners it reached. A UUID changes every build and a root path shifts when a sibling enters; an owner key does neither.
- **Edits re-declare only what they reached.** `dirtyOwners` reads recorded dependencies only: an edit no declaration read (a position, a size, a tween of either) names nobody, and the republished timeline carries only keys that moved. Every rule errs towards naming an owner; a missed one keeps a window a fresh build would not have. A longer track drops its discovery (the frames past the old end were never swept); a shorter one only clips its index.
- **`font` and layout loaders gate layout.** Text is measured against its face. A track whose build measured a family before it was resident is noted (`ClipStore._compile`) and rebuilt once when it lands (`settleGates`, from `renderAt`), whether or not a command read layout: a node may keep what it measured (`code` caches token advances), and only a fresh tree drops metrics taken against the fallback face. A gate no owner declares is dropped, never waited on.
- **Fonts key by family, and the manifest decides.** `loadFont` registers every file the catalog describes for the family (matched on `FontMeta.fontFamily`, not the `family@weight` key) under the bare family name. `StorageAdapter.parseFontKey` splits keys on `@`, so a family name containing `@` is truncated. A family the manifest does not describe is drawn in the platform fallback face: a preview warns once per family per catalog (`WebStorageAdapter.loadFont`), does not remember it as loaded and retries on every `loadAt`, so a later `setManifest` that describes it takes effect. A host installing fonts must put them in the manifest.
- **A miss is a safety net, not a load path.** An image or video the draw finds unloaded throws `AssetNotLoadedError` (from the renderer's image and video draws), stamped once with the innermost drawing node's id (`Node2D.render`). A preview rescues it: `PlaybackController.recoverMissingAsset` (font, image, video; once per `type:src` until `clearRenderErrors`) learns the owner's window (`AssetTimeline.learn`, `AssetIndex.learn`; forgotten at the owner's next `setOwner`), loads the source directly and repaints. An export has no rescue. A video frame the decode window has not reached, an empty `src` (paints the unset-media checkerboard) and an undeclared face (shapes in the fallback) are not misses.
- **A family the manifest cannot describe is a miss for a blocking caller.** A still or an export (`DecodePolicy` `"exact"`, which the platform's export and still paths set) throws `AssetNotLoadedError` from `StorageAdapter.runLoad` for a declared family with no manifest entry instead of shaping it against the fallback face, because that frame differs from the one the same document draws once the family is described, so whatever stored or encoded it would have kept the wrong one. A preview still draws in the fallback face (and warns) until a manifest describes the family, and retries when it does.
- **A failed load is never cached.** `loadAsset` remembers a key only when the load happened; a rejecting load rejects a blocking `loadAt`, is logged by `prefetch`, and is tried again on the next call. A failed audio fetch is reported once through the manager's `onError` (only when a request asked for the source by name; an `optional` request stays quiet) and not retried until nothing in the window asks for it or a new result arrives.
- **Audio sync is windowed.** `syncAudio` admits a request that has not ended and starts at most 10 s ahead of the playhead; the request id folds in source, shifted times, trim, loop, volume, filters and bus chain, so any edit to those reschedules. What a node declares as audio is [audio.md](audio.md).
- **Published results are immutable and identity means no change.** `AssetTimelineResult`, `TrackAssets.assetRecords` and the merged `assets` map are replaced, never mutated; the same object comes back while `ClipStore.version` has not moved.

## Where to look

- Tests: `assets/tests/{scope,asset-index,manager,catalog,errors}.test.ts`; `runtime/tests/{asset-refine,asset-update,asset-timeline,project-assets,clip-store,override-asset-rescue}.test.ts`; `components/trees/tests/declare-assets.test.ts`; `platform/tests/storage-adapter.test.ts`; `packages/browser/test/{asset-not-loaded,asset-fetch-failure,asset-url-resolution,text-fonts}.test.ts`.
- `runtime/asset-walk.fixtures.ts` declares every frame: the reference `refineAssets` is held to.
