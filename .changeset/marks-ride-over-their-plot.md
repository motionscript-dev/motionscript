---
"@motionscript/math": patch
---

A point, tangent or guide inside a `functionPlot` is drawn over the curve. A mark's stroke is its ink, so it is now painted before the mark's children; before, it was painted last, as a shape's outline is, and the curve ran across every dot and line riding it. A `Mark` subclass that strokes its ink its own way overrides the new `renderInk` hook rather than `renderStroke`, and one that paints no fill until its ink has an inside answers `paintsFill`.
