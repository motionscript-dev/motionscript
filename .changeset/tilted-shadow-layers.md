---
"@motionscript/renderer": patch
---

A shape with a drop shadow, tipped in perspective until part of it nears the eye, no longer fails the frame with "Invalid CommandBuffer". The shadow's blur was measured at the shape's largest magnification (up to 1000×), which grew its layer past the GPU's texture limit. A tilted shape's drop shadow, and a tilted group's `dropShadow` filter, now take their blur and offset from where the shape is seen. No blur, filter or effect layer reaches further past the visible area than a texture can hold.
