---
"@motionscript/core": patch
---

A draw that throws no longer corrupts the next frame. When a node threw partway down the tree (an image that has not loaded, a custom `renderSelf` that fails), the render context kept the state it was in: the inherited opacity, the open node scopes, the canvas's saves and transforms, any clip, camera, boolean or mask scope, and an inherited text style. A host that reported the error and painted again drew the next frame inside it, displaced by the failed nodes' offsets and faded by their opacity.

- `SkiaRenderContext.execute` still throws the error, and now puts the context back as a fresh one holds it before it returns, so a pass that threw is followed by one that draws as if it never ran.
- `Node2D.render` closes its node scope in a `finally`, so every `begin` is matched by an `end` on the way out of a throw as well.
- A `Graphics2D` that throws during `draw()` unwinds its own group opacity, rotation, scale and effect layers before the error leaves it.
