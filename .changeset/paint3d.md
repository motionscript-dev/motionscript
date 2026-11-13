---
"@motionscript/core": patch
"@motionscript/sdk": patch
---

**`Paint3D`**: a custom 3D node paints with the same `fill` and `stroke` entries a 2D shape takes. Spread `...Paint3D.state` and `...Paint3D.commands` (`fillTo`, `strokeTo`), then draw the surface with `Paint3D.material(fill)` (one solid colour stays a tweenable `color` and `opacity`; a gradient or image becomes a texture; `{ type: "standard" }` lights it) and the lines with `Paint3D.lines(g3, stroke, segments, { through, lift })`, one instanced batch of bars per stroke layer. Stroke `weight`, `dash` and `dashOffset` are thousandths of a scene unit; a `square` cap closes outline corners; `through: true` draws hidden lines through solids. Built-in meshes keep `Material.state`.
