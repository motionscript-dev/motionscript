---
"@motionscript/renderer": patch
---

- **A conic gradient's `startAngle` rotates it.** The seam (the first stop) sits `startAngle` degrees clockwise from the box's three o'clock and the ramp runs a full turn from there. It used to stay at three o'clock, with the angles before `startAngle` clamped to the first stop and the ramp squeezed into what was left of the turn.
