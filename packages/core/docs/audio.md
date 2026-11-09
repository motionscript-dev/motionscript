# Audio

Sound is a third node tree ([scene-graph.md](scene-graph.md)): `NodeAudio` with `AudioBus` (a group) and `SoundNode` (a leaf), placed by their rows' spans and animated by the commands every node has. There is no parallel audio timeline: a node's commands state the clips it plays (`timeline.sound`), and the runtime turns them into `AudioRequest`s (plain data) that a platform device schedules and a mixer renders offline. Core's half lives in `components/trees/audio/`, `attributes/audio/`, `document/audio.ts`, `runtime/audio-index.ts` and the seam `platform/audio-sink.ts`; the device, bus graph and mixdown are in `packages/browser/src/audio/`. Windowing and sync: [assets.md](assets.md); presence: [timeline.md](timeline.md).

```ts
AudioBus({
    id: "mix",
    volume: 0.8,
    children: [
        AudioBus({ id: "dialogue", transitionOut: { duration: 1 }, children: [SoundNode({ src: "vo.mp3" })] }),
        SoundNode({ src: "whoosh.mp3", volume: 0.4, speed: ramp(1, 1.5, 2), effects: AudioEffects.lowpass(4000) }),
    ],
});
```

## Model

### Nodes and documents

| Document key | Class | Props (default) |
|---|---|---|
| `audioBus` | `AudioBus` | `solo` (false), plus the `NodeAudio` props |
| `sound` | `SoundNode` | `src`, `trimStart` (0), `trimEnd` (undefined: to the end of the file), `loop` (false), `speed` (1, a `Param`) |
| (base) | `NodeAudio` | `volume` (1), `pan` (0), `mute` (false), `effects` (`[]`), `transitionIn`, `transitionOut` (undefined); `volume` and `pan` are `Param` |

`SoundNode` is a leaf (`acceptsChild` is false). `Canvas2D` accepts audio children, so a composition carries the picture and the voice-over together; `Node2D.children` already filters to 2D, so layout and render skip them, and the owner walk reads `_allChildren`.

An `AudioDocument` (`kind: "audio"`) has `nodes`, `commands`, optional `variables` and `duration`; it has no still form and no theme. `loweredAudioDocument` rewrites it into a composition so the one `ClipTimeline` runs it: a `canvas2d` root `""`, a default root bus `@bus` (`AUDIO_ROOT_ID`) unless the document authors one (the row `id: ""`, `type: "audioBus"`, renamed `@bus`), every `parentId` of `null` or `""` moved to `@bus`, and every command `targetId` of `null` or `""` retargeted to it.

### When a clip plays

A `SoundNode` plays from its `play` command; a `sound` row with none gets one over its span (`clipDocument`), so a row plays while it is present: `startAt` starts it, `endAt` stops it. There is no `startAt` prop. `trimStart`/`trimEnd` say *what part of the file*; the span says *when on the timeline*.

### Declaring and requesting

A command's `timeline.sound` places a clip (`AudioClip`) at the time the command runs; `ClipStore` gathers the placed commands' sounds under the row that plays each, and `requestOf` (`schedule.ts`) is the one kernel that builds the request.

| Clip, in the order `requestOf` tests | `endAt` | Marked `open` |
|---|---|---|
| looping, finite `until` | `until` | no |
| looping, no finite `until` | `Infinity` (no `mediaDuration`) | yes |
| not looping, finite `trimEnd` | `min(until, at + clipTimeAtSource(speed, trimEnd - trimStart))` | no |
| not looping, no `trimEnd`, finite `until` | `min(until, at + natural)` | no |
| not looping, no `trimEnd`, no finite `until` | `Infinity`; `mediaDuration` carries `natural` | yes |

`until` defaults to the span's end, so only a node that never leaves can be open. `natural = clipTimeAtSource(speed, max(0, mediaDuration - trimStart))`: source seconds converted to clip seconds at `speed` (a non-positive scalar counts as 1; a ramp is integrated once per ramp object and length into a cached table, so every later question, a device scheduling hundreds of rate points a second included, is a lookup). `clipDurationOf` and `sourceTimeAtClip` are the same arithmetic for a host sizing a bar. A looping request with an out-point past the in-point carries `trimEnd` so a device loops that region. An open request continues across later tracks and is resolved against the project end on assembly (`resolveOpenAudio` in `runtime/asset-timeline.ts`); a bounded request is clamped to its own clip (`clampAudioToClip` in `runtime/clip-store.ts`). Every bus stop is clamped, open or not.

| `AudioRequest` field | Notes |
|---|---|
| `id` | `<ownerKey>\|<src>\|<at>\|<n>`; `ownerId` is the owner key. `src\|startAt` is not unique across nodes, so two clips of one file at one instant on different buses would collapse |
| `startAt`, `endAt` | clip seconds as a node declares them; project seconds at a device (`AssetManager.syncAudio` adds the track's start). `endAt` is never `null`: test `Number.isFinite(endAt)` |
| `volume`, `speed` | `Param`; `speed` absent is 1 |
| `sourceLength` | carried with a speed ramp only: the source seconds it is placed on (`trimEnd - trimStart`, or to the end of the media), so a device places it as the request was sized |
| `effects`, `bus` | source-adjacent first (index 0 nearest the source); `bus` absent means straight to the master |
| `transitionIn`, `transitionOut` | a gain over the clip's first and last seconds, on top of `volume` |
| `optional` | a video's own track: a source with no audio is silence, not a failure |

Time spaces: clip seconds, project seconds, **source seconds** (`trimStart`, `trimEnd`, the axis of a `speed` ramp). `AudioIndex` keeps requests per owner so one owner can change without redeclaring the rest.

### Buses

A bus is a shared signal path, not an authoring grouping: `AudioRequest.bus` is a list of `AudioBusStop` (`id`, `volume`, `pan`, `mute`, `effects?`, `transitionIn?`, `transitionOut?`, `startAt`, `endAt`), plain data so it can cross the core and platform seam. Every clip naming one `id` feeds one live chain, so a reverb on a bus is a single tail the group shares, which flattening the gain would sound like and flattening the effects would not. `busPathOf(node, audio)` walks audio ancestors up to (not including) the `Canvas2D`; `busPathTo` starts at a given bus; `findBusById(from, id)` lets a `Video` (welded to its picture, so it cannot sit under a bus) name one through `Video.bus`. `busStopKey` is what a device compares to tell an edited bus from the one it built. A stop's `startAt`/`endAt` are the bus row's own span, which is what a ramp or a transition on the bus runs over.

### Params, ramps, effects and transitions

`Param = number | Ramp`, and a `Ramp` (`attributes/audio/ramp.ts`) is plain JSON: `{ keys: [{ at, value, ease? } | { before, value, ease? }] }`. `at` is seconds after the start, `before` seconds before the end, so a `before` key stays put when the clip is trimmed; `ease` is the commands' `EaseSpec`, shaping the segment arriving at its key (linear when absent). `resolveRamp` places the keys on a length, clamps them to it and sorts any whose anchors cross (with a development warning); before the first key the value is the first key's, after the last the last's. `volume`, `pan`, effect params and transitions run over **clip seconds**; `speed` runs over **source seconds after `trimStart`**, because clip time depends on the speed.

The builders `ramp(from, to, d)` and `hold(d?)` chain fluently and return a `RampChain`, whose one own field is `keys`: segments before the first bare `hold()` become `at` keys, segments after it `before` keys, so `ramp(0, 1, 0.5).hold().ramp(1, 0, 1)` fades in over the first half second and out over the last second. An ease given as an engine-built function is stored as the spec it records (`specOfEase`); any other function throws.

The effects (`AudioEffect`, built by `AudioEffects`):

| `type` | Fields (each a `Param`) | Notes |
|---|---|---|
| `gain` | `value` | `AudioEffects.volume` is an alias |
| `highpass`, `lowpass` | `frequency`, `q?` | |
| `tremolo` | `rate`, `depth` (0.5) | |
| `echo` | `delay`, `feedback` (0.4), `mix?` | |

`AudioEffectRegistry` is seeded with all five from a typed table, not by each module registering itself on import: core is `sideEffects: false`, and a dropped registration would hard-cut instead of interpolate with nothing raised.

A transition (`AudioTransition`, `attributes/audio/transition.ts`) is `{ duration, curve? }`: a gain over the first (`transitionIn`) or last (`transitionOut`) `duration` clip seconds, multiplied on top of `volume`. `curve` is read as entering (x progress, y gain) and played backwards to leave; it defaults to `"equalPower"` (sin πx/2). In and out together longer than the clip shrink in proportion. A cross-fade is not an entity: it is two clips whose spans overlap, the first with a `transitionOut` and the second a `transitionIn` as long as the overlap, and equal-power shapes keep the loudness steady with no link between them. The chain a request plays through is source (`playbackRate` from `speed`) → effects → level gain (`volume`) → transition gain → its buses.

## Invariants and traps

- **Audio is scheduled ahead of time.** A request is a schedule record handed to a device, built from where each sound's command sits, so a command that writes a level partway through a sound is not heard: automate a level with a ramp or split the row. A document edit re-declares the owners it touches.
- **`to()` on `volume`, `pan` or `speed` throws a `TypeError`** (`NodeAudio._prepareStep`). The alternative is a command that runs its duration, draws a bar and renders flat. `to` on `trimStart`, `mute`, `solo`, `effects` or a transition is accepted and equally inaudible after arrival; a `to` that adds an effect puts it in the request from the first frame (`lerpArray` keeps an unpaired effect whole).
- **`pan`, `AudioBus.solo` and `SoundNode.mute` do nothing.** `pan` is carried in stops and hashed into the key but no device applies it; nothing reads `solo`; only a bus's `mute` reaches a request (a sound's own is not read).
- **A ramp ease cannot name a registered ease.** A device has no `Registry`, so `{ kind: "custom", args: "<key>" }` throws where `easeOfSpec` resolves it; the validator refuses it on `sound` and `audioBus` rows, as it does a `filters` prop there (renamed to `effects`). `lerpParam` hard-cuts at 0.5 when either side is a ramp.
- **A speed ramp on a looping sound plays at its start value** (a development warning; the validator refuses it): a loop has no one pass of the source for the ramp to run over.
- **One bus node is one bus.** Containment (or `Video.bus`) is the only thing that puts a clip on it; two bus nodes sharing a `key` do not merge, so `key` stays the unique handle expressions name.
- **A bus's identity `NodeAudio._busId` is its authored id, else its structural path.** It reaches `AssetManager.stableKey`, so a string that changes on rebuild re-fetches and reschedules every clip on the bus. A document row's id is fixed while its child index moves as presence adds and removes siblings; a code-built bus has no id but the same slot every rebuild. `Registry.instantiate` threading `spec.id` is what makes the first answer available.
- **`findBusById` matches any `NodeAudio`**, so a `Video.bus` naming a sound routes through a stop for that sound; an id matching nothing routes to the master.
- **A source missing from the manifest throws at declaration** (`requestOf` reads `catalog.getMediaDuration` even when the length is unused); `ClipStore` records it as a build error for that owner and keeps declaring the others.
- **An authored `@bus` row is not rejected** (the validator reserves only `""`) and collides with the lowered root bus.
- **Effects key by `paramKey`**, the JSON of a ramp's keys, so any edit changes the key and the same ramp built twice does not. An unknown effect type contributes no key and no node.
- **The live device and the offline mixer build bus chains with one `AudioBusGraph`** (`packages/browser/src/audio/player.ts`, `mixer.ts`), so an export, including a headless one, sounds like the preview.

## Where to look

- `components/trees/audio/node-audio.ts` (`NodeAudio`, `busPathOf`, `findBusById`, `structuralPathOf`); `components/builtins/audio/audio.ts`, `components/factory/component-audio.ts`; `attributes/audio/schedule.ts`, `request.ts`, `ramp.ts`, `transition.ts`, `effects/{chain,registry,union}.ts`; `tween/ease/spec.ts`; `document/audio.ts`; `document/validate.ts` (`checkAudioProps`).
- Tests: `components/builtins/audio/tests/audio-nodes.test.ts`, `attributes/audio/tests/{sound,ramp,transition}.test.ts`, `attributes/audio/effects/tests/{chain,registry}.test.ts`.
