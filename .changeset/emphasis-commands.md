---
"@motionscript/core": minor
"@motionscript/sdk": minor
---

Three commands that draw the eye to a node and leave it as it was.

- `pulse({ factor })` swells a node to `factor` times its size and settles it back; `wiggle({ angle, turns })` rocks it about its own turn. Both are on every 2D node.
- `flash({ portion })` sends a stretch of a shape's outline along it. A shape that rests with `end: 0` is seen only as the stretch passing.
