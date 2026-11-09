---
"@motionscript/geography": patch
---

A `Globe` fades its markers, holds its camera and map to the ranges it advertises, and refuses 3D children. `GeoBorder` documents that `start` and `end` trim the fill too.

- A marker's `opacity` was parsed and clamped and then only tested against 0; a marker at 0.5 drew fully opaque. It now reaches the material: instance colours carry no alpha, so markers are drawn together per distinct opacity, and a list of opaque markers is still one draw.
- `zoom` below 1.02 drew as 1.02, so an `orbitTo` to the advertised minimum of 0.2 appeared to stall. `zoom` is now stored at 1.02 or more and `orbitTo` advertises 1.02. `elevation` is stored within ±89, and `resolution` is advertised as 256 to 2048 and a larger value bakes a 2048-wide map instead of allocating a 16384-wide one.
- A 3D node parented to a `Globe`, which was validated and never drawn, is now refused. The inherited viewport settings (`showGrid`, `shadows`, `tone`, `exposure`, `post`) stay listed and stay inert, and the kit README says so.
- The kit README states that the `markers` and `arcs` lists are JSON text and snap rather than tween, and that `GeoBorder`'s `start` and `end` trim the fill and overlay as well as the outline.
