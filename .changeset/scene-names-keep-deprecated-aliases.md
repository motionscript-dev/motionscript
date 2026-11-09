---
"@motionscript/core": patch
---

The scene-named document API keeps deprecated aliases until 1.0, so code written against an earlier alpha still builds.

- `SceneDocument` (`VisualDocument`), `SceneTimeline` (`ClipTimeline`), `SceneEffect` (`NodeEffect`), `integrateSpeedToSceneTime` (`integrateSpeedToClipTime`), `sourceTimeAtSceneElapsed` (`sourceTimeAtClipElapsed`) and `Sound.sceneDurationFor` (`Sound.clipDurationFor`) are exported again, each marked `@deprecated` and pointing at its new name.
- `SceneDocument` and `SceneEffect` are also back on `@motionscript/sdk`'s type exports.
- The error texts changed in the rename (`Invalid clip document:`, `JSX element must be a Node class`) stay as they are.
