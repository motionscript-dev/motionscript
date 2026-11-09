---
"@motionscript/core": patch
---

A mesh node's `shadow` reaches its mesh, and the 3D inputs that do nothing say so.

- A `Box3D`, `Plane3D` or any other mesh node never cast or received a shadow: its `shadow` was written to the group of its scope, which three never reads, and the mesh kept three's own default. The viewport's `shadows`, a light's `shadow` and the default node `shadow` together produced no shadow, while the same scene built from `Graphics3D` ops with `shadow: true` did. `Scene3D.draw` now gives a drawable that states no `shadow` the one of the node scope it is drawn in (a `shadow` on the op itself wins, and it does not cascade to child nodes), so `shadow={false}`, `'cast'` and `'receive'` on a node are honoured, a custom node's `renderSelf` included, and `applyTransform` with no transform applies the documented default (casts and receives). Scenes of mesh nodes with shadows turned on now show them.
- `Points3D` read only `material`, so `fill`, `opacity` and the rest of the shorthand were accepted and ignored. It now builds a `points` material from `fill` (a colour, or a texture as the dot's `map`), `opacity`, `alphaMap`, `blend` and `vertexColors`; an explicit `material` still wins.
- Five inputs the types accept are recorded and acted on by no renderer: the `post` chain, an environment's HDR, EXR or cubemap `src` and `faces`, `params` on a geometry or an environment, a shader material's `extends` and OBJ models. Nothing is removed. Each now logs one warning per session in development, and its doc comment says it is inert. A model file that fails to load is reported once per file. The `LineBasicMaterial3D` comment that promised a mesh-backed thick line now says nothing substitutes one.
