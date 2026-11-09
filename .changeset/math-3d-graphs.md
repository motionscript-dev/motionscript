---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/math": minor
---

3D graphs, and named commands for 3D scenes.

- `@motionscript/math` gains `axes3d` (a 3D graph that is its own viewport, a `canvas3d` with its camera, lights and `orbitTo`, so it goes straight on a 2D stage: three axes through a box of graph coordinates, z up, with ticks, tips, numbers and titles), `surfacePlot3d` (a height over x and y, or three parts in u and v; coloured by height with `colorScale`, ruled with `meshLines`), `curvePlot3d` (a space curve, drawn on with `progressTo`), `plotPoint3d` (rides a surface it is put inside) and `vectorArrow3d`. Anything inside the axes sits at graph coordinates and keeps its own size.
- Every 3D node has `moveTo`, `rotateTo` and `scaleTo`. A `canvas3d` has `orbitTo` for its default camera, and a `camera3d` has `orbitTo` and `lookTo`.
- A 3D parent can place its children in coordinates of its own (`Node3D._spaceOf`, `ChildSpace3D`), as a 2D one already could, and so can a `canvas3d` for the 3D nodes directly inside it (`Canvas3D._spaceOf`).
- The SDK exports `MaterialShorthand3D`, what a mesh node of your own returns from `materialShorthand()`.
