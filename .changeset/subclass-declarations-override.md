---
"@motionscript/core": patch
"@motionscript/sdk": patch
"@motionscript/geography": patch
---

A subclass that redeclares a `@property` or a `@command()` its base already declares now overrides it. `getPropertyMeta` and `getCommandMeta` kept the base's declaration and dropped the subclass's, so a redeclared default, mapper, tween or editor option, or a command's `args` and `name`, never took effect. The most-derived declaration of each key now wins, whole, in the position the base gave it, and an inherited key the subclass does not redeclare is kept as declared. `Registry.describe`, a node type's command table and a new instance's values all read that one declaration.

A bare `Globe` now starts at its own camera and key light (orbit −10, elevation 25, zoom 2.8, ambient 0.55, key 1.9) rather than `Canvas3D`'s (35, 20, 12, 0.45, 2.4), which framed it as a small disc twelve radii away. `describe("graph3d")` no longer reports `Canvas3D`'s defaults for `orbit`, `elevation` and `zoom`, which a graph derives from `camera.initialPosition`.
