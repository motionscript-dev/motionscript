---
"@motionscript/math": minor
"@motionscript/core": minor
"@motionscript/sdk": minor
---

`@motionscript/math` gains coordinate systems, plots and the marks that go on a graph.

- `numberLine`, `axes2d` and `numberPlane` are coordinate systems: a child's `x`/`y` are graph units whatever the child is, so a text or an image sits on a graph at its own size, `moveTo` moves it in graph units, and `rangeTo` pans and zooms everything inside.
- `functionPlot` draws an equation and reads its kind from how it is written: `sin(x)`, `x = y^2`, `r = 1 + cos(theta)`, `(cos(t), sin(t))`. `morphTo` bends one curve into another, and curves break at asymptotes and domain edges. A name the equation does not know is a named value: 1 until `params` gives it one, bindable to a variable by a formula, listed by `equationParams`.
- `pointsPlot`, `plotPoint`, `vectorArrow`, `curveArea`, `riemannSum`, `tangentLine` and `dropLines` are drawn in graph coordinates. The ones that ride a plot name it by id in `on`.
- `@motionscript/math/kit` exports `CoordinateSystem`, `Mark`, the coordinate map, the equation language and the sampler for a custom system or mark.
- The SDK exports the `Extents` type that `pathOps.bounds` already returned.
