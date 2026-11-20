---
"@motionscript/core": patch
"@motionscript/renderer": patch
---

The WebGPU renderer draws extrusions. Core's new `evaluateExtrude` turns an `extrude` geometry into vertex buffers the way three's `ExtrudeGeometry` shapes it: the outline in the XY plane, a contour inside another a hole, curves flattened into `segments` steps, walls creased at sharp corners and smooth round curves, and an optional bevel rounding both rims. The renderer writes that buffer and sends it once while it stays the same. An extrusion also has bounds now, so an editor can box it.
