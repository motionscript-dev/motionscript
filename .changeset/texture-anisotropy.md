---
"@motionscript/renderer": patch
"@motionscript/core": patch
---

- **A 3D texture's `anisotropy` is drawn**: above 1 the sampler filters anisotropically, rounded up to 4x, 8x or 16x (the most WebGPU allows), so a texture seen at a glancing angle stays sharp instead of blurring. It needs linear filters; a `nearest` texture ignores it. It was accepted and never applied before.
