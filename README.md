<div align="center">

<img src=".github/banner.png" alt="Motionscript" width="400" />


An open-source motion design tool, inspired by tools like Manim and Motion Canvas, that helps
developers and educators create animations from the browser. 

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@motionscript/sdk.svg)](https://www.npmjs.com/package/@motionscript/sdk)

[Documentation](https://motionscript.dev/docs) ·
[API Reference](https://motionscript.dev/api) ·
[Contributing](CONTRIBUTING.md)

</div>

## What is Motion Script?

Motion Script renders animations through a WebGPU renderer (Rust/wgpu compiled
to WebAssembly), in a browser or from Node. A scene is data: a JSON document of nodes, plus commands
placed at times that animate them. Node types are the code half: a component
registered with the engine under a key, which any document can then name.

```ts
import type { CompositionDocument } from '@motionscript/sdk';

const doc: CompositionDocument = {
  kind: 'composition',
  nodes: [
    { id: 'card', type: 'rect', parentId: null, layerOrder: 0,
      props: { width: 400, height: 400, fill: 'white', cornerRadius: 20 } },
    { id: 'lens', type: 'ellipse', parentId: 'card', layerOrder: 0,
      props: { width: 350, height: 350, fill: 'black' } },
  ],
  commands: [
    // Slide the lens 300px over 3 seconds.
    { id: 'slide', type: 'to', targetId: 'lens', at: 0, duration: 3, args: { x: 300 } },
  ],
};
```

A frame is a pure function of its time, so a seek costs the same in either
direction. Flow layout, fills, gradients, filters, custom shader fills and effects, paths,
text, audio and 3D are all supported. See the
[docs](https://motionscript.dev/docs) for the full feature set.

## Getting started

Install the library with the browser backend. Until 0.1.0 every release is a
prerelease on the `alpha` dist-tag, so install that tag to get every package
from the same release:

```bash
npm install @motionscript/sdk@alpha @motionscript/browser@alpha
```

Then open a document on an engine (a browser with WebGPU is required;
`createBrowserEngine` rejects with `WebGpuUnavailableError` without it):

```ts
import { createBrowserEngine } from '@motionscript/browser';

const engine = await createBrowserEngine();
const session = engine.open({ document: doc, target: canvas });
session.playback!.play();
```

For a full walkthrough, see the [Getting Started guide](https://motionscript.dev/docs/getting-started).

## Documentation

- **Guides & tutorials:** [motionscript.dev/docs](https://motionscript.dev/docs)
- **API reference:** [motionscript.dev/api](https://motionscript.dev/api)

## Packages

This is a pnpm + Turborepo monorepo. The published pieces:

| Package | Description |
| --- | --- |
| [`@motionscript/sdk`](packages/sdk) | **The flagship package.** The authoring surface of core behind one import. The recommended way to depend on Motion Script. |
| [`@motionscript/core`](packages/core) | The engine-agnostic animation library: documents, nodes, props, tweens, layout, and the JSX runtime. |
| [`@motionscript/renderer`](packages/renderer) | The WebGPU renderer (Rust/wgpu, WebAssembly): 2D and 3D, WGSL shaders. |
| [`@motionscript/browser`](packages/browser) | The browser platform: `createBrowserEngine`, the video exporter, stills, and audio playback, drawn by the renderer. |
| [`@motionscript/react`](packages/react) | React bindings: a hook that owns a session and a component that draws it. |
| [`@motionscript/headless`](packages/headless) | Renders projects to stills and video from Node, through the browser engine in a headless Chromium page. |
| [`packages/components/*`](packages/components) | Component kits: `audio`, `charts`, `code`, `geography`, `grids`, `math` and `patterns`. |

Plus internal workspaces: [`e2e`](packages/e2e) (visual regression tests), and the example apps under
[`apps/`](apps).

## Developing the monorepo

Prerequisites: Node.js (LTS) and [pnpm](https://pnpm.io/).

```bash
git clone https://github.com/motionscript-dev/motionscript.git
cd motionscript
pnpm install
pnpm build   # build all packages (turbo)
pnpm test    # run the test suites
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture overview and the
package-by-package development workflow.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
architecture, and the [Code of Conduct](CODE_OF_CONDUCT.md) for community
expectations.

## License

Motion Script is licensed under the [Apache License 2.0](LICENSE). Third-party
code it includes is listed in [NOTICE](NOTICE).
