# @motionscript/renderer

## 0.1.0

### Patch Changes

- d2241c3: Drawing is faster with the same output: rects and ellipses build their outlines without going through an SVG path string, arcs convert without allocating, and a colour string already parsed is not parsed again (until the theme changes). On a scene of 10,000 ellipses a frame the renderer's per-frame work drops by about 15%.
- 2026625: Plain rects and ellipses (a solid fill without a shadow, or a solid, undashed stroke round a rect or a circle) now draw as the renderer's own shapes instead of as paths: a scene of many small moving shapes renders over twice as fast. Their antialiased edges come out marginally different (a few levels on edge pixels, nothing visible at normal size); interiors and axis-aligned edges are unchanged.

## 0.1.0-alpha.10

### Patch Changes

- d2241c3: Drawing is faster with the same output: rects and ellipses build their outlines without going through an SVG path string, arcs convert without allocating, and a colour string already parsed is not parsed again (until the theme changes). On a scene of 10,000 ellipses a frame the renderer's per-frame work drops by about 15%.
- 2026625: Plain rects and ellipses (a solid fill without a shadow, or a solid, undashed stroke round a rect or a circle) now draw as the renderer's own shapes instead of as paths: a scene of many small moving shapes renders over twice as fast. Their antialiased edges come out marginally different (a few levels on edge pixels, nothing visible at normal size); interiors and axis-aligned edges are unchanged.

## 0.1.0-alpha.9

## 0.1.0-alpha.8
