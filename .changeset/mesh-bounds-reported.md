---
"@motionscript/core": patch
---

`projectNode3D` also reports `bounds`: what the node and its children draw, as a box in the node's own frame. Projected through `localPoints`, it is a selection box that turns and scales with the mesh, where the screen box `getNodeBox` reports is only the upright rectangle around it.
