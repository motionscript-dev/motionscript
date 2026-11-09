---
---

A `buffer` or `parametric` 3D geometry with `computeNormals` and no authored normals is no longer rebuilt on every frame. The normals it derived were counted as an attribute that had disappeared, so each frame disposed the geometry and allocated a new one. They are now recomputed in place from the moved positions, with the same buffers re-uploaded, and a geometry whose normals are authored, or whose `computeNormals` is switched off, still rebuilds.
