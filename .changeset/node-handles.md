---
"@motionscript/core": minor
"@motionscript/sdk": minor
"@motionscript/react": minor
"@motionscript/math": minor
---

A node can name points an editor may drag to set its `Vector2` props. It answers `_handles()` with each prop and where it sits in its own frame, and `_handleValue(prop, at)` with the value that puts it somewhere else. `nodeHandlesAt` and `handleValueAt` (exported from the SDK), and `nodeHandles`/`handleValue` on the player, answer in viewport space. A math `vectorArrow` offers its two ends in graph units, and a `curlyBrace` that spans two points offers those.
