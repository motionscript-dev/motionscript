---
"@motionscript/renderer": patch
---

A 3D scene's surface and image textures stay their own across frames. A frame's image ids are given out in the order they are met, so when a scene's set of textures changed size (a token appearing, a plane entering) the scene's id moved on and its old id became a surface, while the renderer kept the old scene and drew it into that surface: a texture showed a picture of the whole scene, and sampling the target being drawn raised a WebGPU validation error. The renderer now drops a scene whose id becomes something else, and binds every image and surface a scene uses to the current frame's id on every sync.
