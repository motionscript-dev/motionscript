# CLAUDE.md — `packages/react`

You are editing `useMotionPlayer` (`src/ui/use-motion-player.ts`), `useEngine`
(`src/ui/use-engine.ts`), `MotionStage` (`src/ui/stage.tsx`) or the playhead
(`src/ui/playhead.ts`). The hook owns a `Session` and no DOM; the stage owns a
canvas. Every trap fails quietly.

## The hook

- **The playhead is an external store. Never write it during render and never
  hold the frame in `useState`.** `playhead.set` notifies subscribers
  synchronously, so a render-time write updates one component while rendering
  another, and state at clock rate re-renders the host subtree faster than the
  project's frame rate. Only effects, event handlers and the clock listener
  (`onTime`) write it; consumers read it with `usePlayhead`, low in the tree.
- **The session-open effect's dependency array tears down the whole backend**:
  GPU surface, audio device, clock, asset timeline. It is `[engine, hasDocument,
  viewport.width, viewport.height, fps, sync]`; `document` is absent on purpose
  (the `eslint-disable` is deliberate); to react to something new, add an effect
  that reconciles onto the live session.
- **A new document keeps the player's place.** The reconcile effect calls
  `Session.replace(document)` and clamps the playhead to the new length. No seek,
  no pause: `replace` paints the current frame once its assets load
  (`whenReplaced`) and a running clock keeps ticking. Do not add a seek.
- **`document` is compared by identity and is immutable**: an in-place edit is not
  seen, a new object every render re-runs reconcile every render, and
  `Session.replace` throws on a changed viewport size or fps (those rebuild).
- **`seek` pauses the clock before its first await**, so `seek` then `play` in one
  batch leaves `isPlaying` unchanged. That is why `play` and `pause` also drive
  the controller through `playingRef`/`controllerRef`. A rebuild while playing
  resumes once its park on the playhead's frame lands; a newer seek or pause wins.
- **Actions are built once and read the controller through refs; the `Player`
  changes only when a state field does.** `errors` and `precomp` keep their
  identity when a report repeats; a fresh array per `sync` re-renders consumers.

## The stage

- **One stage per player.** A session drives one surface; a second stage takes it
  from the first. The stage has no cleanup: unmounted while its player lives, the
  surface stays mounted on the removed canvas.
- **The bind effect's order is load-bearing**: the renderer builds the surface from
  the canvas's `width`/`height` that React wrote before effects ran; then
  `mount(canvas)`, then `controller.repaint()` (a new surface starts blank).
- **The buffer is sized from `session.viewport`, not `player.viewport`.** The
  player's size changes a commit before its new session exists, in the commit
  whose cleanup disposed the old one; a bind keyed on it mounts the disposed
  context (`stage.test.ts`).
- **The stage's effects check `isSessionDisposed` before touching a session.**
  React replays a child's effects with the props it last rendered after the
  parent's cleanup ran (a suspended boundary revealed, StrictMode), so the
  `session` an effect holds can already be disposed.
- **`renderScale` and the buffer size re-create the surface**, dropping
  texture-backed images. The view effect depends on the `view` fields, not the
  object, or every gesture frame repaints.

## Host contract

- **A host sets the asset manifest before handing the engine down.** Child effects
  run before the parent's, so a player given an engine with an empty catalog
  resolves its assets against that and never finds them (`apps/react/src/App.tsx`).
- **Nothing here imports a platform, and `engine` is nullable** (building one is
  async): no provider, no `@motionscript/browser` import in `src`. `useEngine`
  stays inside that rule by taking the factory as its argument; a
  `useBrowserEngine` that called `createBrowserEngine` itself would need a
  decision first, not a quiet import.
- **`useEngine` disposes on every path**: cleanup, a late arrival after
  cleanup (`!live`), and a `deps` change. It reads `create` through a ref, so
  `deps` is only what makes a *different* engine, never the closure. Cleanup
  sets the state back to `null`, or a player keeps a disposed engine until the
  next one lands.
- A new barrel export needs a changeset; `Player`'s types come from core, a peer.

## Docs

- [README](./README.md), [`apps/react`](../../apps/react/README.md): usage and playground
- [Build orchestration](../../scripts/runbooks/build-orchestration.md) (`typecheck` is `tsc -b --noEmit` here); [why](../core/docs/why.md#a-frame-is-a-pure-function-of-its-time) (why a seek is cheap)
