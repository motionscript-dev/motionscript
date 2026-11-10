---
"@motionscript/renderer": patch
"@motionscript/core": patch
---

Drawing is faster with the same output: rects and ellipses build their outlines without going through an SVG path string, arcs convert without allocating, and a colour string already parsed is not parsed again (until the theme changes). On a scene of 10,000 ellipses a frame the renderer's per-frame work drops by about 15%.
