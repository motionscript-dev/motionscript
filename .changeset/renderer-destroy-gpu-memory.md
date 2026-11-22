---
"@motionscript/renderer": patch
---

The renderer no longer fills GPU memory during playback. A 3D map taken from a surface that redraws every frame (a textured globe, for one) is rebuilt into the same texture instead of a new one each frame, and every texture and buffer the renderer replaces or forgets (3D maps, a 3D scene's targets and grown buffers, a removed 3D scene, evicted distance fields, readbacks, a grown clip atlas) is destroyed at once. In the browser, a dropped texture is only freed when its JS object is garbage-collected, so a long play could grow VRAM by gigabytes until the GPU process died and the device was lost ("A valid external Instance reference no longer exists").
