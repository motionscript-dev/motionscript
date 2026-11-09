---
"@motionscript/math": minor
---

A formula's parts can be named, and marks can be drawn on them.

- Every piece of a `latex` formula's source is a part: `partColors` colours one by its source (`{ part: 'x^2', color: '#facc15' }`), `colorTo` animates that, and `partBounds(part)` says where it is. A morph now carries a term both formulas write as one, with its colour.
- `written` writes a formula on glyph by glyph, each outlined and then filled; `writeTo` animates it.
- `latexMatrix` typesets a matrix from its `entries` in the `brackets` it is given; each entry is a part, and `entriesTo` morphs to new ones.
- `curlyBrace`, `emphasisMark` (box, circle, underline, cross) and `angleMark` annotate. The first two follow a node, or one part of a formula, by id and slide to another with `retargetTo`; a brace with no target spans two points.
- A label written between dollar signs is typeset: on a brace, an angle, a plot point, and an axis.
- `@motionscript/math/kit` exports `FollowMark`, `quadOf` and `findLatexParts` for a custom mark.
