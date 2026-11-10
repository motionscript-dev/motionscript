---
"@motionscript/renderer": patch
---

Plain rects and ellipses (a solid fill without a shadow, or a solid, undashed stroke round a rect or a circle) now draw as the renderer's own shapes instead of as paths: a scene of many small moving shapes renders over twice as fast. Their antialiased edges come out marginally different (a few levels on edge pixels, nothing visible at normal size); interiors and axis-aligned edges are unchanged.
