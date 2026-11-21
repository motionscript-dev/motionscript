---
"@motionscript/core": patch
---

Add `repeater`, a built-in node that draws its children again and again like After Effects' Repeater: `copies` (fractional fades the last copy in), `offset`, `composite` (`below` puts the first copy on top, or `above`), and a per-copy step of `stepPosition`, `stepRotation` and `stepScale` about `stepAnchor`, with opacity ramped from `startOpacity` to `endOpacity`. Components get `ctx.repeat(copies)` to draw their children once per transform.
