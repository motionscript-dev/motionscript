# `apps/react` — the player, in a browser

A plain Vite + React page that drives `useMotionPlayer` and `MotionStage` from
`@motionscript/react` with hand-rolled controls. This is the fastest way to
look at a change: edit a scene, save, watch it.

```bash
pnpm build:lib                                 # the app runs against built dist/
pnpm --filter @motionscript/app-react dev     # http://localhost:5173
```

Nothing is shared with `apps/engine`: the scenes here are this app's own.

## Controls

Transport (start, ±1 frame, play/pause), a frame-accurate scrubber, speed,
render scale, loop and mute, a PNG screenshot of the current frame, and an
in-browser MP4 export via `session.export()`. Keyboard: <kbd>space</kbd>
plays, <kbd>←</kbd>/<kbd>→</kbd> step a frame, <kbd>shift</kbd> with them steps a
second, <kbd>home</kbd>/<kbd>end</kbd> jump to the ends.

## What is worth reading

- **`src/scenes/documents.ts`** — the scenes, as data: nodes and commands, each
  placed at a time. Edit these first.
- **`src/App.tsx`** — the host owns the engine: built once, handed to the
  player, and the asset manifest set on it *before* it is passed down (child
  effects run before the parent's, so a player handed an engine with an empty
  catalog resolves its assets against that).
- **`src/player/Player.tsx`** — everything below the canvas is
  `useMotionPlayer`'s transport, with `usePlayhead` subscribing only the
  scrubber and the readout to the frame. That is the whole surface a host builds
  an editor on, which is why exercising it here is the point.
- **`vite.config.ts`** — nothing a host needs beyond Vite's defaults: the
  renderer's WASM resolves beside its module. The page needs a browser with WebGPU.

## Fonts

Nothing falls back to a system font — the browser backend shapes with the
typefaces the asset manifest gives it. Drop `Inter.ttf` into `public/fonts/` to
enable the **Text** scene; until then the app disables it rather than drawing an
empty frame. See `public/fonts/README.md`.

## Tests

None here, on purpose: this is the page you look at, not a library. The player it drives is tested in `@motionscript/react`.
