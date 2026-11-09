---
"@motionscript/core": minor
"@motionscript/sdk": minor
---

The `Line` node is removed. A `Path` draws what it drew.

- The `line` node type is no longer registered and `Line` and `LineProps` are no longer exported. A document that names `line` fails to build with `Unknown node type`. Write its points as a path instead: `<Line points={[[0, 0], [200, 0]]} />` is `<Path data="M 0 0 L 200 0" />`, and in a document a `path` node whose `data` is in the unit space of its box. A path's `y` runs down where a line's points ran up, and a face-value `Path` is centred on its own extent rather than drawn from the node's origin.
- `shapeOutline` and `hasShapeOutline` no longer answer for `"line"`.
- `Graphics2D.line` and the `line` op are unchanged: a custom node still draws a polyline with them, vertex `radius` and `closed` included.
