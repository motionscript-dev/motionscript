# @motionscript/sdk

**Motion Script** is a TypeScript framework for making videos with code.
Describe animations as documents of nodes and commands, then preview
them live in the browser and export straight to MP4 — no timeline UI, no
keyframe panel, just a codebase you can version, review, and generate.

`@motionscript/sdk` is the flagship package: the authoring surface of
[`@motionscript/core`](https://github.com/motionscript-dev/motionscript/tree/main/packages/core) (the document model, scene graph, layout,
and the factories a node type is written with) behind a single import.

## Getting started

Install it with a rendering backend such as
[`@motionscript/browser`](https://github.com/motionscript-dev/motionscript/tree/main/packages/browser):

```bash
npm install @motionscript/sdk @motionscript/core @motionscript/browser
```

`@motionscript/core` is a peer dependency rather than a bundled one: the
backend and every component kit share the one copy your project installs,
because two copies of the engine in one module graph break class identity
(a component generates a class, and identity is per copy).

## Quick example

```ts
import { createBrowserEngine } from '@motionscript/browser';
import type { CompositionDocument } from '@motionscript/sdk';

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

const engine = await createBrowserEngine();
const session = engine.open({ document: doc, target: document.querySelector('canvas')! });
session.playback!.play();
```

A scene is data: nodes, and commands placed at times, so any frame can be asked
for directly and a seek costs the same in either direction. Custom drawing, and
anything JSON cannot express, belongs in a component registered with the engine
and named by key (see [Writing a node type](#writing-a-node-type)). Flow layout,
fills, gradients, filters, WGSL shader effects, paths, text, audio and 3D are
all supported. See the
[docs](https://motionscript.dev/docs) for the full feature set.

## What's in here

- **Documents & projects**: the `ProjectDocument`, `StillDocument`,
  `CompositionDocument` and `AudioDocument` types, `asProjectDocument`,
  `validateDocument`, `migrateDocument` (and `DOCUMENT_FORMAT_VERSION`,
  `DocumentTooNewError`, `migrateNodeProps`) for documents saved by older
  releases, and the `Registry` a document compiles against.
- **Nodes**: geometry (`Rect`, `Ellipse`, `Path`, `Polygon`,
  `Polygram`, `MaskGroup`, `BooleanGroup`), text (`Text`,
  `RichText`, `NumberNode`), structure (`Canvas2D`, `Canvas3D`, `Camera`), and
  media (`Video`; images are a fill, `Fills.image`). Layout is the `flow` prop,
  through `flowOps`. Each is a component: call it to build one
  (`Rect({ fill: 'red', children: [...] })`).
- **Components**: the factories `component2d`, `component3d` and
  `componentAudio`, the `Types` a component's state is declared with,
  `commandsFor`, `provides`, and the modules a component spreads in and calls:
  `Paint`, `Flow`, `Shapes`, `Aim`, `Typeface`, `TextLayout`, `Material`,
  `View3D`.
- **Animation**: commands (`to`, `set`, `variableTo`/`variableSet` and a node
  type's own), each placed at a time, easing (`linear`, `easeIn`,
  `easeOut`, `easeInOut`), and interpolation (`lerpNumber`).
- **Styling & effects**: `Fills`, `Effects`, `Adjustments`, `VideoAdjustments`,
  `AudioEffects`, plus the `Stroke`/`Shadow`/`Corners` attribute types.
  `ImageFilters` and `VideoFilters` remain as `@deprecated` aliases until the
  next major.
- **Audio**: the `SoundNode` and `AudioBus` nodes, and `ramp`/`hold` for
  JSON automation of their levels, speed and effects.
- **Utilities**: `createRef`, `clamp`, `generateList`, `createContext`,
  `Random`.
- **Component machinery**: `@motionscript/sdk/component`, what a component
  package needs beyond the barrel: number formatting, text defaults, the named
  shape outlines and the orbit-camera lerps. It is a subpath because a scene
  author never needs it.

Component kits such as [`@motionscript/code`](https://github.com/motionscript-dev/motionscript/tree/main/packages/components/code) and
[`@motionscript/math`](https://github.com/motionscript-dev/motionscript/tree/main/packages/components/math) are not bundled here. They are
built on this package and take it as a peer dependency. Install one as a
dependency; each kit's `registry.json` names the files a copy of one of its
components takes. The rules a kit follows are
in [`packages/components/CLAUDE.md`](https://github.com/motionscript-dev/motionscript/blob/main/packages/components/CLAUDE.md).

## What is deliberately not here

`Engine`, `Session`, `PlaybackController`, `ClipStore`, `StateEvaluator`,
`AssetManager`, the platform seams (`Ticker`, `StorageAdapter`) and the render
backends (`CanvasRenderContext2D`, `NullRenderContext`) are what a host builds;
import them from `@motionscript/core`. Members prefixed `_` are outside the API.

## How the surface is defined

The package names no symbol. `.` is `export * from '@motionscript/core/sdk'` and
`./component` is `export * from '@motionscript/core/component'`. The curated
lists live in core, in `src/sdk/index.ts` (named exports, no wildcards) and
`src/component.ts` (eight `export *` lines), so there is one list rather than two
that drift. A name an author would reasonably reach for is added to core's
`src/sdk/index.ts`; rebuilding core adds it here with no edit in this package.
One that only a host or a test needs stays in core. `FillChain` is a class in
core but exported as a type here: named, never constructed.

The types and values resolve through core's built `dist/`, so nothing imports
until core has been built. `src/tests/sdk-parity.test.ts` in core compares this
barrel's value names with core's `sdk/index.ts`; it fails when core's `dist/` is
stale or absent.

## Writing a node type

A node type is one object handed to a factory. `key` is its document key;
`state` its entries, plain values or `Types` builders, plus whatever modules it
spreads in; `commands` what it does on the timeline; `render` what it draws:

```ts
import { component2d, Graphics2D, Paint, Types } from '@motionscript/sdk';
import { createBrowserEngine } from '@motionscript/browser';

export const Gauge = component2d({
  key: 'gauge',
  state: { ...Paint.state, value: Types.number(0, { min: 0, max: 1 }) },
  commands: { ...Paint.commands, fillUp: { args: ['value'] } },
  render: (ctx, state) => Paint.draw(ctx, state, new Graphics2D().ellipse({
    width: ctx.size.width, height: ctx.size.height, ratio: 0.75, startAngle: -90, sweep: 360 * state.value,
  })),
});

const engine = await createBrowserEngine({ nodes: [Gauge] });
```

The factory generates the node class, declares its key and writes its entries
and commands where the registry reads them, so a document can name `gauge`
once it is handed to an engine. Calling `Gauge({ value: 0.4 })` builds one in
code, typed by its entries. No decorators and no JSX are needed: a component
compiles with plain TypeScript. The guide is the
[custom node docs](https://motionscript.dev/docs/custom-node/introduction).

## Loading from a CDN

`dist/browser/` holds one ES module per export. Core is a peer, so the modules
leave `@motionscript/core/sdk` and `/component` as imports, and `dist/browser/manifest.json` maps each
export to its file and lists core under `peers`. An import map names
`@motionscript/sdk` (and its subpaths) and `@motionscript/core` (and its
subpaths) once, and every kit loaded beside them shares both.

This package has no rendering backend of its own. Pair it with
[`@motionscript/browser`](https://github.com/motionscript-dev/motionscript/tree/main/packages/browser) (WebGPU), and use
[`@motionscript/react`](https://github.com/motionscript-dev/motionscript/tree/main/packages/react) to mount a player in a React app. See the
[docs](https://motionscript.dev/docs) for the full API reference.

## Development

From the monorepo root:

```bash
pnpm --filter @motionscript/sdk build
pnpm --filter @motionscript/sdk test
```

It has no tests of its own (`passWithNoTests`); core's parity test guards it.
