---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/math": minor
---

Planes that transform, fields, polar planes, implicit curves and trails.

- `numberPlane` gains `matrix` and `transformTo` (a linear map of the whole plane), `warp` and `warpTo` (a bend by a function of its points), and a faint `ghost` of itself while it is transformed. The grid, the axes and everything on the plane go with it.
- New nodes: `polarPlane` (rings and spokes; plots and marks go on it as on axes), `vectorField` (arrows of a field `(P, Q)`, coloured by strength with `colorScale`), `streamLines` (the lines the field carries a point along, sent flowing with `flowTo`) and `tracedPath` (the trail a point leaves as a value changes).
- A `functionPlot` draws an implicit equation, such as `x^2 + y^2 = 4`, where it holds.
- A `Camera` can `follow` a node of its world by id, with `lookAt` as an offset from it.
