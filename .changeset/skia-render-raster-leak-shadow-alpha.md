---
---

A 3D fill rebuilt every frame no longer leaks, a shadow fill's `opacity` applies once, and a text stroke's `align` slides.

- A fill that holds a class instance (`fill={() => scene(t)}`) mints a new identity every frame, and the static-raster cache and the GPU texture cache kept an entry for each until the context was disposed: a 1 MiB buffer and a texture per frame. Both now free the entries neither the current nor the previous frame asked for. A hoisted scene keeps its identity and is still rasterized once.
- A shadow whose fill was `{ type: 'solid', color: 'black', opacity: 0.4 }` painted at 0.16, because the layer applied the opacity and the solid colour applied it again; `'black/40'` painted at 0.4. Outer and inner shadows now apply it once, so the two spellings agree. Shadows written as a colour string or a gradient look the same as before, and one given an `opacity` on its fill object is now as strong as that value says.
- A text stroke with an `align` strictly between -1 and 1 snapped to the outside (above 0) or the inside (below 0), so a tween of `align` jumped at its first step. The stroke is now `weight` wide at every `align` and slides across the glyph edge as a shape's does. -1, 0 and 1 are unchanged.
