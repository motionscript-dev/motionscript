---
"@motionscript/charts": patch
---

A pie ring's wedge outline and shadow can be painted with an image. `PieRing` declared each slice fill and the leader stroke only, so an image in `ring.stroke` or in a `ring.shadow` fill was never loaded and the renderer failed on it. Both are now declared with the rest of the ring's paints.
