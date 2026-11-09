---
"@motionscript/core": patch
"@motionscript/math": patch
---

Three fixes for components. A component frame (a `Rect`, or any component laid out by `Flow`) answers where a dropped node lands, so `reparentPlacementAt` into one gives a placement instead of `null`. `View3D.load(loader, extend)` takes the `extend` a viewport's render draws with and declares what it draws, so its textures and models load before the frame; math's `axes3d` passes its axes. `ref` is typed on component calls as the node the call builds, accepting a ref of any supertype.
