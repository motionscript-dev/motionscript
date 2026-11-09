---
"@motionscript/core": patch
"@motionscript/math": patch
"@motionscript/charts": patch
---

Editing and scrubbing heavy scenes does less work.

- A 3D component's `render` context has `declaring`, true on the pass that only finds what it loads. `surfacePlot3d` and `curvePlot3d` draw their paint on a stand-in then, so declaring a surface no longer samples its equation and mesh lines, and a `morphTo` no longer re-declares it every frame.
- An edit that changes only a row's placement (`x`, `y`, `rotation`, `scale`, `opacity`; the 3D axes, rotations and scales) writes the new values onto the live node instead of building a new one, on any node type, and sets no layout change: placement is applied after layout. A node animated by a command whose effect core cannot see (a kit's own command) is still rebuilt.
- `Graphics3D.line({ points })` hands back the same buffer and a `revision` while the points hold, and the renderer now honours a buffer's `revision` as documented, so an unchanged line is uploaded once rather than every frame.
- `axes3d`'s tick and title cards are rasterized once per text rather than every frame.
- `lineChart` and `barChart` work their scales out once per data and axes rather than once per bound prop, and `resolveXScale` keeps its result per data array.
