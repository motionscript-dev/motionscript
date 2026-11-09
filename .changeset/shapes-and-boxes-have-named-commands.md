---
"@motionscript/core": minor
---

Three more attributes can be animated by name, so a document no longer needs the general `to` for them.

- `layoutTo` on every 2D node tweens `width`, `height` and `padding`, whichever are given. A size keyword (`'fill'`, `'hug'`) snaps; a number interpolates.
- `effectTo` on every 2D node tweens the `effects` stack.
- `progressTo` on shapes and paths tweens `start` and `end`, the share of the outline that is drawn, whichever are given.

Each runs through `to`, so a frame is the same as before for a document that already tweened those props.
