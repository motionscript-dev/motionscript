---
"@motionscript/renderer": patch
---

The renderer's prewarm now also builds the drawing pipelines for the canvas format, so their shader compile overlaps a host's start-up instead of delaying its first frame.
