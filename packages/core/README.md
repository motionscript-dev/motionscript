# @motionscript/core

The engine-agnostic animation library at the heart of [Motion Script](https://motionscript.dev).
It defines what a scene is — a JSON document of nodes and commands — and how a
project of them evolves over time: the scene graph, props and tweens, flow
layout and the runtime that plays it, independent of any rendering backend and
with zero dependencies.

```ts
import type { CompositionDocument } from '@motionscript/core';

// A scene is data: a tree of nodes, then commands placed at times.
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

A host plays it with `engine.open({ document: doc })`. A frame is a pure
function of its time, so a seek costs the same in either direction.

## What's in here

- **Documents**: `StillDocument`, `CompositionDocument` and `AudioDocument`, the
  `ProjectDocument` that lays them on tracks, the validator, the expression
  language, and the per-engine `Registry` that turns a node key into a class.
- **Runtime**: `Engine` and `Session`, which open a document on a platform and
  play, seek and export it.
- **Nodes**: the scene graph (`Rect`, `Ellipse`, `Text`, `RichText`, `Video`,
  paths, 3D, audio, and more) with attributes for fills, gradients, filters, and
  WGSL shader effects. A custom node is a component registered with the engine,
  and any document it opens can name it.
- **Tweens**: interpolation and easing for animating attributes over time.
- **Layout**: `flowOps`, the flow layout every 2D node runs on its children:
  freeform, runs (wrapped or not) and grid.
- **Project / render / platform / assets**: the abstractions a renderer and a
  platform implement to turn a scene graph into pixels, audio, and exported
  video: `RenderContext2D`/`RenderContext3D` (implemented by the WebGPU renderer
  [`@motionscript/renderer`](https://github.com/motionscript-dev/motionscript/tree/main/packages/renderer)) and the `platform` seams (filled
  in by [`@motionscript/browser`](https://github.com/motionscript-dev/motionscript/tree/main/packages/browser)).

This package has no rendering backend of its own. Pair it with
[`@motionscript/browser`](https://github.com/motionscript-dev/motionscript/tree/main/packages/browser) (WebGPU) or build your own backend
against the `platform`/`render` abstractions.

## Docs

Contributor documentation for this package lives in [`docs/`](https://github.com/motionscript-dev/motionscript/tree/main/packages/core/docs):

- [Module tour](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/overview.md): what each directory of `src` holds, what may
  import what, validation, and what each barrel exports.
- [Registry](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/registry.md): the per-engine vocabulary and the built-in keys.
- [Variables and expressions](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/expressions.md): the expression grammar,
  its closed function library, node references and cycles.
- [Timeline](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/timeline.md): compile, seek, presence, incremental patching
  and the time conventions.
- [Commands, tweens and easing](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/commands.md): command shapes, `args`,
  easing, loops and command traits.
- Also: [scene graph](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/scene-graph.md), [attributes](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/attributes.md),
  [layout and text](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/layout-and-text.md), [assets](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/assets.md) and the
  [project document](https://github.com/motionscript-dev/motionscript/blob/main/packages/core/docs/project-document.md).

## Usage

```bash
npm install @motionscript/core
```

See the [docs](https://motionscript.dev/docs) for the full feature set and API
reference.

## Development

From the monorepo root:

```bash
pnpm --filter @motionscript/core build       # eslint, then tsc, then the browser bundle
pnpm --filter @motionscript/core test        # vitest
pnpm --filter @motionscript/core lint
pnpm --filter @motionscript/core typecheck
```

