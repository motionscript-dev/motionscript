---
"@motionscript/core": patch
---

Fixes in the 2D and 3D handlers: strokes, paths, text on a path, lights, textures, geometry and model overrides.

- A stroke group holding two or more open lines or paths drew each one closed by a chord, because the group was unioned as if it were closed regions. Open outlines are now stroked as built.
- A fractional stroke `align` (anything between -1 and 1 other than 0) narrowed the stroke and put all of it on one side, so a tween from `center` to `inside` jumped at its first step. The stroke is now `weight` wide at every `align` and slides across the edge continuously, solid and dashed. Text strokes still resolve to the three alignments by sign.
- A path given as an SVG string with a `centerBounds` frame that is not symmetric about 0 was displaced, because the frame was mirrored into the canvas but the string was not. The frame now follows the data.
- Text laid out along a path kept the glyphs of the fallback face it was first shaped with after its real font loaded. The shaped run is now keyed by the font epoch.
- A directional or spot light's `target` is a world-space point again. It was applied as an offset from the light, so a light at (4, 6, 3) aimed at the origin had no direction. Scenes that set `target` on a light away from the origin will shade differently.
- Two `Tex.data` textures of the same size and options resolved to one texture, the second showing the first one's pixels. A data texture is now told apart by its array, which should be kept between frames and `revision`-bumped to update.
- `Torus3D` and `TorusGeometry3D` honour `startAngle` on a partial `sweep`.
- A default `capsule`'s bounds were twice the size of the mesh built for it. `geometryBounds3D` now uses the renderer's default radius of 0.5.
- A model's material override matched by mesh name was rebuilt and reassigned every frame and the old material never disposed. It is built once and written in place.
- A luminance mask's colour filter and the shaders built by noise, stripe, unset-media and 3D-scene fills were never released.
- `opacity` and `blend` on an individual shape have never been drawn. They are now marked `@deprecated` on `ShapeState`, and the renderer warns once per prop; use `Graphics2D.opacity()` or the node's own.
