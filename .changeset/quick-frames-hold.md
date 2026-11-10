---
"@motionscript/core": patch
---

Frames evaluate, lay out and render several times faster on animated scenes (about 4x on a scene of 2,100 laid-out rects), with the same output. Finished built-in commands (`to`, `set`, `moveTo`, `fadeTo`, `rotateTo`, `scaleTo`, `layoutTo`, the paint commands, `variableTo` and the rest) are held at their end values instead of run every frame, as component commands already were. A prop's accessor now lives on its node type's prototype instead of on each node: `Object.keys(node)` and a spread of a node no longer list its props (a child's `state` still does). A value written from outside the timeline onto a slot of an animated node that no command writes now survives a seek, as it already did for nodes animated by component commands.
