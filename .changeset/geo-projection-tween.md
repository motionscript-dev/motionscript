---
"@motionscript/geography": patch
---

GeoBorder's `projection` now tweens: a new `projectTo` command (or `to` on `projection`) morphs the drawing from one projection into another, refitting it to the box as it goes, with each end exactly its own projection. With `orthographic` at one end the far side is clipped away progressively.
