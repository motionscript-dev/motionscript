# @motionscript/renderer

## 0.1.1-alpha.0

### Patch Changes

- 6b89575: The renderer's prewarm now also builds the drawing pipelines for the canvas format, so their shader compile overlaps a host's start-up instead of delaying its first frame.
- e279864: A 3D scene's surface and image textures stay their own across frames. A frame's image ids are given out in the order they are met, so when a scene's set of textures changed size (a token appearing, a plane entering) the scene's id moved on and its old id became a surface, while the renderer kept the old scene and drew it into that surface: a texture showed a picture of the whole scene, and sampling the target being drawn raised a WebGPU validation error. The renderer now drops a scene whose id becomes something else, and binds every image and surface a scene uses to the current frame's id on every sync.
- e9db554: An asset is downloaded and decoded once while it is loading, however many ask for it: the weights of one font family share its files (each weight used to fetch the whole family), two draws of one image or video share one decode, and every session, still and export on a page shares one request per source (`loadAssetBytes`, which the audio mix now goes through as well). A load that fails is asked for again next time.
- 7cd4e53: A Text with a Write On reveal (`start`/`end` short of the whole string) or styled `runs` drew nothing at all: the renderer ignored the text's pieces while core left their painting to them. Each piece now draws with its own fill and stroke, the unrevealed characters held in place but clear, so a Write On types the text on character by character.
- Updated dependencies [3630b74]
- Updated dependencies [1c43a37]
- Updated dependencies [e279864]
  - @motionscript/core@0.1.1-alpha.0

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
