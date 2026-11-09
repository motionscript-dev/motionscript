---
"@motionscript/core": minor
---

The class versions of the built-in node types are gone. Every built-in has been a component for a while; core kept the old classes only to compare against. Removed from `@motionscript/core`: `PaintNode`, `ShapeNode`, `BoundsShape`, `TextBase`, `applyTextDefaults`, and the transitional `RectBase`, `EllipseBase`, `PathBase`, `PathShapeBase`, `PolygonBase`, `PolygramBase`, `VideoBase`, `Mesh3DBase` and `Canvas3DBase`. Build on the components (`Rect`, `Text`, `Mesh3D`, `Canvas3D`, ...) and the modules (`Paint`, `Flow`, `Shapes`, `Typeface`, `TextLayout`, `Material`, `View3D`) instead. `Canvas2D` and the `Node`, `Node2D`, `Node3D` and `NodeAudio` bases stay.

No `@motionscript/sdk` export is removed: the props types (`RectProps`, `TextProps`, `Mesh3DProps`, ...) are unchanged and now live beside their components. `ModelView3D` is a component rather than a `Model3D` subclass, so `instanceof Model3D` no longer holds for it. `TextSelection` now takes any `TextSelectionHost` rather than the removed `Text` class.
