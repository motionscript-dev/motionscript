---
"@motionscript/sdk": minor
"@motionscript/core": minor
---

The SDK carries what a component is written against, so a kit no longer reaches into `@motionscript/core`. New in `@motionscript/sdk` (and `@motionscript/core/sdk`, which it passes through):

- `PathShape` and `PathShapeProps`, the document's `"path"` node, whose `data` is in its own box's unit space.
- `pathOps`, with the `PathSampler`, `PathAnchor`, `PathSubpath` and `VectorPath` types it takes and returns.
- `textOps`.
- `toPathString`, plus the `PathBounds` and `GraphicsOp` types.
- `InsetsProps`, what a `padding`-style prop accepts, and `SizeConstraints`, what an overriding `measure()` is handed.
- `SpaceCamera`, what `_spaceCamera()` returns to open a 2.5D space.
- `BufferGeometry3D`.

`@motionscript/sdk/component` is a new subpath over `@motionscript/core/component`: seekable entrances (`at`, `sequence`, `together`, `hold`, `compose`, `drive`), `declarePaints`, number formatting and the orbit-camera lerps. It is a subpath because a scene author never needs it, and because its `hold` (a seekable pause) is not the barrel's `hold` (an audio curve).

Host machinery stays in core: the asset catalog and declaration pass, render and measure contexts, `ClipTimeline`, `Engine` and `Session`.
