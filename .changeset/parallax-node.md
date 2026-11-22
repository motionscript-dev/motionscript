---
"@motionscript/core": minor
---

Add `parallax`, a built-in node whose children are layers, back to front: each slides against `scroll` (animated with `scrollTo`) by a share ramped from `farSpeed` on the first child to `nearSpeed` on the last, so near layers travel farther. `wrap` (`none`, `horizontal`, `vertical` or `both`) tiles each layer edge to edge by its own extent, so a long scroll loops. Components get `ctx.tile(axis)` to draw each child again across their box, one child's copies before the next.
