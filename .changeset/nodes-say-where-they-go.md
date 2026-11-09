---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/math": minor
---

A node type can say where it goes, so a host can offer it only where it works.

- `@node({ within, beside, closed })`: `within` names the types a node goes inside (a name covers every type built on it), `beside` the types it needs at least one of as a sibling, and `closed` marks a parent that takes only children that name it. Nothing checks them at build.
- `parentIssue`, `siblingIssue` and `placementIssues` answer them for a host, together with the 2D/3D seam and `acceptsChildren`; `nodeTypeIsA` walks `parentKey`.
- In `@motionscript/math` a `functionPlot` holds the marks that are of it: a `tangentLine`, and a `plotPoint` or `dropLines` put inside it follow its curve with no `on`. `curveArea` and `riemannSum` sit beside the plots they read and name them in `on`. Plots, arrows and marks go inside a coordinate system.
