---
"@motionscript/core": patch
---

Register the named shapes: `triangle`, `rightTriangle`, `pentagon`, `hexagon`, `octagon` and `star` were exported but missing from the built-in registry, so a document naming one built an empty placeholder. A test now holds every SDK-exported component to being registered.
