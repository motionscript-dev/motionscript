---
"@motionscript/geography": patch
---

**Breaking:** `GeoBorder`'s `start`/`end` draw only its borders on, leaving the fill and the overlay whole (they used to be trimmed too, into partial polygons closed by a chord). Its fill is now one shape measured against the node's box, so a `grid` or a gradient lines up across borders instead of restarting in each part.

Migration: a stored document needs nothing done to it, but a border that drew its fill on with `progressTo` now shows the whole fill from the start: fade it in with `fillTo` (or `fadeTo`) beside the `progressTo`. A fill pattern sized for one region is now measured against the whole node box.
