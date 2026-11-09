---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/react": minor
"@motionscript/grids": patch
---

A node can give its children coordinates of its own, which is what a coordinate system needs: a child's `x`/`y` are then in the parent's units and the child keeps its size.

- A parent answers `_planeOf(child)` with a `ChildPlane` (`toOffset` and `toCoords`, exported). Paint, `global`, the anchor getters, `moveTo({ target })` and `parentPlanePointAt` all read it, and the last two answer in the parent's coordinates. A node whose parent publishes none is unchanged.
- `childPlanePointAt(root, path, point)`, and `childPlanePoint` on the player, say where a point lands in the coordinates a node positions its children in, for a host placing a node that is not there yet. They answer `null` for a node whose children are in pixels, and `_planeOf(null)` is what they ask.
- `findNode2D(from, id)` and `frameIn(host, node)` are exported from the SDK, for a node that follows another by id. `@motionscript/grids` now uses them and still exports both names.
