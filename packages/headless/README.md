# @motionscript/headless

Render [Motion Script](https://motionscript.dev) projects to stills and video
from a Node process, so a render can be a request rather than a person at a
browser.

```ts
import { createServerEngine } from '@motionscript/headless';

const engine = createServerEngine({ projectRoot: '/srv/projects/promo' });

const still = await engine.renderImage({ document, frame: 'last', format: 'jpeg' });
const video = await engine.renderVideo({ document, scale: 2 });

await engine.close();
```

The engine bundles the project entry with esbuild, loads it into a headless
Chromium page driven by Playwright, and renders there with
[`@motionscript/browser`](https://github.com/motionscript-dev/motionscript/tree/main/packages/browser). A server export and a browser preview
are the same code, `Canvas3D` and audio included.

## Install

```bash
npm install @motionscript/headless @motionscript/core
npx playwright install --with-deps chromium
```

`@motionscript/core` is a peer dependency, so the project entry and the page share
one copy of the engine.

## The project entry

The engine renders a project **entry**: a file, by default
`<projectRoot>/src/project.ts`, that exports what the documents need.

```ts
// src/project.ts
export const nodes = [PulseRing];           // node classes the documents name
export const shaders = { ripple: Ripple };  // optional
export default projectDocument;             // optional: rendered when a request brings no document
```

Node types are components, and code does not survive a process boundary, so the
entry is bundled into the page once. Documents are JSON and travel with each
request. The built bundle is cached (by default in the project's
`node_modules/.cache/motionscript`), keyed on the path, mtime and size of the
files esbuild resolved and of the module that builds it, so a new version of
this package builds afresh. The key ignores esbuild's own version, old entries
are never pruned, and the build itself runs on every start.

Only `nodes`, `shaders` and `default` are read. The page draws through
`@motionscript/browser`'s WebGPU renderer, always launched with WebGPU on.
`nodes` is an array of components
and TS source strings that default-export one (compiled in the page), or a
record of components only.
`default` is a `ProjectDocument`: it is what a request with no `document`
renders, the source of `projectName()`, `fps()` and `listTracks()` (`''`, `0` and
`[]` when absent), and the engine's fallback `viewport` and `fps`. A relative
`entry` resolves against `process.cwd()`, not `projectRoot`.

The bundle is one browser IIFE. The entry is loaded with a dynamic `import()`, so
a throw while it loads is reported as `START_FAILED` carrying the cause. The Node
built-ins `fs`, `path`, `crypto`, `os`, `module` and `worker_threads` (with or
without `node:`) resolve to an empty module in the page, `*.wasm` imports stay
external and `.json` is inlined. Packages' `sideEffects: false` is ignored: with
the entry loaded lazily, honouring it left a module the entry shares with the
engine unstarted on the engine's side, and an entry whose first import was the
SDK failed to load (evanw/esbuild#1490).

## How the page reaches files

The page is served from `https://motion-script.local/`, a name that resolves to
nothing: only that origin is routed, from memory and disk, so there is no port.
After the built-in routes (`/`, `/ms_renderer_bg.wasm`, `/esbuild.wasm`, `/bundle.js`)
a request is answered from `serve[pathname]` (the percent-encoded URL path), then
from `assetsDir`, where `..` or a symlink leading out of it is a 404. A document's
relative `src` (`images/logo.png`) resolves against that origin root.

## API

- `createServerEngine(options)` returns a `MotionScriptServerEngine`. It
  starts on the first call, or when you call `start()`.
- `engine.renderImage({ document?, frame?, scale?, format? })` returns
  `{ bytes, frame, totalFrames }`. `frame` is a frame index, `'first'` or
  `'last'` (the default). `format` is `'png'` (the default) or `'jpeg'`.
- `engine.renderVideo({ document?, scale?, supersample?, codec?, bitrate?, hardwareAcceleration?, includeAudio?, concurrency? })`
  returns the encoded MP4 bytes. The encoder options are the browser exporter's:
  `supersample` defaults to 2, `codec` to `'avc'` (an encoder this Chromium
  lacks falls back to it), `bitrate` (bits per second) to 0.2 bits per pixel per
  frame, and `includeAudio: false` writes no audio track. `concurrency` is below.
  The document crosses into the page as its JSON text, because Playwright
  carries an object of thousands of nodes several times slower than a string; a
  caller holding the JSON already (a request body) may pass the string itself.
- `engine.listTracks()`, `engine.projectName()` and `engine.fps()` describe the
  entry's default project.
- `engine.close()` shuts the browser down. A closed engine throws `CLOSED`.

Nothing is validated, queued or timed. Every option reaches the page as given, so
run the `parse*` helpers below at the edge. One browser and one page serve every
call (a split export adds pages), each render in a session of its own; concurrent
calls are not serialized or limited, and a render has no time limit or abort
signal. The only timeout is the 60 s a page gets to publish its bridge.

## Parallel export

`renderVideo({ concurrency: n })` cuts the timeline into `n` contiguous runs of
frames (one per frame when there are fewer), renders and encodes each in a page
of its own, and joins them in the first page with `concatVideoSegments`, without
re-encoding. The pages share the one Chromium and the one bundle, and each is in
a browser context of its own, so the runs render at the same time. At the
default of 1 nothing changes: the first page exports the whole timeline.

- **One encoder configuration.** Every segment is encoded with the same `codec`
  (default `'avc'`), `hardwareAcceleration` (default `'no-preference'`) and
  bitrate (the caller's, or the default, which depends only on the output size
  and frame rate every segment shares). Each segment's encoder begins on a key
  frame, so the joined file has one at every seam besides its usual one a
  second, and is a little larger than the same frames exported in one page.
- **One audio track.** Segments are encoded silent. The first page mixes the
  whole timeline once with `mixTimelineAudio` and encodes it into the joined
  file, because AAC joined across seams clicks at each one.
- **A join that cannot be made falls back.** If the segments still come out
  encoded differently (a platform that gives some pages a hardware encoder and
  others a software one), the engine writes why to stderr and exports in one
  page instead. Pinning `hardwareAcceleration` to `'prefer-software'` rules that
  out at the cost of speed.
- **The pages stay.** The added pages stay open for the next export and close
  with the engine. Each holds its own WebGPU device and renderer heap, and
  every segment crosses into Node and back to the first page as base64, so size
  memory for `concurrency` pages.
- **Discovery is per page.** A page discovers every track its frames touch, in
  full, so a timeline made of one long track pays for that track's discovery in
  every page.
- If any segment fails, the call rejects with the first failure once every page
  has finished, and nothing is joined.

## Options

| Option | Default | |
| --- | --- | --- |
| `projectRoot` | `process.cwd()` | Where the entry and assets are looked up. |
| `entry` | `<projectRoot>/src/project.ts` | The file to bundle. |
| `assetsDir` | `<projectRoot>/public` | Served at the page's origin root, for the assets a document names. |
| `serve` | none | Extra files to serve, by URL path. Overrides `assetsDir`. |
| `manifest` | none | Asset manifest the page resolves `src` values against. Fonts need it: an undeclared family is never fetched. |
| `softwareRender` | `false` | Draw on SwiftShader's WebGPU adapter (`--use-webgpu-adapter=swiftshader`) instead of a GPU. |
| `headed` | `false` | Launch a windowed Chromium (needs a display: `xvfb-run` on Linux). Headless Chromium on Linux reads a WebGPU canvas back empty on SwiftShader, so render there headed. |
| `cacheDir` | `<entry dir>/../node_modules/.cache/motionscript` | Where the built bundle is cached. |
| `onPageMessage` | stderr | Receives every warning and error the page logs. A browser's failures are mostly soft (an undeclared font warns and draws in a fallback face), so a caller that compares pixels uses this to turn them into failures. What the renderer drew but not as the document says arrives as a `[render issue] <kind> <feature> on <node>: …` warning. |

## Errors

Start-up failures are an `EngineError` carrying a `code`, so a handler can map
them without matching on message text:

| Code | Raised when |
| --- | --- |
| `PROJECT_NOT_FOUND` | There is no file at the entry path. |
| `START_FAILED` | The entry failed to bundle or to load in the page. |
| `BRIDGE_TIMEOUT` | The page never published its bridge. |
| `BRIDGE_INCOMPATIBLE` | The page bridge is missing a method, which usually means a stale cached bundle. |
| `CLOSED` | The engine was used after `close()`. |

`isEngineError(err)` narrows an unknown error. An error thrown inside the page
during a render reaches the caller as Playwright reports it. A failed start
closes the Chromium it launched, so `start()` can be retried. `UNKNOWN_SCENE`,
`RENDER_FAILED`, `TIMEOUT` and `ABORTED` are in `EngineErrorCode` and never raised.

The option parsers are exported for validating a request body at the edge:
`parseFrameSelector`, `toFrameSpec`, `parseScale`, `parseImageFormat`,
`parseCodec`, `parseBitrate`, `parseSupersample`, `parseConcurrency` and
`parseTimeout`. Each throws `INVALID_OPTION` with a message naming the value it
refused.

## Running it in production

**Containers need `softwareRender`.** On a host without a GPU the page gets
no WebGPU adapter and every render rejects with `WebGpuUnavailableError`. Set
`softwareRender: true` there (and `headed: true` under `xvfb-run` on Linux),
and start from Playwright's own image so Chromium's system libraries are present. A GPU frame
and a SwiftShader frame do not match pixel for pixel, so anything comparing
renders should fix the mode and record which one made a baseline.

**Memory.** Bytes cross the page boundary base64-encoded, because Playwright
cannot round-trip a `Uint8Array`. A video exists in memory more than once
around delivery, so size the container against the longest render, and against
`concurrency` pages for a split export.

## Development

`pnpm --filter @motionscript/headless build`, `test` and `typecheck`. `src/page/`
is browser code: the Node build skips it, `tsconfig.page.json` type-checks it
with the DOM lib, and esbuild compiles it into the page at start, so the package
ships `src/page` and `src/page-bridge.ts` as source. Some tests launch Chromium.
[`apps/engine`](https://github.com/motionscript-dev/motionscript/tree/main/apps/engine) is an HTTP render server on top of it.

## License

Apache-2.0
