---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/math": minor
---

A node type can withdraw what it inherits, and the math nodes take only the paints they draw.

- `@withdraw(...keys)` drops inherited properties and commands from a node class. A withdrawn property is left out of `describe()` and holds its default whatever is written to it; a withdrawn command is left out of `commandKeys()` but still runs for a stored document, changing nothing. A subclass that declares the key again takes it back.
- `Registry.takesCommand(type, key)` says whether a node type takes a command: its own, or a node-less one unless that runs a method the type lacks or withdrew. `addCommand` takes a `method` for that; the paint commands name theirs.
- Math: a plot, a tangent, drop lines, an arrow, a brace, an emphasis mark and an angle mark have no `fill`; a curve area has no `stroke`; a formula, a traced path, a field, a curve area, a Riemann sum, a plot point and a sample space have no outline trim (`start`, `end`, `progressTo`, `flash`). An open `pointsPlot` draws no fill.
- Math: `partColors` and `colorTo` on `latex`, `latexMatrix` and `networkGraph` are now `partFills` and `partFillTo`, each part taking any paint (`{ part, fill }`). A vector field's and stream lines' `colorScale` is now `strengthFills`, and a sample space's `colors` is now `columnFills`, both lists of paints.
- Math: a vector field's and stream lines' shadow is cast when they are painted by strength too, not only in one paint.
