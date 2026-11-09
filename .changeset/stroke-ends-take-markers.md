---
"@motionscript/core": minor
"@motionscript/sdk": minor
---

A stroke's `startCap` and `endCap` take a marker as well as a cap: `arrow`, `triangle`, `stealth`, `dot`, `box`, `diamond` or `bar`. Any open path, arc or custom shape can be an arrow.

- A pointed head has its tip on the path's end and turns with the path. A marker is `capScale × weight` long (`capScale` is new, default `4`, and tweens) and shrinks to fit a contour shorter than it, so a head rides `start`/`end` as a path is drawn on.
- A marker is drawn even where a dash pattern leaves the end bare, and a marked stroke is centred on its path whatever its `align`.
- `StrokeMarker` and `StrokeEnd` are exported; `cap` still takes the three caps only.
