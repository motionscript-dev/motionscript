---
"@motionscript/renderer": patch
---

3D depth is reversed Z, and a perspective camera whose `far` is derived gets an infinite far plane, so thin parts a few thousandths apart (a plate on a face, lettering on a token, beams inside a slab) no longer stripe through each other at a distance. A material's `polygonOffset` now applies (it was dropped). The 3D scene stream is version 4.
