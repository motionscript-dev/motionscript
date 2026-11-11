# @motionscript/react

React bindings for [Motion Script](https://motionscript.dev): drop a scene into
your app and play it back on a `<canvas>` drawn with WebGPU.

```tsx
import { createBrowserEngine } from '@motionscript/browser';
import { MotionStage, useEngine, useMotionPlayer, usePlayhead } from '@motionscript/react';
import doc from './scenes/my-scene.json';

export function App() {
  const engine = useEngine(() => createBrowserEngine());

  const player = useMotionPlayer({ engine, document: doc, loop: true });
  const frame = usePlayhead(player);

  return (
    <>
      <MotionStage player={player} />
      <button onClick={player.toggle}>{player.isPlaying ? 'Pause' : 'Play'}</button>
      <input
        type="range"
        min={0}
        max={player.totalFrames - 1}
        value={frame}
        onChange={e => player.seek(Number(e.target.value))}
      />
    </>
  );
}
```

## What's in here

- **`useEngine`**: builds an engine from a factory you pass, returns it (`null`
  until it arrives) and disposes it on unmount, including an unmount that
  happened while the wasm was still loading, which StrictMode causes on every
  mount in development. `useEngine(create, { deps, onError })`: `deps` rebuilds
  it when something that makes a different engine changes, disposing the old one
  first (default `[]`, built once); `onError` replaces the default
  `console.error` when the factory rejects. The latest `create` is always the
  one called, so an inline arrow rebuilds nothing. It imports no platform: the
  factory is `createBrowserEngine`, a headless engine or a test double.
- **`useMotionPlayer`**: opens a session on an engine and gives you the
  transport for it — `play`/`pause`/`seek`/`speed`/`mute`/`loop`, the duration,
  build errors, and the editor surface (`getTreeState`, `pickNode`,
  `setNodeOverride`, `getTrackSpans`, …). A new `document` is reconciled onto the
  running session and the player keeps its place — the playhead stays put
  (clamped if the timeline got shorter) and playback carries on. The session
  patches only what the edit touched: a track whose clip is unchanged keeps its
  tree, and a changed one is updated in place where it can be, so treat
  documents as immutable and build the next one rather than mutating the last.
  Only a different `engine`, a document appearing or disappearing, or a changed
  viewport size or `fps` rebuilds the session; the new one is parked on the same
  frame and, if the player was playing, playback resumes once it has landed.
  No DOM: it owns the timeline, not a canvas. A project document's own
  `viewport` and `fps` win over the options, which win over the engine's, then
  1920×1080 and 60. `speed`, `muted` and `loop` are initial values; change them
  with `setSpeed`, `setMuted` and `setLoop`. A document that fails validation
  throws from an effect and reaches the nearest error boundary; `errors` holds
  discovery and draw errors. Pass a stable document reference: a new object on
  every render is reconciled on every render.
- **`MotionStage`**: a canvas bound to a player's session. It owns how the frame
  is rasterized — `renderScale`, `surfaceSize`, `view`, `clipToFrame`,
  `frameBackground` — and nothing about what is in it or when. A change to
  `renderScale` or to the canvas's buffer size re-creates the GPU surface, which
  drops decoded video frames and 3D composites (they re-upload on demand), so
  quantize them to a few steps and never drive them from a resize observer.
  `view`, `clipToFrame` and `frameBackground` apply only when `surfaceSize` and
  `view` are both given; a `view` change costs a repaint and nothing else.
  `player.screenshot()` returns the surface at its buffer size, so `renderScale`
  scales it too.
- **`usePlayhead`**: subscribes a component to the playhead. The frame moves at
  clock rate, so keeping it out of the player's own state is what stops a host
  re-rendering sixty-plus times a second — but only if you call it **as low in
  the tree as it will go**. A component that subscribes re-renders on every
  tick, and drags its children with it, so put it in the scrubber and the time
  readout rather than in whatever renders the stage.

### You own the engine

There is no provider. Say how to build an engine with `useEngine` and pass what
it returns in — which is also why nothing in this package imports a platform, so
it works with `@motionscript/browser`'s engine, a headless one, or a test double.

**Create it once and share it.** It holds the renderer and the exporter, so a
second engine is a second wasm module and a second renderer. `engine` is
nullable precisely because building one is async: the player no-ops until it
arrives, which keeps the hook out of a conditional.

**Set the asset manifest before you hand the engine down**, which means inside
the factory you give `useEngine`, before it returns. Child effects run before
the parent's, so a player given an engine whose catalog is still empty resolves
its assets against that and never finds them
([`apps/react/src/App.tsx`](https://github.com/motionscript-dev/motionscript/blob/main/apps/react/src/App.tsx) does it in order).

### One player per timeline, one stage per player

Two `useMotionPlayer` calls give you two fully independent players — separate
playheads, clocks, audio devices and transports — sharing only the engine:

```tsx
const before = useMotionPlayer({ engine, document: docA });
const after  = useMotionPlayer({ engine, document: docB });
```

A session drives **one** surface, so each player takes one `MotionStage`; a
second would take the surface from the first.

This package builds on [`@motionscript/core`](https://github.com/motionscript-dev/motionscript/tree/main/packages/core) (the scene graph and
animation runtime). A browser host will also want
[`@motionscript/browser`](https://github.com/motionscript-dev/motionscript/tree/main/packages/browser) for `createBrowserEngine`. The types a
`Player` method mentions (`NodeBox`, `TreeState`, `NodeState`, `NodeOverride`,
`TrackSpan`, …) are not re-exported here; import them from `@motionscript/core`.

## Usage

```bash
npm install @motionscript/react @motionscript/core @motionscript/browser
```

`@motionscript/core`, `react` and `react-dom` (18.2 or later, or 19) are peer dependencies. The package
is ESM only and declares `sideEffects: false`. `dist/browser/` is a minified
module for an import map; it imports `react`, `react/jsx-runtime` and
`@motionscript/core`, and the `manifest.json` beside it names the peers.

See the [docs](https://motionscript.dev/docs) for the full feature set and API
reference.

## Development

From the monorepo root:

```bash
pnpm --filter @motionscript/react build      # eslint, declarations, vite build, dist/browser
pnpm --filter @motionscript/react dev        # vite over examples/, port 5174
pnpm --filter @motionscript/react test       # vitest in a real Chromium
pnpm --filter @motionscript/react typecheck  # tsc -b --noEmit
```

The tests drive the hook against a fake engine inside real Chromium
(`@vitest/browser-playwright`); install it once with
`pnpm --filter @motionscript/react exec playwright install chromium`.
[`apps/react`](https://github.com/motionscript-dev/motionscript/tree/main/apps/react) is the playground: `pnpm dev react` after
`pnpm build:lib`. The traps in editing the hook are in [`CLAUDE.md`](https://github.com/motionscript-dev/motionscript/blob/main/packages/react/CLAUDE.md).
