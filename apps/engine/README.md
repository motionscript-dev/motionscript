# `apps/engine` — rendering a video from a server

A small HTTP server that renders Motion Script scenes from Node through
`@motionscript/headless` and hands the bytes back. The engine bundles
`src/project.ts` with esbuild and renders it with the browser engine in a
headless Chromium page, so install Chromium once with
`pnpm --filter @motionscript/headless exec playwright install chromium`.

```bash
pnpm build:lib                                  # the apps run against built dist/
pnpm --filter @motionscript/app-engine dev     # http://127.0.0.1:5175
```

Open `/` for a page that drives it, or call it directly:

| route | what it does |
| --- | --- |
| `GET /health` | engine state and registered fonts |
| `GET /scenes` | the catalog, each with whether this process can render it |
| `GET /scene?scene=<id>` | the scene **document** — the JSON the render is built from |
| `GET /image?scene=<id>&at=last&scale=1` | PNG, or JPEG with `format=jpeg` (or `jpg`); any other format answers 400. `at` is `first`, `last`, a frame index or a time such as `1s` |
| `GET /video?scene=<id>&scale=0.5` | MP4, encoded in the page with WebCodecs |

Nothing is shared with `apps/react`: the scenes here are this app's own.

## What is worth reading

- **`src/scenes/documents.ts`** — the scenes, as data. Nodes and commands, each
  command placed at a time. Edit these to try something out; nothing else needs
  to change.
- **`src/project.ts`** — the entry the engine bundles into its page: the node
  components, shaders and source-string node the documents name, plus the output
  size and frame rate (a `default` project with no tracks) every scene renders at.
- **`src/render.ts`** — the one `createServerEngine` for the process, the fonts
  and audio it serves and declares in the asset manifest, and the two render
  calls.

## Fonts

A family a scene names has to be declared in the asset manifest, or the page
shapes its text against a fallback face and renders the wrong type silently. Drop
a `.ttf`/`.otf` into `assets/fonts/` and restart; the file's name becomes the
family (`Inter.ttf` → `Inter`). Until then the **Text** scene reports 409 rather
than rendering against a fallback.

## Known gaps

- `signal` and `onProgress` on the app's render requests are accepted but not
  forwarded; `@motionscript/headless` takes neither.
